import { supabase } from "@/integrations/supabase/client";
import { requireReservation, ResearchAdmissionError } from "../../../services/research/admission.mjs";
export { ResearchAdmissionError };
export type ResearchAction = "research-privacy" | "research-password" | "research-email" | "research-gleif";
const actions: ResearchAction[] = ["research-privacy", "research-password", "research-email", "research-gleif"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function deadline<T>(operation: () => PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ResearchAdmissionError(408, "ACCOUNT_TIMEOUT", "Research account verification timed out; no automatic retry was made.")), ms); })]); }
  finally { clearTimeout(timer!); }
}
type RpcResult = { data: unknown; error: unknown };
type Builder = PromiseLike<RpcResult> & { setHeader(name: string, value: string): Builder; abortSignal(signal: AbortSignal): Builder };
const admissionClient = supabase as unknown as { rpc(name: "reserve_intelligence_execution" | "finish_intelligence_execution", args: Record<string, unknown>): Builder };
async function rpc(name: "reserve_intelligence_execution" | "finish_intelligence_execution", args: Record<string, unknown>, token: string) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const result = await deadline(() => admissionClient.rpc(name, args).setHeader("Authorization", `Bearer ${token}`).abortSignal(controller.signal), 12000);
    if (result.error) throw new ResearchAdmissionError(503, "ACCOUNTING_UNAVAILABLE", "Research admission or accounting could not be verified.");
    return result.data as { ok?: boolean; allowed?: boolean; id?: string; code?: string; retryAfter?: number };
  } catch (error) { if (error instanceof ResearchAdmissionError) throw error; throw new ResearchAdmissionError(503, "ACCOUNTING_UNAVAILABLE", "Research admission or accounting could not be verified."); }
  finally { clearTimeout(timer); }
}

/** The operation is a local closure. Its inputs/results are never RPC arguments. */
export async function executeResearchAction<T>(action: ResearchAction, operation: (context: { signal: AbortSignal }) => Promise<T> | T, options: { signal?: AbortSignal; onUsageRefresh?: () => Promise<void> | void } = {}): Promise<T> {
  if (!actions.includes(action) || typeof operation !== "function") throw new ResearchAdmissionError(400, "INVALID_INPUT", "Select a supported research operation.");
  if (options.signal?.aborted) throw new ResearchAdmissionError(408, "RESEARCH_CANCELLED", "Research was cancelled.");
  let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>;
  try { sessionResult = await deadline(() => supabase.auth.getSession(), 12000); }
  catch { throw new ResearchAdmissionError(401, "UNAUTHORIZED", "This research session could not be verified."); }
  const session = sessionResult.data.session;
  if (sessionResult.error || typeof session?.access_token !== "string" || !session.access_token || session.access_token.length > 8192 || !session.user?.id) throw new ResearchAdmissionError(401, "UNAUTHORIZED", "Sign in before running research tools.");
  let verified: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try { verified = await deadline(() => supabase.auth.getUser(session.access_token), 12000); }
  catch { throw new ResearchAdmissionError(401, "UNAUTHORIZED", "This research session could not be verified."); }
  if (verified.error || !verified.data.user || !UUID.test(verified.data.user.id) || verified.data.user.id !== session.user.id || verified.data.user.is_anonymous === true || (verified.data.user.role && verified.data.user.role !== "authenticated")) throw new ResearchAdmissionError(401, "UNAUTHORIZED", "This research session could not be verified. Sign in again.");
  if (options.signal?.aborted) throw new ResearchAdmissionError(408, "RESEARCH_CANCELLED", "Research was cancelled.");
  const executionId = requireReservation(await rpc("reserve_intelligence_execution", { p_action: action }, session.access_token));
  const controller = new AbortController();
  let cancel: () => void;
  const cancelled = new Promise<never>((_, reject) => { cancel = () => { controller.abort(); reject(new ResearchAdmissionError(408, "RESEARCH_CANCELLED", "Research was cancelled or timed out; no automatic retry was made.")); }; });
  options.signal?.addEventListener("abort", cancel!, { once: true });
  const taskTimer = setTimeout(() => cancel(), 20000);
  let data: T;
  try {
    const result = Promise.race([Promise.resolve().then(() => {
      if (options.signal?.aborted || controller.signal.aborted) throw new ResearchAdmissionError(408, "RESEARCH_CANCELLED", "Research was cancelled.");
      return operation({ signal: controller.signal });
    }), cancelled]);
    if (options.signal?.aborted) cancel!();
    data = await result;
    if (controller.signal.aborted) throw new ResearchAdmissionError(408, "RESEARCH_CANCELLED", "Research was cancelled.");
  } catch (error) {
    try { const release = await rpc("finish_intelligence_execution", { p_execution_id: executionId, p_success: false }, session.access_token); if (release?.ok !== true) throw new Error("Unconfirmed release"); }
    catch { throw new ResearchAdmissionError(503, "ACCOUNTING_RELEASE_FAILED", "The operation failed and admission release could not be confirmed. Its pending reservation expires after two minutes; no automatic retry was made."); }
    throw error;
  } finally { clearTimeout(taskTimer); options.signal?.removeEventListener("abort", cancel!); controller.abort(); }
  try { const settlement = await rpc("finish_intelligence_execution", { p_execution_id: executionId, p_success: true }, session.access_token); if (settlement?.ok !== true) throw new Error("Unconfirmed accounting"); }
  catch { throw new ResearchAdmissionError(503, "ACCOUNTING_FAILED", "The operation completed but accounting could not be confirmed. No successful result or automatic retry was returned.", { operationCompleted: true }); }
  try { await options.onUsageRefresh?.(); }
  catch { throw new ResearchAdmissionError(503, "USAGE_REFRESH_FAILED", "The operation was accounted for, but the displayed tool usage could not be refreshed.", { operationCompleted: true }); }
  return data;
}
