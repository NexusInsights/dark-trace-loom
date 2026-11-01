import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAN_MAP: Record<string, string> = {
  "prod_U7cQdUjRIZLpaD": "professional",
  "prod_U7cSMflIeLynmi": "team",
  "prod_U7cSZe7C3SrSuh": "enterprise",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Auth error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");

    // Check for admin override subscription in DB first
    const { data: localSub } = await supabaseClient
      .from("subscriptions")
      .select("plan, status, current_period_end, stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    if (localSub && localSub.stripe_customer_id === "admin_override_enterprise") {
      return new Response(JSON.stringify({
        subscribed: true,
        plan: localSub.plan,
        subscription_end: localSub.current_period_end,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({
        subscribed: false,
        plan: "free",
        subscription_end: null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customerId = customers.data[0].id;
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      // Update DB to free
      await supabaseClient.from("subscriptions").upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
        stripe_subscription_id: null,
        plan: "free",
        status: "inactive",
        current_period_end: null,
      }, { onConflict: "user_id" });

      return new Response(JSON.stringify({
        subscribed: false,
        plan: "free",
        subscription_end: null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sub = subscriptions.data[0];
    const productId = sub.items.data[0].price.product as string;
    const plan = PLAN_MAP[productId] ?? "professional";
    const subscriptionEnd = new Date(sub.current_period_end * 1000).toISOString();

    // Sync to DB
    await supabaseClient.from("subscriptions").upsert({
      user_id: user.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      plan,
      status: sub.status,
      current_period_end: subscriptionEnd,
    }, { onConflict: "user_id" });

    return new Response(JSON.stringify({
      subscribed: true,
      plan,
      subscription_end: subscriptionEnd,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
