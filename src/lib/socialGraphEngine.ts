import { supabase } from "@/integrations/supabase/client";

interface MiningResult {
  edgesCreated: number;
  entitiesAnalyzed: number;
}

/**
 * Mine social graph relationships from identity entities and their observations.
 * 
 * Relationship detection rules:
 * 1. Co-appearance: entities observed in the same case
 * 2. Shared infrastructure: email ↔ domain on same domain
 * 3. Shared identifiers: username appears in email or social profile
 * 4. Communication: entities linked via identity_entity_links
 */
export async function runSocialGraphMining(
  userId: string,
  onProgress?: (step: string) => void
): Promise<MiningResult> {
  onProgress?.("Loading entities...");

  const { data: entities } = await supabase
    .from("identity_entities")
    .select("*")
    .eq("user_id", userId);

  if (!entities?.length) return { edgesCreated: 0, entitiesAnalyzed: 0 };

  onProgress?.(`Analyzing ${entities.length} entities...`);

  const { data: observations } = await supabase
    .from("entity_observations")
    .select("entity_id, case_id, source_tool")
    .eq("user_id", userId);

  const { data: existingLinks } = await supabase
    .from("identity_entity_links")
    .select("source_entity_id, target_entity_id, relationship_type, confidence_score")
    .eq("user_id", userId);

  // Build lookup maps
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // Group observations by case for co-appearance detection
  const caseEntities = new Map<string, Set<string>>();
  const entityCases = new Map<string, Set<string>>();
  for (const obs of observations ?? []) {
    if (!obs.case_id) continue;
    if (!caseEntities.has(obs.case_id)) caseEntities.set(obs.case_id, new Set());
    caseEntities.get(obs.case_id)!.add(obs.entity_id);
    if (!entityCases.has(obs.entity_id)) entityCases.set(obs.entity_id, new Set());
    entityCases.get(obs.entity_id)!.add(obs.case_id);
  }

  const edges: {
    user_id: string;
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    confidence_score: number;
    source_tool: string | null;
    evidence: string | null;
  }[] = [];
  const edgeSeen = new Set<string>();

  function addEdge(
    srcId: string, tgtId: string, relType: string,
    confidence: number, tool: string | null, evidence: string | null
  ) {
    if (srcId === tgtId) return;
    const key = [srcId, tgtId].sort().join(`:${relType}:`);
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push({
      user_id: userId,
      source_entity_id: srcId,
      target_entity_id: tgtId,
      relationship_type: relType,
      confidence_score: confidence,
      source_tool: tool,
      evidence,
    });
  }

  onProgress?.("Detecting co-appearances...");

  // 1. Co-appearance: entities seen in the same case
  for (const [caseId, entityIds] of caseEntities) {
    const ids = Array.from(entityIds);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        // Higher confidence if they co-appear in multiple cases
        const sharedCases = [...(entityCases.get(ids[i]) ?? [])].filter(
          (c) => entityCases.get(ids[j])?.has(c)
        ).length;
        const confidence = Math.min(0.5 + sharedCases * 0.15, 0.95);
        addEdge(ids[i], ids[j], "co_appearance", confidence, null, `Co-appeared in ${sharedCases} case(s)`);
      }
    }
  }

  onProgress?.("Detecting shared infrastructure...");

  // 2. Shared infrastructure: email domain ↔ domain entity
  const emails = entities.filter((e) => e.entity_type === "email");
  const domains = entities.filter((e) => e.entity_type === "domain");
  for (const email of emails) {
    const emailDomain = email.entity_value.split("@")[1];
    for (const domain of domains) {
      if (emailDomain === domain.entity_value) {
        addEdge(email.id, domain.id, "shared_infrastructure", 0.9, null, `${email.entity_value} uses domain ${domain.entity_value}`);
      }
    }
  }

  // IPs sharing domain (if both observed in same case)
  const ips = entities.filter((e) => e.entity_type === "ip");
  for (const ip of ips) {
    for (const domain of domains) {
      const ipCases = entityCases.get(ip.id);
      const domainCases = entityCases.get(domain.id);
      if (ipCases && domainCases) {
        const shared = [...ipCases].filter((c) => domainCases.has(c));
        if (shared.length > 0) {
          addEdge(ip.id, domain.id, "shared_infrastructure", 0.7, null, `IP and domain co-observed in ${shared.length} case(s)`);
        }
      }
    }
  }

  onProgress?.("Detecting shared identifiers...");

  // 3. Shared identifiers: username in email or social profile
  const usernames = entities.filter((e) => e.entity_type === "username");
  const socials = entities.filter((e) => e.entity_type === "social_profile");

  for (const uname of usernames) {
    for (const email of emails) {
      const local = email.entity_value.split("@")[0].toLowerCase();
      if (local.includes(uname.entity_value) && uname.entity_value.length >= 3) {
        addEdge(uname.id, email.id, "shared_identifier", 0.75, null, `Username "${uname.entity_value}" found in email local part`);
      }
    }
    for (const social of socials) {
      if (social.entity_value.toLowerCase().includes(uname.entity_value) && uname.entity_value.length >= 3) {
        addEdge(uname.id, social.id, "shared_identifier", 0.8, null, `Username "${uname.entity_value}" matches social profile`);
      }
    }
  }

  // 4. Communication: import existing identity links
  for (const link of existingLinks ?? []) {
    addEdge(
      link.source_entity_id, link.target_entity_id,
      "communication", link.confidence_score,
      null, `Linked via identity resolution (${link.relationship_type})`
    );
  }

  onProgress?.(`Saving ${edges.length} social graph edges...`);

  let edgesCreated = 0;
  const batchSize = 50;
  for (let i = 0; i < edges.length; i += batchSize) {
    const batch = edges.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from("social_graph_edges")
      .upsert(batch, { onConflict: "user_id,source_entity_id,target_entity_id,relationship_type" })
      .select("id");
    if (!error && data) edgesCreated += data.length;
  }

  onProgress?.("Complete!");
  return { edgesCreated, entitiesAnalyzed: entities.length };
}
