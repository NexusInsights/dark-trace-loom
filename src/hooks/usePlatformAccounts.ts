import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function usePlatformAccounts(personaId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["platform_accounts", personaId, user?.id],
    enabled: !!personaId && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_accounts")
        .select("*")
        .eq("persona_id", personaId!)
        .eq("user_id", user!.id)
        .order("platform_category", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

const PLATFORM_CATEGORIES: Record<string, string[]> = {
  social_media: ["twitter.com", "instagram.com", "facebook.com", "tiktok.com", "reddit.com", "linkedin.com"],
  forums: ["reddit.com", "hackforums.net", "stackoverflow.com", "4chan.org"],
  developer: ["github.com", "gitlab.com", "bitbucket.org", "npm", "pypi.org", "hub.docker.com"],
  domains: [],
  email_services: ["gmail.com", "outlook.com", "yahoo.com", "protonmail.com", "hotmail.com"],
};

function categorize(platform: string): string {
  const p = platform.toLowerCase();
  for (const [cat, platforms] of Object.entries(PLATFORM_CATEGORIES)) {
    if (platforms.some((pp) => p.includes(pp))) return cat;
  }
  return "other";
}

export function useMapPlatformAccounts() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (personaId: string) => {
      if (!user) throw new Error("Not authenticated");

      // Get persona identifiers
      const { data: identifiers } = await supabase
        .from("persona_identifiers")
        .select("identifier_type, identifier_value, confidence_score")
        .eq("persona_id", personaId)
        .eq("user_id", user.id);

      if (!identifiers?.length) return { mapped: 0 };

      const accounts: {
        persona_id: string;
        user_id: string;
        platform_name: string;
        platform_category: string;
        account_identifier: string;
        profile_url: string | null;
        confidence_score: number;
      }[] = [];

      for (const id of identifiers) {
        if (id.identifier_type === "social_profile") {
          // Parse URL like https://twitter.com/username
          try {
            const url = new URL(id.identifier_value);
            const platform = url.hostname.replace("www.", "");
            const handle = url.pathname.replace(/^\//, "").split("/")[0];
            if (handle) {
              accounts.push({
                persona_id: personaId,
                user_id: user.id,
                platform_name: platform,
                platform_category: categorize(platform),
                account_identifier: handle,
                profile_url: id.identifier_value,
                confidence_score: id.confidence_score,
              });
            }
          } catch { /* skip invalid URLs */ }
        } else if (id.identifier_type === "email") {
          const domain = id.identifier_value.split("@")[1];
          if (domain) {
            accounts.push({
              persona_id: personaId,
              user_id: user.id,
              platform_name: domain,
              platform_category: categorize(domain),
              account_identifier: id.identifier_value,
              profile_url: null,
              confidence_score: id.confidence_score,
            });
          }
        } else if (id.identifier_type === "username") {
          // Map username to common platforms
          for (const platform of ["twitter.com", "instagram.com", "github.com", "reddit.com"]) {
            accounts.push({
              persona_id: personaId,
              user_id: user.id,
              platform_name: platform,
              platform_category: categorize(platform),
              account_identifier: id.identifier_value,
              profile_url: `https://${platform}/${id.identifier_value}`,
              confidence_score: Math.max(0.2, id.confidence_score * 0.5),
            });
          }
        } else if (id.identifier_type === "domain") {
          accounts.push({
            persona_id: personaId,
            user_id: user.id,
            platform_name: id.identifier_value,
            platform_category: "domains",
            account_identifier: id.identifier_value,
            profile_url: `https://${id.identifier_value}`,
            confidence_score: id.confidence_score,
          });
        }
      }

      if (accounts.length === 0) return { mapped: 0 };

      const { data } = await supabase
        .from("platform_accounts")
        .upsert(accounts, { onConflict: "persona_id,platform_name,account_identifier", ignoreDuplicates: true })
        .select("id");

      return { mapped: data?.length ?? 0 };
    },
    onSuccess: (_, personaId) => {
      qc.invalidateQueries({ queryKey: ["platform_accounts", personaId] });
    },
  });
}
