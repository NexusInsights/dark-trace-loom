import { supabase } from "@/integrations/supabase/client";

export type EmailVerificationResult = {
  status: string;
  dkim: { cryptographicPass: boolean; dnsUnavailable: boolean; dnsQueries: number; signatures: Array<{ signingDomain: string | null; selector: string | null; algorithm: string; result: string; fullBodyCovered: boolean; bodyLengthLimited: boolean; unsignedBodyTail: boolean; strictFromAligned: boolean; testingKey: boolean }> };
  fromAlignment: { mode: string; fromDomain: string | null; status: string };
  uploadedReceiverClaims: { trust: string; authenticationResultsPresent: boolean; receivedSpfPresent: boolean; arcHeadersPresent: boolean };
  spf: string; dmarc: string; arc: string; checkedAt: string; limitations: string[];
};
export type EmailVerifier = (file: File, options?: { signal?: AbortSignal }) => Promise<EmailVerificationResult>;
export class EmailRequestError extends Error {
  constructor(public code: string, public operationCompleted = false) { super("The email verification request could not be completed."); }
}
const MAX_RESPONSE_BYTES = 64 * 1024;
const knownCodes = new Set(["UNAUTHORIZED", "EMAIL_TOO_LARGE", "CONSENT_REQUIRED", "INVALID_EMAIL", "INVALID_CONTENT_TYPE", "VERIFICATION_TIMEOUT", "TOO_MANY_SIGNATURES", "VERIFICATION_UNAVAILABLE", "INVALID_RESPONSE", "DAILY_LIMIT", "FORBIDDEN", "FORBIDDEN_ORIGIN", "ACCOUNTING_FAILED", "ACCOUNTING_RELEASE_FAILED", "ADMISSION_FAILED", "BACKEND_UNAVAILABLE", "INVALID_BACKEND_RESPONSE", "INVALID_AUTH_RESPONSE", "AUTH_CONFIGURATION", "RESEARCH_CANCELLED", "ACCOUNT_TIMEOUT", "REQUEST_TOO_LARGE"]);
const aborted = () => new DOMException("Cancelled", "AbortError");
async function deadline<T>(operation: () => Promise<T>, signal: AbortSignal | undefined, ms: number, timeoutCode: string, abort?: () => void): Promise<T> {
  if (signal?.aborted) throw aborted();
  let timer: ReturnType<typeof setTimeout>;
  let cancel: () => void;
  const boundary = new Promise<never>((_, reject) => {
    cancel = () => { abort?.(); reject(aborted()); };
    signal?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => { abort?.(); reject(new EmailRequestError(timeoutCode)); }, ms);
  });
  try { return await Promise.race([Promise.resolve().then(() => { if (signal?.aborted) throw aborted(); return operation(); }), boundary]); }
  finally { clearTimeout(timer!); signal?.removeEventListener("abort", cancel!); }
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES || !response.body) throw new EmailRequestError("INVALID_RESPONSE");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw aborted();
    for (;;) {
      const part = await reader.read(); if (signal.aborted) throw aborted(); if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new EmailRequestError("INVALID_RESPONSE");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new EmailRequestError("INVALID_RESPONSE"); }
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
type ResultEnvelope = { ok?: boolean; data?: EmailVerificationResult; error?: { code?: unknown; operationCompleted?: unknown } };

export const verifyEmailMessage: EmailVerifier = async (file, { signal } = {}) => {
  if (!file.size || file.size > 262144) throw new EmailRequestError("EMAIL_TOO_LARGE");
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  let session: Awaited<ReturnType<typeof supabase.auth.getSession>>;
  try { session = await deadline(() => supabase.auth.getSession(), signal, 12000, "ACCOUNT_TIMEOUT"); }
  catch (error) { if (error instanceof EmailRequestError || (error instanceof DOMException && error.name === "AbortError")) throw error; throw new EmailRequestError("UNAUTHORIZED"); }
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const token = session.data.session?.access_token;
  if (session.error || typeof token !== "string" || !token || token.length > 8192 || /\s/.test(token)) throw new EmailRequestError("UNAUTHORIZED");
  const controller = new AbortController();
  try {
    return await deadline(async () => {
      const response = await fetch("/api/research-email", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "message/rfc822", "X-Email-Processing-Consent": "true" },
      body: file, signal: controller.signal, redirect: "error", credentials: "same-origin",
    });
    const result = await boundedJson(response, controller.signal) as ResultEnvelope;
    if (!result || typeof result !== "object") throw new EmailRequestError("INVALID_RESPONSE");
    if (!response.ok || result.ok !== true) throw new EmailRequestError(typeof result.error?.code === "string" && knownCodes.has(result.error.code) ? result.error.code : "VERIFICATION_UNAVAILABLE", result.error?.operationCompleted === true);
    if (!result.data || !Array.isArray(result.data.dkim?.signatures) || !result.data.fromAlignment || !result.data.uploadedReceiverClaims) throw new EmailRequestError("INVALID_RESPONSE");
    return result.data;
    // One request deadline covers headers and the bounded response body. The
    // server handles Auth, admission, SDK work and settlement; no client RPC.
    }, signal, 70000, "VERIFICATION_TIMEOUT", () => controller.abort());
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (error instanceof EmailRequestError) throw error;
    throw new EmailRequestError(controller.signal.aborted ? "VERIFICATION_TIMEOUT" : "VERIFICATION_UNAVAILABLE");
  } finally { controller.abort(); }
};
