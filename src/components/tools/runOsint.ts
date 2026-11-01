import { supabase } from "@/integrations/supabase/client";
import { edgeFunctionError } from "@/lib/edgeFunctionError";
import { ToolExecutionError } from "./executeTool";

export async function runOsint<T = Record<string, unknown>>(action: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("osint-tools", { body: { action, params } });
  let body = data;
  if (error?.context instanceof Response) body = await error.context.clone().json().catch(() => body);
  if (error || body?.error || ["error", "not_configured", "unknown_tool"].includes(body?.status)) {
    const status = body?.status === "not_configured" ? "not_configured" : body?.status === "unknown_tool" ? "unknown_tool" : "error";
    const decoded = error ? await edgeFunctionError(error) : null;
    throw new ToolExecutionError(String(body?.reason || body?.error || decoded?.message || action + " failed"), status);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) throw new ToolExecutionError(action + " returned no usable record");
  return body as T;
}
