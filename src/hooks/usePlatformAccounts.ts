import { checkedDatabase } from "@/lib/checkedDatabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { evidenceObject, filterCurrentIdentityEntities, publicEvidenceUrl } from "@/lib/identityEvidence";
import { loadReviewedPersonaEntities } from "@/lib/personaTimelineEngine";
import { jsonValue } from "@/lib/jsonValue";

export function usePlatformAccounts(personaId: string | null) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["platform_accounts", personaId, user?.id], enabled: !!personaId && !!user,
    queryFn: async () => {
      const { entities, records } = await loadReviewedPersonaEntities(user!.id, personaId!);
      const { data } = await checkedDatabase(supabase.from("platform_accounts").select("*").eq("persona_id", personaId!).eq("user_id", user!.id).order("platform_category"));
      return (data ?? []).filter(account => {
        const evidence = evidenceObject(evidenceObject(account.metadata).identity_evidence);
        return evidence.persona_id === personaId && account.account_identifier === evidence.account_id && entities.some(entity => entity.entity_value === publicEvidenceUrl(account.profile_url)) && filterCurrentIdentityEntities([{ entity_type: "social_profile", entity_value: account.profile_url, metadata: account.metadata }], records).length === 1;
      });
    },
  });
}
export function useMapPlatformAccounts() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: async (personaId: string) => {
    if (!user) throw new Error("Not authenticated");
    const { entities } = await loadReviewedPersonaEntities(user.id, personaId);
    const seen = new Set<string>();
    const accounts = entities.flatMap(entity => {
      const evidence = evidenceObject(evidenceObject(entity.metadata).identity_evidence), accountId = String(evidence.account_id);
      if (seen.has(accountId)) return []; seen.add(accountId);
      const url = new URL(entity.entity_value);
      return [{ persona_id: personaId, user_id: user.id, platform_name: url.hostname, platform_category: "public_profile", account_identifier: accountId, profile_url: url.href, confidence_score: 0, verified: false, metadata: jsonValue({ identity_evidence: evidence, confidence_assessed: false, assessment: "analyst_supported_association" }) }];
    });
    if (!accounts.length) return { mapped: 0 };
    const { data } = await checkedDatabase(supabase.from("platform_accounts").upsert(accounts, { onConflict: "persona_id,platform_name,account_identifier" }).select("id"));
    return { mapped: data?.length ?? 0 };
  }, onSuccess: (_, id) => qc.invalidateQueries({ queryKey: ["platform_accounts", id] }) });
}
