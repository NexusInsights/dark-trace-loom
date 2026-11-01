import { checkedDatabase } from "@/lib/checkedDatabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

async function sourcedProfiles(personaId: string, userId: string) {
  const { data, error } = await checkedDatabase(supabase.from("persona_identifiers").select("identifier_value,source").eq("persona_id", personaId).eq("user_id", userId).eq("identifier_type", "social_profile").like("source", "live:%"));
  if (error) throw error;
  return data || [];
}
export function usePlatformAccounts(personaId: string | null) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["platform_accounts", personaId, user?.id], enabled: !!personaId && !!user,
    queryFn: async () => {
      const profiles = await sourcedProfiles(personaId!, user!.id);
      const { data, error } = await checkedDatabase(supabase.from("platform_accounts").select("*").eq("persona_id", personaId!).eq("user_id", user!.id).order("platform_category"));
      if (error) throw error;
      const urls = new Set(profiles.map(p => p.identifier_value));
      return (data || []).filter(account => account.profile_url && urls.has(account.profile_url));
    },
  });
}
export function useMapPlatformAccounts() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: async (personaId: string) => {
    if (!user) throw new Error("Not authenticated");
    const profiles = await sourcedProfiles(personaId, user.id);
    const accounts = profiles.map(profile => {
      const url = new URL(profile.identifier_value);
      return { persona_id: personaId, user_id: user.id, platform_name: url.hostname, platform_category: "public_profile", account_identifier: url.searchParams.get("id") || decodeURIComponent(url.pathname.slice(1)), profile_url: url.href, confidence_score: 1 };
    });
    if (!accounts.length) return { mapped: 0 };
    const { data, error } = await checkedDatabase(supabase.from("platform_accounts").upsert(accounts, { onConflict: "persona_id,platform_name,account_identifier" }).select("id"));
    if (error) throw error;
    return { mapped: data?.length || 0 };
  }, onSuccess: (_,id) => qc.invalidateQueries({ queryKey: ["platform_accounts", id] }) });
}
