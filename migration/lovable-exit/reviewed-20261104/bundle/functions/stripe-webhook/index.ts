import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { boundedRawBody, RequestAuthenticationError } from "../_shared/authenticateUser.ts";
import { subscriptionState, invoiceSubscriptionId } from "../_shared/stripeSubscription.ts";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const respond = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const backendUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeKey || !webhookSecret || !backendUrl || !serviceKey) return respond({ error: "webhook_not_configured" }, 424);
  const signature = req.headers.get("stripe-signature");
  if (!signature || signature.length > 8192) return respond({ error: "invalid_signature" }, 400);
  try { const configured = new URL(backendUrl); if (configured.protocol !== "https:" || configured.username || configured.password || configured.search || configured.hash || configured.pathname !== "/") return respond({ error: "webhook_not_configured" }, 424); }
  catch { return respond({ error: "webhook_not_configured" }, 424); }
  let rawBody: string;
  try { rawBody = await boundedRawBody(req, 256 * 1024); }
  catch (error) { return respond({ error: error instanceof RequestAuthenticationError ? error.code : "invalid_body" }, error instanceof RequestAuthenticationError ? error.status : 400); }
  const stripe = new Stripe(stripeKey, {
    apiVersion: "2025-08-27.basil",
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 15000,
    maxNetworkRetries: 0,
  });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret, undefined, Stripe.createSubtleCryptoProvider());
  } catch { return respond({ error: "invalid_signature" }, 400); }
  if (!event || typeof event.id !== "string" || !/^evt_[A-Za-z0-9_]{1,150}$/.test(event.id)
      || typeof event.type !== "string" || !/^[a-z][a-z0-9_.]{1,100}$/.test(event.type)
      || !event.data || !event.data.object || typeof event.data.object !== "object" || Array.isArray(event.data.object)) return respond({ error: "invalid_event" }, 400);
  const backendFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== new URL(backendUrl).origin) throw new Error("Unexpected backend origin");
    return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
  };
  const supabase = createClient(
    backendUrl,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: backendFetch } }
  );

  // ─── Helpers ───

  // Retain branch diagnostics without logging payloads, emails, IDs or secrets.
  const logStep = (_step: string, _details?: unknown) => undefined;

  const findUserByEmail = async (email: string) => {
    const { data: users, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error || !Array.isArray(users?.users)) throw new Error("Auth user lookup failed");
    const found = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
    if (!found && users.users.length >= 1000) throw new Error("Auth user lookup requires pagination");
    return found;
  };

  const getCustomerEmail = async (customerId: string): Promise<string | null> => {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    return (customer as Stripe.Customer).email ?? null;
  };

  const resolveCustomerId = (obj: { customer: string | Stripe.Customer | Stripe.DeletedCustomer }): string =>
    typeof obj.customer === "string" ? obj.customer : obj.customer.id;

  const logBillingEvent = async (
    eventId: string,
    eventType: string,
    userId: string | null,
    customerId: string | null,
    subscriptionId: string | null,
    data: Record<string, unknown>
  ) => {
    const { error } = await supabase.from("billing_events").insert({
      stripe_event_id: eventId,
      event_type: eventType,
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      data,
    });
    if (error && error.code !== "23505") throw new Error("Billing event persistence failed");
  };

  const upsertSubscription = async (
    userId: string,
    customerId: string,
    subscriptionId: string,
    plan: string,
    status: string,
    currentPeriodEnd: string | null
  ) => {
    const { data: existing, error: existingError } = await supabase.from("subscriptions").select("stripe_customer_id,stripe_subscription_id").eq("user_id", userId).maybeSingle();
    if (existingError) throw new Error("Existing subscription could not be verified");
    if (existing?.stripe_customer_id === "admin_override_enterprise") return false;
    // A signed event proves origin, not ownership of the user's current billing
    // record. An unrelated/older subscription must not replace or cancel it.
    const terminal = ["canceled", "incomplete_expired", "unpaid"].includes(status);
    if (terminal && (!existing || existing.stripe_customer_id !== customerId || existing.stripe_subscription_id !== subscriptionId)) return false;
    if ((existing?.stripe_customer_id && existing.stripe_customer_id !== customerId) || (existing?.stripe_subscription_id && existing.stripe_subscription_id !== subscriptionId)) throw new Error("Stored billing references require reconciliation");
    const { error } = await supabase.from("subscriptions").upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        plan,
        status,
        current_period_end: currentPeriodEnd,
      },
      { onConflict: "user_id" }
    );
    if (error) throw new Error("Subscription persistence failed");
    logStep("Subscription upserted", { userId, plan, status });
    return true;
  };

  // ─── Main ───

  try {
    // Check recorded deliveries before mutating a subscription. This protects
    // older recorded retries; concurrent/event-order transactions are separate.
    const { data: delivered, error: deliveryError } = await supabase.from("billing_events").select("id").eq("stripe_event_id", event.id).maybeSingle();
    if (deliveryError) throw new Error("Existing billing delivery could not be verified");
    if (delivered) return respond({ received: true, duplicate: true }, 200);
    logStep(`Event received: ${event.type}`, { id: event.id });

    switch (event.type) {
      // ── Checkout completed ──
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        logStep("Checkout session completed", { mode: session.mode, sessionId: session.id });

        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          const customerId = resolveCustomerId(sub);
          const email = await getCustomerEmail(customerId);
          if (!email) { logStep("No email for customer"); break; }
          const user = await findUserByEmail(email);
          if (!user) { logStep("No user for email", { email }); break; }

          const { plan, periodEnd } = subscriptionState(sub);

          await upsertSubscription(user.id, customerId, sub.id, plan, sub.status, periodEnd);
          await logBillingEvent(event.id, event.type, user.id, customerId, sub.id, {
            plan,
            status: sub.status,
            session_id: session.id,
          });
        }
        break;
      }

      // ── Invoice paid ──
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
        logStep("Invoice paid", { invoiceId: invoice.id, customerId });

        const subId = invoiceSubscriptionId(invoice);
        if (customerId && subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          const email = await getCustomerEmail(customerId);
          if (!email) { logStep("No email for customer"); break; }
          const user = await findUserByEmail(email);
          if (!user) { logStep("No user for email", { email }); break; }

          const { plan, periodEnd } = subscriptionState(sub);

          await upsertSubscription(user.id, customerId, sub.id, plan, sub.status, periodEnd);
          await logBillingEvent(event.id, event.type, user.id, customerId, sub.id, {
            plan,
            amount_paid: invoice.amount_paid,
            currency: invoice.currency,
          });
        }
        break;
      }

      // ── Invoice payment failed ──
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
        logStep("Invoice payment failed", { invoiceId: invoice.id, customerId });

        const subId = invoiceSubscriptionId(invoice);
        if (customerId && subId) {
          const email = await getCustomerEmail(customerId);
          const user = email ? await findUserByEmail(email) : null;

          // Update subscription status to past_due
          if (user) {
            const sub = await stripe.subscriptions.retrieve(subId);
            const { plan, periodEnd } = subscriptionState(sub);
            await upsertSubscription(user.id, customerId, sub.id, plan, sub.status, periodEnd);
          }

          await logBillingEvent(event.id, event.type, user?.id ?? null, customerId, subId, {
            amount_due: invoice.amount_due,
            attempt_count: invoice.attempt_count,
            next_payment_attempt: invoice.next_payment_attempt,
          });
        }
        break;
      }

      // ── Subscription updated ──
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = resolveCustomerId(sub);
        logStep("Subscription updated", { subId: sub.id, status: sub.status });

        const email = await getCustomerEmail(customerId);
        if (!email) { logStep("No email for customer"); break; }
        const user = await findUserByEmail(email);
        if (!user) { logStep("No user for email", { email }); break; }

        const { plan, periodEnd } = subscriptionState(sub);

        await upsertSubscription(user.id, customerId, sub.id, plan, sub.status, periodEnd);
        await logBillingEvent(event.id, event.type, user.id, customerId, sub.id, {
          plan,
          status: sub.status,
          cancel_at_period_end: sub.cancel_at_period_end,
        });
        break;
      }

      // ── Subscription deleted ──
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const { plan: previousPlan } = subscriptionState(sub);
        const customerId = resolveCustomerId(sub);
        logStep("Subscription deleted", { subId: sub.id });

        const email = await getCustomerEmail(customerId);
        if (!email) { logStep("No email for customer"); break; }
        const user = await findUserByEmail(email);
        if (!user) { logStep("No user for email", { email }); break; }

        const syncApplied = await upsertSubscription(user.id, customerId, sub.id, "free", "canceled", null);
        await logBillingEvent(event.id, event.type, user.id, customerId, sub.id, {
          previous_plan: previousPlan,
          canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
          subscription_sync_applied: syncApplied,
        });
        break;
      }

      default:
        logStep(`Unhandled event type: ${event.type}`);
        await logBillingEvent(event.id, event.type, null, null, null, {});
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch { return respond({ error: "event_processing_failed" }, 500); }
});
