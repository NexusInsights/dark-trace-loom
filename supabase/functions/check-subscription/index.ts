import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { authenticateUser, boundedRawBody, RequestAuthenticationError } from "../_shared/authenticateUser.ts";
import { subscriptionState } from "../_shared/stripeSubscription.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
type LocalSubscription = { plan: string; status: string; current_period_end: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null };
const plans = new Set(["free", "professional", "team", "enterprise"]);
const activeStates = new Set(["active", "trialing"]);

serve(async (req) => {
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  try {
    // Verify the session before constructing a privileged database/Stripe client.
    // No request body can select a different actor or billing identity.
    const user = await authenticateUser(req, { requireEmail: true });
    if (req.body) {
      const raw = await boundedRawBody(req, 2048);
      if (raw.trim()) {
        let value: unknown;
        try { value = JSON.parse(raw); } catch { return respond({ error: "invalid_body" }, 400); }
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) return respond({ error: "invalid_body" }, 400);
      }
    }
    const backendUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!backendUrl || !serviceKey) return respond({ error: "subscription_service_not_configured" }, 424);
    const origin = new URL(backendUrl).origin; // Already validated by Auth helper.
    const backendFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(input instanceof Request ? input.url : String(input));
      if (target.origin !== origin) throw new Error("Unexpected backend origin");
      return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
    };
    const supabase = createClient(backendUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: backendFetch } });
    const { data: localSub, error: localError } = await supabase.from("subscriptions").select("plan, status, current_period_end, stripe_customer_id, stripe_subscription_id").eq("user_id", user.id).maybeSingle();
    if (localError) return respond({ error: "subscription_record_unavailable" }, 503);
    if (localSub && (!plans.has(localSub.plan) || typeof localSub.status !== "string" || (localSub.current_period_end !== null && (typeof localSub.current_period_end !== "string" || !Number.isFinite(Date.parse(localSub.current_period_end)))))) return respond({ error: "invalid_subscription_record" }, 502);
    const local = localSub as LocalSubscription | null;
    if (local?.stripe_customer_id === "admin_override_enterprise") {
      if (local.plan !== "enterprise" || local.status !== "active") return respond({ error: "invalid_subscription_override" }, 502);
      return respond({ subscribed: true, plan: local.plan, subscription_end: local.current_period_end, billing_verification: "admin_override" });
    }
    const pending = (reason: string) => respond({
      subscribed: Boolean(local && local.plan !== "free" && activeStates.has(local.status)),
      plan: local?.plan ?? "free",
      subscription_end: local?.current_period_end ?? null,
      billing_verification: "pending",
      verification_reason: reason,
    });
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return pending("stripe_not_configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil", httpClient: Stripe.createFetchHttpClient(), timeout: 10000, maxNetworkRetries: 0 });
    let verified: Stripe.Subscription;
    let customerId: string;
    try {
      if (local?.stripe_customer_id) {
        if (!/^cus_[A-Za-z0-9_]{1,150}$/.test(local.stripe_customer_id)) return pending("stripe_customer_reference_invalid");
        // Verify the preserved exact customer in this account; email search must
        // not substitute a different account/customer during migration.
        const customer = await stripe.customers.retrieve(local.stripe_customer_id);
        if (customer.deleted || !customer.email || customer.email.toLowerCase() !== user.email.toLowerCase()) return pending("stripe_customer_account_unverified");
        customerId = customer.id;
        if (local.stripe_subscription_id) {
          if (!/^sub_[A-Za-z0-9_]{1,150}$/.test(local.stripe_subscription_id)) return pending("stripe_subscription_reference_invalid");
          verified = await stripe.subscriptions.retrieve(local.stripe_subscription_id);
        } else {
          const found = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
          if (found.has_more) return pending("stripe_subscription_selection_required");
          const candidates = found.data.filter((sub) => activeStates.has(sub.status));
          if (candidates.length !== 1) return pending("stripe_subscription_account_unverified");
          verified = candidates[0];
        }
      } else {
        const customers = await stripe.customers.list({ email: user.email, limit: 2 });
        if (customers.has_more || customers.data.length > 1) return pending("stripe_customer_selection_required");
        if (!customers.data.length) return pending("stripe_customer_account_unverified");
        customerId = customers.data[0].id;
        const found = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
        if (found.has_more) return pending("stripe_subscription_selection_required");
        const candidates = found.data.filter((sub) => activeStates.has(sub.status));
        if (candidates.length !== 1) return pending("stripe_subscription_account_unverified");
        verified = candidates[0];
      }
      const reference = typeof verified.customer === "string" ? verified.customer : verified.customer?.id;
      if (reference !== customerId || !/^sub_[A-Za-z0-9_]{1,150}$/.test(verified.id)) return pending("stripe_subscription_account_unverified");
    } catch { return pending("stripe_unavailable_or_account_unverified"); }
    let state: { plan: string; periodEnd: string };
    try { state = subscriptionState(verified); }
    catch { return pending("stripe_subscription_mapping_unverified"); }
    // Only a verified terminal status from the exact subscription can demote it.
    const subscribed = activeStates.has(verified.status);
    const terminal = ["canceled", "incomplete_expired", "unpaid"].includes(verified.status);
    const plan = terminal ? "free" : state.plan;
    const { error: syncError } = await supabase.from("subscriptions").upsert({ user_id: user.id, stripe_customer_id: customerId, stripe_subscription_id: verified.id, plan, status: verified.status, current_period_end: state.periodEnd }, { onConflict: "user_id" });
    if (syncError) return respond({ error: "subscription_sync_failed" }, 503);
    return respond({ subscribed, plan, subscription_end: state.periodEnd, billing_verification: "verified" });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return respond({ error: error.code }, error.status);
    return respond({ error: "subscription_verification_failed" }, 503);
  }
});
