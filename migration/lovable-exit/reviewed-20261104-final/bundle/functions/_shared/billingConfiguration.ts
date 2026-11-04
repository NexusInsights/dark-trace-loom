import { RequestAuthenticationError } from "./authenticateUser.ts";

export function billingAppOrigin(): string {
  const value = Deno.env.get("APP_ORIGIN");
  if (!value || value.length > 2048) throw new RequestAuthenticationError(424, "billing_return_origin_not_configured");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.port) throw new Error("Invalid configured app origin");
    return url.origin;
  } catch { throw new RequestAuthenticationError(424, "billing_return_origin_not_configured"); }
}

export function billingBackendFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const configured = Deno.env.get("SUPABASE_URL");
  if (!configured) throw new RequestAuthenticationError(424, "billing_database_not_configured");
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (target.origin !== new URL(configured).origin) throw new Error("Unexpected backend origin");
  return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
}

export function stripeSessionUrl(value: unknown, _kind: "checkout" | "portal"): string {
  if (typeof value !== "string" || value.length > 8192) throw new RequestAuthenticationError(502, "invalid_billing_session_response");
  try {
    const url = new URL(value);
    // This value must come only from the fixed Stripe SDK API response, never
    // request input. Existing Stripe-configured custom domains are supported.
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Invalid billing session URL");
    return url.href;
  } catch { throw new RequestAuthenticationError(502, "invalid_billing_session_response"); }
}
