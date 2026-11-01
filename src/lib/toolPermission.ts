import { supabase } from "@/integrations/supabase/client";

/** A missing override permits execution; a failed or malformed lookup does not. */
export async function assertToolPermission(userId: string, toolId: string): Promise<void> {
  const { data, error } = await supabase.from("tool_permissions").select("allowed")
    .eq("user_id", userId).eq("tool_id", toolId).maybeSingle();
  if (error) throw new Error("Tool permissions could not be verified");
  if (data !== null && (typeof data !== "object" || typeof data.allowed !== "boolean")) throw new Error("Invalid tool permission response");
  if (data?.allowed === false) throw new Error("This tool has been disabled for your account by an administrator.");
}
