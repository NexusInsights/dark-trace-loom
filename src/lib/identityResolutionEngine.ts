import { supabase } from "@/integrations/supabase/client";

export type IdentityType = "username" | "email" | "domain" | "ip" | "phone" | "social_profile";

interface RawIdentifier {
  type: IdentityType;
  value: string;
  caseId?: string;
  sourceTool?: string;
}

// Similarity rules for linking identifiers
interface LinkRule {
  check: (a: RawIdentifier, b: RawIdentifier) => boolean;
  relationship: string;
  confidence: number;
}

const LINK_RULES: LinkRule[] = [
  // Same value, same type → exact match
  {
    check: (a, b) => a.type === b.type && a.value === b.value && a !== b,
    relationship: "exact_match",
    confidence: 1.0,
  },
  // Email shares domain
  {
    check: (a, b) =>
      a.type === "email" && b.type === "domain" &&
      a.value.split("@")[1] === b.value,
    relationship: "email_uses_domain",
    confidence: 0.85,
  },
  // Username appears in email local part
  {
    check: (a, b) =>
      a.type === "username" && b.type === "email" &&
      b.value.split("@")[0].toLowerCase().includes(a.value.toLowerCase()) &&
      a.value.length >= 3,
    relationship: "username_in_email",
    confidence: 0.7,
  },
  // Username appears in social profile
  {
    check: (a, b) =>
      a.type === "username" && b.type === "social_profile" &&
      b.value.toLowerCase().includes(a.value.toLowerCase()) &&
      a.value.length >= 3,
    relationship: "username_matches_profile",
    confidence: 0.75,
  },
  // Email local parts match across different domains
  {
    check: (a, b) =>
      a.type === "email" && b.type === "email" &&
      a.value !== b.value &&
      a.value.split("@")[0] === b.value.split("@")[0] &&
      a.value.split("@")[0].length >= 3,
    relationship: "shared_email_handle",
    confidence: 0.65,
  },
];

/**
 * Resolve identities: upsert entities, then find and create links.
 */
export async function runIdentityResolution(
  userId: string,
  onProgress?: (step: string) => void
): Promise<{ entitiesResolved: number; linksCreated: number }> {
  onProgress?.("Loading case data...");

  // Gather raw identifiers from artifacts and subjects
  const { data: cases } = await supabase
    .from("cases")
    .select("id")
    .order("created_at", { ascending: false });

  if (!cases?.length) return { entitiesResolved: 0, linksCreated: 0 };

  const caseIds = cases.map((c) => c.id);

  const [{ data: artifacts }, { data: subjects }] = await Promise.all([
    supabase.from("artifacts").select("id, case_id, data, artifact_type").in("case_id", caseIds),
    supabase.from("subjects").select("id, case_id, name, notes, type").in("case_id", caseIds),
  ]);

  onProgress?.("Extracting identifiers...");
  const identifiers: RawIdentifier[] = [];

  const PATTERNS: Record<IdentityType, RegExp> = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    domain: /(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g,
    ip: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    phone: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    username: /@([a-zA-Z0-9_]{2,30})/g,
    social_profile: /https?:\/\/(?:twitter|x|instagram|facebook|linkedin|github)\.com\/([a-zA-Z0-9_.-]+)/g,
  };

  function extract(text: string, caseId: string, tool?: string) {
    for (const [type, regex] of Object.entries(PATTERNS) as [IdentityType, RegExp][]) {
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const value = (type === "username" || type === "social_profile" ? match[1] : match[0]).toLowerCase();
        if (type === "domain" && /^(localhost|example\.com|test\.\w+)$/i.test(value)) continue;
        if (type === "ip" && (value === "0.0.0.0" || value === "127.0.0.1")) continue;
        identifiers.push({ type, value, caseId, sourceTool: tool });
      }
    }
  }

  for (const a of artifacts ?? []) {
    if (a.data) extract(a.data, a.case_id, a.artifact_type);
  }
  for (const s of subjects ?? []) {
    extract([s.name, s.notes ?? ""].join(" "), s.case_id);
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = identifiers.filter((id) => {
    const key = `${id.type}:${id.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  onProgress?.(`Upserting ${unique.length} entities...`);

  // Upsert entities in batches
  const batchSize = 50;
  let entitiesResolved = 0;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize).map((id) => ({
      user_id: userId,
      entity_type: id.type,
      entity_value: id.value,
      confidence_score: 1.0,
      source_case_id: id.caseId ?? null,
      source_tool: id.sourceTool ?? null,
    }));

    const { data, error } = await supabase
      .from("identity_entities")
      .upsert(batch, { onConflict: "user_id,entity_type,entity_value" })
      .select("id, entity_type, entity_value");

    if (!error && data) entitiesResolved += data.length;
  }

  // Record observations for each identifier per case
  onProgress?.("Recording entity observations...");
  const { data: currentEntities } = await supabase
    .from("identity_entities")
    .select("id, entity_type, entity_value")
    .eq("user_id", userId);

  const entityLookup = new Map<string, string>();
  for (const e of currentEntities ?? []) {
    entityLookup.set(`${e.entity_type}:${e.entity_value}`, e.id);
  }

  // Build observations from ALL identifiers (not deduplicated) to capture per-case sightings
  const observations: { user_id: string; entity_id: string; case_id: string; source_tool: string | null; observed_value: string }[] = [];
  const obsSeen = new Set<string>();

  for (const id of identifiers) {
    const entityId = entityLookup.get(`${id.type}:${id.value}`);
    if (!entityId || !id.caseId) continue;
    const obsKey = `${entityId}:${id.caseId}:${id.value}`;
    if (obsSeen.has(obsKey)) continue;
    obsSeen.add(obsKey);
    observations.push({
      user_id: userId,
      entity_id: entityId,
      case_id: id.caseId,
      source_tool: id.sourceTool ?? null,
      observed_value: id.value,
    });
  }

  for (let i = 0; i < observations.length; i += batchSize) {
    const batch = observations.slice(i, i + batchSize);
    await supabase.from("entity_observations").upsert(batch, { ignoreDuplicates: true });
  }

  // Reload all entities for linking
  onProgress?.("Loading entities for linking...");
  const { data: allEntities } = await supabase
    .from("identity_entities")
    .select("*")
    .eq("user_id", userId);

  if (!allEntities?.length) return { entitiesResolved, linksCreated: 0 };

  // Map entities to RawIdentifier format for rule checking
  const entityIdentifiers: (RawIdentifier & { dbId: string })[] = allEntities.map((e) => ({
    type: e.entity_type as IdentityType,
    value: e.entity_value,
    caseId: e.source_case_id ?? undefined,
    dbId: e.id,
  }));

  onProgress?.("Resolving identity links...");
  const links: { source_entity_id: string; target_entity_id: string; relationship_type: string; confidence_score: number; user_id: string }[] = [];
  const linkSeen = new Set<string>();

  for (let i = 0; i < entityIdentifiers.length; i++) {
    for (let j = i + 1; j < entityIdentifiers.length; j++) {
      const a = entityIdentifiers[i];
      const b = entityIdentifiers[j];

      for (const rule of LINK_RULES) {
        if (rule.check(a, b) || rule.check(b, a)) {
          const key = [a.dbId, b.dbId].sort().join(":" + rule.relationship + ":");
          if (linkSeen.has(key)) continue;
          linkSeen.add(key);

          links.push({
            source_entity_id: a.dbId,
            target_entity_id: b.dbId,
            relationship_type: rule.relationship,
            confidence_score: rule.confidence,
            user_id: userId,
          });
        }
      }
    }
  }

  onProgress?.(`Saving ${links.length} identity links...`);
  let linksCreated = 0;

  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from("identity_entity_links")
      .upsert(batch, { onConflict: "source_entity_id,target_entity_id,relationship_type" })
      .select("id");
    if (!error && data) linksCreated += data.length;
  }

  onProgress?.("Complete!");
  return { entitiesResolved, linksCreated };
}
