import { supabase } from "@/integrations/supabase/client";

export type IntelligenceAction = "ipinfo" | "breach" | "profile" | "onion";
export type IntelligenceFailure = { code: string; message: string; retryAfter?: number };

export class IntelligenceRequestError extends Error {
  constructor(public details: IntelligenceFailure) {
    super(details.message + (details.retryAfter ? ` Retry after ${details.retryAfter} seconds.` : ""));
  }
}

export async function runIntelligenceAction(action: IntelligenceAction, input: Record<string, string>) {
  const { data, error } = await supabase.functions.invoke("intelligence-tools", { body: { action, input } });
  let result = data;
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context instanceof Response) {
      try { result = await context.json(); } catch { result = null; }
    }
    if (!result?.error) throw new IntelligenceRequestError({ code: "CONNECTION_FAILED", message: "The intelligence endpoint is unavailable. Check backend and worker configuration." });
  }
  if (result?.ok !== true) {
    const failure = result?.error;
    throw new IntelligenceRequestError({
      code: typeof failure?.code === "string" ? failure.code : "INVALID_RESPONSE",
      message: typeof failure?.message === "string" ? failure.message : "The intelligence endpoint returned an invalid result.",
      ...(typeof failure?.retryAfter === "number" ? { retryAfter: failure.retryAfter } : {}),
    });
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new IntelligenceRequestError({ code: "INVALID_RESPONSE", message: "The intelligence endpoint returned an invalid result." });
  return result.data as Record<string, unknown>;
}
