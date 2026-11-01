import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const PLAN_MAP: Record<string, string> = {
  "prod_U7cQdUjRIZLpaD": "professional",
  "prod_U7cSMflIeLynmi": "team",
  "prod_U7cSZe7C3SrSuh": "enterprise",
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2025-08-27.basil",
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  // ─── Helpers ───

  const logStep = (step: string, details?: unknown) => {
    const d = details ? ` - ${JSON.stringify(details)}` : "";
    console.log(`[WEBHOOK] ${step}${d}`);
  };

  const findUserByEmail = async (email: string) => {
    const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    return users.users.find((u) => u.email === email) ?? null;
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
    if (error) logStep("Failed to log billing event", error.message);
  };

  const upsertSubscription = async (
    userId: string,
    customerId: string,
    subscriptionId: string,
    plan: string,
    status: string,
    currentPeriodEnd: string | null
  ) => {
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
    if (error) throw new Error(`DB upsert failed: ${error.message}`);
    logStep("Subscription upserted", { userId, plan, status });
  };

  // ─── Main ───

  try {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    let event: Stripe.Event;

    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
      logStep("Signature verified");
    } else {
      event = JSON.parse(body) as Stripe.Event;
      logStep("WARNING: No webhook secret, parsing without verification");
    }

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

          const productId = sub.items.data[0]?.price?.product as string;
          const plan = PLAN_MAP[productId] ?? "professional";
          const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

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

        if (customerId && invoice.subscription) {
          const subId = typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          const email = await getCustomerEmail(customerId);
          if (!email) { logStep("No email for customer"); break; }
          const user = await findUserByEmail(email);
          if (!user) { logStep("No user for email", { email }); break; }

          const productId = sub.items.data[0]?.price?.product as string;
          const plan = PLAN_MAP[productId] ?? "professional";
          const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

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

        if (customerId && invoice.subscription) {
          const subId = typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription.id;
          const email = await getCustomerEmail(customerId);
          const user = email ? await findUserByEmail(email) : null;

          // Update subscription status to past_due
          if (user) {
            const sub = await stripe.subscriptions.retrieve(subId);
            const productId = sub.items.data[0]?.price?.product as string;
            const plan = PLAN_MAP[productId] ?? "professional";

            await upsertSubscription(user.id, customerId, sub.id, plan, sub.status, 
              sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null);
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

        const productId = sub.items.data[0]?.price?.product as string;
        const plan = PLAN_MAP[productId] ?? "professional";
        const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

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
        const customerId = resolveCustomerId(sub);
        logStep("Subscription deleted", { subId: sub.id });

        const email = await getCustomerEmail(customerId);
        if (!email) { logStep("No email for customer"); break; }
        const user = await findUserByEmail(email);
        if (!user) { logStep("No user for email", { email }); break; }

        await upsertSubscription(user.id, customerId, sub.id, "free", "canceled", null);
        await logBillingEvent(event.id, event.type, user.id, customerId, sub.id, {
          previous_plan: PLAN_MAP[sub.items.data[0]?.price?.product as string] ?? "unknown",
          canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[WEBHOOK] Error: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});
