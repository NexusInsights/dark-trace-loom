import { checkedDatabase as checkedQuery } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { evidenceText } from "./evidenceText";

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
  if (!userId.trim()) throw new Error("Sign in before resolving identities.");
  onProgress?.("Loading cases and saved identity evidence...");

  // Gather raw identifiers from artifacts and subjects
  const { data: cases } = await checkedDatabase(supabase
    .from("cases")
    .select("id")
    .order("created_at", { ascending: false }));

  const caseIds = (cases ?? []).map((c) => c.id);

  const [{ data: artifacts }, { data: subjects }] = await Promise.all([
    caseIds.length ? checkedDatabase(supabase.from("artifacts").select("id, case_id, data, artifact_type").in("case_id", caseIds)) : Promise.resolve({ data: [] }),
    caseIds.length ? checkedDatabase(supabase.from("subjects").select("id, case_id, name, notes, type").in("case_id", caseIds)) : Promise.resolve({ data: [] }),
  ]);

  // These records can exist without a case or artifact (e.g. Persona Discovery).
  // Read every page so the backend's default row limit cannot silently drop evidence.
  const savedIdentifiers = await readAll(() => supabase.from("persona_identifiers")
    .select("id, identifier_type, identifier_value, source, confidence_score")
    .eq("user_id", userId).order("id"));
  const toolResults = await readAll(() => supabase.from("tool_results")
    .select("id, case_id, tool_name, result_data, status")
    .eq("user_id", userId).order("id"));
  const pdlResults = await readAll(() => supabase.from("pdl_lookups")
    .select("id, result").eq("user_id", userId).order("id"));

  onProgress?.("Extracting identifiers...");
  const identifiers: RawIdentifier[] = [];

  const PATTERNS: Record<IdentityType, RegExp> = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    domain: /(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g,
    ip: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    phone: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    username: /(?<![a-zA-Z0-9._%+-])@([a-zA-Z0-9_]{2,30})\b/g,
    social_profile: /https?:\/\/(?:www\.)?(?:(?:twitter|x|instagram|facebook|github|gitlab)\.com\/|linkedin\.com\/(?:in|pub)\/|dev\.to\/|keybase\.io\/)[a-zA-Z0-9_.-]+/gi,
  };

  function extract(text: string, caseId?: string, tool?: string) {
    for (const [type, regex] of Object.entries(PATTERNS) as [IdentityType, RegExp][]) {
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const value = (type === "username" ? match[1] : match[0]).toLowerCase();
        if (type === "ip" && value.split(".").some(part => Number(part) > 255)) continue;
        if (type === "phone" && value.replace(/\D/g, "").length < 10) continue;
        if (type === "domain" && /^(localhost|example\.com|test\.\w+)$/i.test(value)) continue;
        if (type === "ip" && (value === "0.0.0.0" || value === "127.0.0.1")) continue;
        identifiers.push({ type, value, caseId, sourceTool: tool });
      }
    }
  }

  for (const a of artifacts ?? []) {
    if (a.data) extract(evidenceText(a.data), a.case_id, a.artifact_type);
  }
  for (const s of subjects ?? []) {
    extract([s.name, s.notes ?? ""].join(" "), s.case_id);
  }
  for (const id of savedIdentifiers) {
    // Legacy generated candidates are not observed identities.
    if (/generat|permut|candidat|infer|synthetic|guess|variation/i.test(id.source ?? "")) continue;
    const type = id.identifier_type as IdentityType;
    if (!Object.prototype.hasOwnProperty.call(PATTERNS, type) || !id.identifier_value.trim()) continue;
    const sourceTool = `persona_identifier:${id.id}`;
    if (type === "username" && /^[a-zA-Z0-9_.-]{2,100}$/.test(id.identifier_value.replace(/^@/, ""))) {
      identifiers.push({ type, value: id.identifier_value.replace(/^@/, "").toLowerCase(), sourceTool });
    } else {
      extract(id.identifier_value, undefined, sourceTool);
    }
  }
  for (const result of toolResults) {
    if (result.status && !["success", "completed", "complete"].includes(result.status.toLowerCase())) continue;
    if (!result.result_data || !isUsableResult(result.result_data)) continue;
    extract(savedEvidenceText(result.result_data), result.case_id ?? undefined, `tool_result:${result.id}:${result.tool_name}`);
  }
  for (const result of pdlResults) {
    if (result.result && isUsableResult(result.result)) {
      extract(savedEvidenceText(result.result), undefined, `pdl_lookup:${result.id}`);
    }
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

    const { data, error } = await checkedDatabase(supabase
      .from("identity_entities")
      .upsert(batch, { onConflict: "user_id,entity_type,entity_value" })
      .select("id, entity_type, entity_value"));

    if (!error && data) entitiesResolved += data.length;
  }

  // Record observations for each identifier per case
  onProgress?.("Recording entity observations...");
  const { data: currentEntities } = await checkedDatabase(supabase
    .from("identity_entities")
    .select("id, entity_type, entity_value, source_tool, metadata")
    .eq("user_id", userId));

  // Retain, but quarantine, derived records produced by this resolver when their
  // source no longer qualifies. Original evidence and unrelated entities stay intact.
  const activeKeys = new Set(unique.map(id => `${id.type}:${id.value}`));
  const excludedIds = new Set<string>();
  for (const entity of currentEntities ?? []) {
    const metadata = entity.metadata && typeof entity.metadata === "object" && !Array.isArray(entity.metadata) ? entity.metadata : {};
    if (/^(persona_identifier:|tool_result:|pdl_lookup:)/.test(entity.source_tool ?? "") && !activeKeys.has(`${entity.entity_type}:${entity.entity_value}`)) {
      await checkedDatabase(supabase.from("identity_entities").update({ metadata: {
        ...metadata, resolution_excluded: true, resolution_exclusion_reason: "Source is no longer eligible observed or declared identifier evidence",
      } }).eq("id", entity.id).eq("user_id", userId));
      excludedIds.add(entity.id);
    } else if (metadata.resolution_excluded === true) {
      if (activeKeys.has(`${entity.entity_type}:${entity.entity_value}`)) {
        await checkedDatabase(supabase.from("identity_entities").update({ metadata: {
          ...metadata, resolution_excluded: false, resolution_exclusion_reason: null,
        } }).eq("id", entity.id).eq("user_id", userId));
      } else excludedIds.add(entity.id);
    }
  }

  const entityLookup = new Map<string, string>();
  for (const e of currentEntities ?? []) {
    if (excludedIds.has(e.id)) continue;
    entityLookup.set(`${e.entity_type}:${e.entity_value}`, e.id);
  }

  // Build observations from ALL identifiers (not deduplicated) to capture per-case sightings
  const observations: { user_id: string; entity_id: string; case_id: string | null; source_tool: string | null; observed_value: string }[] = [];
  // The observations table has no natural-key unique constraint. Do not insert
  // duplicates on every rerun by upserting against its random primary key.
  const existingObservations = await readAll(() => supabase.from("entity_observations")
    .select("entity_id, case_id, source_tool, observed_value").eq("user_id", userId).order("id"));
  const observationKey = (entityId: string, caseId: string | null, tool: string | null, value: string) =>
    JSON.stringify([entityId, caseId, tool, value]);
  const obsSeen = new Set(existingObservations.map(o => observationKey(o.entity_id, o.case_id, o.source_tool, o.observed_value)));

  for (const id of identifiers) {
    const entityId = entityLookup.get(`${id.type}:${id.value}`);
    if (!entityId) continue;
    const obsKey = observationKey(entityId, id.caseId ?? null, id.sourceTool ?? null, id.value);
    if (obsSeen.has(obsKey)) continue;
    obsSeen.add(obsKey);
    observations.push({
      user_id: userId,
      entity_id: entityId,
      case_id: id.caseId ?? null,
      source_tool: id.sourceTool ?? null,
      observed_value: id.value,
    });
  }

  for (let i = 0; i < observations.length; i += batchSize) {
    const batch = observations.slice(i, i + batchSize);
    await checkedDatabase(supabase.from("entity_observations").insert(batch));
  }

  // Reload all entities for linking
  onProgress?.("Loading entities for linking...");
  const { data: allEntities } = await checkedDatabase(supabase
    .from("identity_entities")
    .select("*")
    .eq("user_id", userId));

  if (!allEntities?.length) return { entitiesResolved, linksCreated: 0 };

  // Map entities to RawIdentifier format for rule checking
  const entityIdentifiers: (RawIdentifier & { dbId: string })[] = allEntities.filter(e => !excludedIds.has(e.id)).map((e) => ({
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
    const { data, error } = await checkedDatabase(supabase
      .from("identity_entity_links")
      .upsert(batch, { onConflict: "source_entity_id,target_entity_id,relationship_type" })
      .select("id"));
    if (!error && data) linksCreated += data.length;
  }

  onProgress?.("Complete!");
  return { entitiesResolved, linksCreated };
}

function isUsableResult(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return !result.error && result.success !== false && result.notConfigured !== true && result.configured !== false;
}

function savedEvidenceText(value: unknown): string {
  // Provider URLs, failed account checks and record IDs describe the lookup;
  // they must not become contact identities or phone-number observations.
  const excluded = /^(?:id|.*_id|source_?url|retrieved_?at|created_?at|updated_?at|checks|error|errors|provider_notice|provider_field_availability|ai_interpretation|intel|interpretation|recommendations?|suggestions?|.*candidates?|summary|description|reason|notes?|tags)$/i;
  const identifier = /^(?:.*_emails?|emails?|.*_phones?|phones?|phone_numbers|domain|ip|ip_address|social_profile|profile_?url|(?:github|gitlab|linkedin|facebook|twitter|instagram)_url|.*_username|username|handle|website|.*_website|url|address|normalized)$/i;
  function collect(item: unknown, key = ""): string[] {
    if (excluded.test(key)) return [];
    if (typeof item === "string") {
      if (!identifier.test(key)) return [];
      if (/username|handle/i.test(key)) return /^@?[a-zA-Z0-9_.-]{2,100}$/.test(item) ? [`@${item.replace(/^@/, "")}`] : [];
      if (/url|website|social_profile/i.test(key) && /^(?:www\.)?(?:linkedin|github|gitlab|facebook|twitter|instagram|x)\.com\//i.test(item)) return [`https://${item}`];
      return [item];
    }
    if (Array.isArray(item)) return item.flatMap(entry => collect(entry, key));
    if (item && typeof item === "object") return Object.entries(item).flatMap(([name, entry]) => collect(entry, name));
    return [];
  }
  return collect(value).join("\n");
}

async function readAll<T>(query: () => {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
}): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data } = await checkedDatabase(query().range(offset, offset + 499));
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

async function checkedDatabase<T extends { error: unknown }>(query: PromiseLike<T> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<T>;
}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await checkedQuery(query.abortSignal ? query.abortSignal(controller.signal) : query);
  } finally {
    clearTimeout(timer);
  }
}
