import { supabase } from "@/integrations/supabase/client";

interface ClusterCandidate {
  entityIds: Set<string>;
  score: number;
  label: string;
  reasons: Map<string, string>; // entityId -> reason
}

export async function runIdentityClustering(
  userId: string,
  onProgress?: (step: string) => void
): Promise<{ clustersCreated: number; entitiesClustered: number }> {
  onProgress?.("Loading entities and links...");

  const [{ data: entities }, { data: links }, { data: observations }, { data: infraLinks }] = await Promise.all([
    supabase.from("identity_entities").select("id, entity_type, entity_value").eq("user_id", userId),
    supabase.from("identity_entity_links").select("source_entity_id, target_entity_id, relationship_type, confidence_score").eq("user_id", userId),
    supabase.from("entity_observations").select("entity_id, case_id").eq("user_id", userId),
    supabase.from("infrastructure_links").select("entity_id, infrastructure_type, value").eq("user_id", userId),
  ]);

  if (!entities?.length) return { clustersCreated: 0, entitiesClustered: 0 };

  onProgress?.("Building adjacency graph...");

  // Union-Find for clustering
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();

  function find(x: string): string {
    if (!parent.has(x)) { parent.set(x, x); rank.set(x, 0); }
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const rA = rank.get(ra) ?? 0, rB = rank.get(rb) ?? 0;
    if (rA < rB) parent.set(ra, rb);
    else if (rA > rB) parent.set(rb, ra);
    else { parent.set(rb, ra); rank.set(ra, rA + 1); }
  }

  const edgeReasons = new Map<string, string>(); // "a:b" -> reason

  // Signal 1: Direct entity links
  for (const link of links ?? []) {
    if (link.confidence_score >= 0.5) {
      union(link.source_entity_id, link.target_entity_id);
      const key = [link.source_entity_id, link.target_entity_id].sort().join(":");
      edgeReasons.set(key, `linked_${link.relationship_type}`);
    }
  }

  // Signal 2: Shared username values
  const byValue = new Map<string, string[]>();
  for (const e of entities) {
    const key = `${e.entity_type}:${e.entity_value}`;
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key)!.push(e.id);
  }
  for (const [key, ids] of byValue) {
    if (ids.length < 2) continue;
    for (let i = 1; i < ids.length; i++) {
      union(ids[0], ids[i]);
      const eKey = [ids[0], ids[i]].sort().join(":");
      edgeReasons.set(eKey, `shared_${key.split(":")[0]}`);
    }
  }

  // Signal 3: Shared email domains
  const emailsByDomain = new Map<string, string[]>();
  for (const e of entities) {
    if (e.entity_type === "email") {
      const domain = e.entity_value.split("@")[1];
      if (domain && !["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "protonmail.com"].includes(domain)) {
        if (!emailsByDomain.has(domain)) emailsByDomain.set(domain, []);
        emailsByDomain.get(domain)!.push(e.id);
      }
    }
  }
  for (const [, ids] of emailsByDomain) {
    if (ids.length < 2) continue;
    for (let i = 1; i < ids.length; i++) {
      union(ids[0], ids[i]);
      const eKey = [ids[0], ids[i]].sort().join(":");
      edgeReasons.set(eKey, "shared_email_domain");
    }
  }

  // Signal 4: Shared infrastructure
  const infraByValue = new Map<string, string[]>();
  for (const il of infraLinks ?? []) {
    const key = `${il.infrastructure_type}:${il.value}`;
    if (!infraByValue.has(key)) infraByValue.set(key, []);
    infraByValue.get(key)!.push(il.entity_id);
  }
  for (const [, ids] of infraByValue) {
    const unique = [...new Set(ids)];
    if (unique.length < 2) continue;
    for (let i = 1; i < unique.length; i++) {
      union(unique[0], unique[i]);
      const eKey = [unique[0], unique[i]].sort().join(":");
      edgeReasons.set(eKey, "shared_infrastructure");
    }
  }

  // Signal 5: Co-occurrence in investigations
  const caseEntities = new Map<string, string[]>();
  for (const obs of observations ?? []) {
    if (!obs.case_id) continue;
    if (!caseEntities.has(obs.case_id)) caseEntities.set(obs.case_id, []);
    caseEntities.get(obs.case_id)!.push(obs.entity_id);
  }
  for (const [, ids] of caseEntities) {
    const unique = [...new Set(ids)];
    if (unique.length < 2) continue;
    for (let i = 0; i < Math.min(unique.length, 10); i++) {
      for (let j = i + 1; j < Math.min(unique.length, 10); j++) {
        union(unique[i], unique[j]);
        const eKey = [unique[i], unique[j]].sort().join(":");
        if (!edgeReasons.has(eKey)) edgeReasons.set(eKey, "case_co_occurrence");
      }
    }
  }

  // Collect clusters
  onProgress?.("Forming clusters...");
  const clusters = new Map<string, Set<string>>();
  for (const e of entities) {
    const root = find(e.id);
    if (!clusters.has(root)) clusters.set(root, new Set());
    clusters.get(root)!.add(e.id);
  }

  // Filter to clusters with 2+ members
  const validClusters = [...clusters.entries()].filter(([, members]) => members.size >= 2);

  if (!validClusters.length) {
    onProgress?.("No clusters found");
    return { clustersCreated: 0, entitiesClustered: 0 };
  }

  // Clear old clusters
  onProgress?.(`Saving ${validClusters.length} clusters...`);
  await supabase.from("identity_clusters").delete().eq("user_id", userId);

  const entityMap = new Map(entities.map((e) => [e.id, e]));
  let totalMembers = 0;

  for (const [, memberIds] of validClusters) {
    // Label from most common entity value
    const types = [...memberIds].map((id) => entityMap.get(id)?.entity_type ?? "unknown");
    const primaryEntity = [...memberIds].map((id) => entityMap.get(id)).find((e) => e?.entity_type === "username" || e?.entity_type === "email");
    const label = primaryEntity?.entity_value ?? `Cluster (${memberIds.size} entities)`;
    const score = Math.min(memberIds.size * 15, 100);

    const { data: cluster } = await supabase
      .from("identity_clusters")
      .insert({ user_id: userId, cluster_label: label, cluster_score: score })
      .select("id")
      .single();

    if (!cluster) continue;

    const members = [...memberIds].map((entityId) => ({
      cluster_id: cluster.id,
      entity_id: entityId,
      user_id: userId,
      confidence_score: Math.min(score / 100, 1),
      join_reason: edgeReasons.get([...memberIds].filter((id) => id !== entityId).map((id) => [entityId, id].sort().join(":")).find((k) => edgeReasons.has(k)) ?? "") ?? "cluster_member",
    }));

    const { data } = await supabase.from("cluster_members").upsert(members, { ignoreDuplicates: true }).select("id");
    if (data) totalMembers += data.length;
  }

  onProgress?.("Complete!");
  return { clustersCreated: validClusters.length, entitiesClustered: totalMembers };
}
