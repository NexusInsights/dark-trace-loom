import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { authenticateUser, boundedJsonBody, RequestAuthenticationError } from "../_shared/authenticateUser.ts";
import { billingAppOrigin, billingBackendFetch, stripeSessionUrl } from "../_shared/billingConfiguration.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Preserve the original app product/price scope. The selected Stripe account
// must own these prices; user-supplied arbitrary prices are never adopted.
const allowedPrices: Readonly<Record<string, string>> = Object.freeze({
  price_1T9NC1Q4s8rfSgucApe67wQN: "prod_U7cQdUjRIZLpaD",
  price_1T9NDKQ4s8rfSgucPdmpOZlN: "prod_U7cSMflIeLynmi",
  price_1T9NDeQ4s8rfSguceUqxqqHh: "prod_U7cSZe7C3SrSuh",
});
serve(async (req) => {
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  try {
    const user = await authenticateUser(req, { requireEmail: true });
    const body = await boundedJsonBody(req, 2048);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.prototype.hasOwnProperty.call(body, "priceId")) return respond({ error: "invalid_checkout_input" }, 400);
    const priceId = (body as { priceId?: unknown }).priceId;
    if (typeof priceId !== "string" || !Object.prototype.hasOwnProperty.call(allowedPrices, priceId)) return respond({ error: "unsupported_checkout_price" }, 400);
    const origin = billingAppOrigin();
    const key = Deno.env.get("STRIPE_SECRET_KEY"), backend = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!key || !backend || !serviceKey) return respond({ error: "billing_not_configured" }, 424);
    const supabase = createClient(backend, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: billingBackendFetch } });
    const { data: local, error: readError } = await supabase.from("subscriptions").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    if (readError) return respond({ error: "billing_customer_record_unavailable" }, 503);
    if (local?.stripe_customer_id === "admin_override_enterprise") return respond({ error: "manual_account_has_no_checkout_requirement" }, 409);
    if (local?.stripe_customer_id && !/^cus_[A-Za-z0-9_]{1,150}$/.test(local.stripe_customer_id)) return respond({ error: "billing_customer_reference_invalid" }, 409);
    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil", httpClient: Stripe.createFetchHttpClient(), timeout: 10000, maxNetworkRetries: 0 });
    const price = await stripe.prices.retrieve(priceId);
    const productId = typeof price.product === "string" ? price.product : price.product?.id;
    if (price.id !== priceId || !price.active || !price.recurring || productId !== allowedPrices[priceId]) return respond({ error: "checkout_product_scope_unverified" }, 424);
    let customerId: string | undefined;
    if (local?.stripe_customer_id) {
      const customer = await stripe.customers.retrieve(local.stripe_customer_id);
      if (customer.deleted || customer.id !== local.stripe_customer_id || !customer.email || customer.email.toLowerCase() !== user.email.toLowerCase() || (customer.metadata?.user_id && customer.metadata.user_id !== user.id)) return respond({ error: "billing_customer_ownership_unverified" }, 409);
      customerId = customer.id;
    } else {
      const found = await stripe.customers.list({ email: user.email, limit: 2 });
      if (found.has_more || found.data.length > 1) return respond({ error: "billing_customer_selection_required" }, 409);
      const customer = found.data[0];
      if (customer) {
        if (!/^cus_[A-Za-z0-9_]{1,150}$/.test(customer.id) || !customer.email || customer.email.toLowerCase() !== user.email.toLowerCase() || (customer.metadata?.user_id && customer.metadata.user_id !== user.id)) return respond({ error: "billing_customer_ownership_unverified" }, 409);
        customerId = customer.id;
      }
    }
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: origin + "/dashboard?checkout=success",
      cancel_url: origin + "/pricing?canceled=true",
      metadata: { user_id: user.id },
    });
    return respond({ url: stripeSessionUrl(session.url, "checkout") });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return respond({ error: error.code }, error.status);
    return respond({ error: "checkout_session_unavailable" }, 503);
  }
});
