import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { filterCurrentIdentityEntities } from "./identityEvidence";
import { loadIdentitySourceRecords } from "./loadIdentityEvidence";
import { reviewedAccountGroups, reviewedMembershipReason, REVIEWED_GROUP_PREFIX } from "./reviewedIdentityGroups";

export async function runIdentityClustering(userId: string, onProgress?: (step: string) => void): Promise<{ clustersCreated: number; entitiesClustered: number }> {
  if (!userId.trim()) throw new Error("Sign in before grouping account evidence.");
  onProgress?.("Loading current source-bound analyst associations...");
  const [{ data: entities }, records, { data: existing }] = await Promise.all([
    checkedDatabase(supabase.from("identity_entities").select("*").eq("user_id", userId)),
    loadIdentitySourceRecords(userId),
    checkedDatabase(supabase.from("identity_clusters").select("id,cluster_label").eq("user_id", userId)),
  ]);
  const groups = reviewedAccountGroups(filterCurrentIdentityEntities(entities ?? [], records));
  let clustersCreated = 0, entitiesClustered = 0;
  for (const group of groups) {
    const label = REVIEWED_GROUP_PREFIX + group.personaId;
    let clusterId = existing?.find(cluster => cluster.cluster_label === label)?.id;
    if (!clusterId) {
      const { data } = await checkedDatabase(supabase.from("identity_clusters")
        .insert({ user_id: userId, cluster_label: label, cluster_score: 0 }).select("id").single());
      if (!data?.id) throw new Error("The reviewed account group could not be saved.");
      clusterId = data.id;
      clustersCreated++;
    }
    const members = group.members.map(entity => ({
      cluster_id: clusterId!, entity_id: entity.id, user_id: userId,
      confidence_score: 0, join_reason: reviewedMembershipReason(entity),
    }));
    const { data } = await checkedDatabase(supabase.from("cluster_members")
      .upsert(members, { onConflict: "cluster_id,entity_id" }).select("id"));
    if (!data || data.length !== members.length) throw new Error("The reviewed group membership was not fully saved.");
    entitiesClustered += data.length;
  }
  onProgress?.(groups.length ? "Saved analyst-supported account groups. These groups are not independent proof of identity." : "No dossier has two current source-bound account associations. Shared names, employers, domains, IPs and case membership are not used to infer identity.");
  return { clustersCreated, entitiesClustered };
}
