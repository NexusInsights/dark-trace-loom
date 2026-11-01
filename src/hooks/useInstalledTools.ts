import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useInstalledTools() {
  const {user} = useAuth();
  return useQuery({
    queryKey: ["installed-tools", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) throw new Error("Sign in to load your installed tools.");
      const {data, error} = await supabase.from("user_installed_tools")
        .select("tool_id,enabled,tool_marketplace(*)").eq("user_id", user.id);
      if (error) throw new Error(`Installed tools could not be loaded: ${error.message}`);
      return data ?? [];
    },
  });
}
