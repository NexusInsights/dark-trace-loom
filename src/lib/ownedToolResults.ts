import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ExecutionStatus } from "@/components/tools/executeTool";

// Caller protection only. Actual SQL/RLS must enforce this atomically as well.
export async function assertToolResultOwnership(userId: string, caseId: string | null): Promise<void> {
  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data?.user?.id || auth.data.user.id !== userId) throw new Error("Result owner does not match a verified authenticated user");
  if (caseId === null) return; // Explicit standalone result belongs to the verified user.
  if (typeof caseId !== "string" || !caseId || caseId !== caseId.trim() || caseId.length > 200) throw new Error("Case ownership could not be verified");
  const { data, error } = await supabase.from("cases").select("id,owner_id").eq("id", caseId).eq("owner_id", userId).maybeSingle();
  if (error || !data || data.id !== caseId || data.owner_id !== userId) throw new Error("Case ownership could not be verified");
}

export async function saveOwnedToolResult(input: {
  userId: string; caseId: string | null; toolName: string; status: ExecutionStatus; resultData: Json;
}): Promise<void> {
  await assertToolResultOwnership(input.userId, input.caseId);
  const { error } = await supabase.from("tool_results").insert({
    user_id: input.userId, case_id: input.caseId, tool_name: input.toolName, status: input.status, result_data: input.resultData,
  });
  if (error) throw new Error(error.message);
}
