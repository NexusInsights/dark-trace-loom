import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { z } from "npm:zod@3.23.8";
import { safeFetch } from "../_shared/safeFetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.object({
  org_id: z.string().uuid(),
  email: z.string().email().max(254),
  role: z.enum(["admin", "investigator", "viewer"]),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "missing_auth" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: ures, error: uerr } = await userClient.auth.getUser();
  if (uerr || !ures.user) return json({ error: "unauthenticated" }, 401);
  const inviter = ures.user;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
  const { org_id, email, role } = parsed.data;

  const { data: member } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", org_id)
    .eq("user_id", inviter.id)
    .maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role)) {
    return json({ error: "forbidden" }, 403);
  }

  const { data: org } = await admin.from("organizations").select("name").eq("id", org_id).maybeSingle();
  if (!org) return json({ error: "org_not_found" }, 404);

  const token = crypto.randomUUID() + "-" + crypto.randomUUID();
  const { data: invitation, error: ierr } = await admin
    .from("organization_invitations")
    .insert({
      organization_id: org_id,
      email: email.toLowerCase(),
      role,
      token,
      invited_by: inviter.id,
    })
    .select()
    .single();
  if (ierr || !invitation) return json({ error: "insert_failed", detail: ierr?.message }, 500);

  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!resendKey) {
    await admin.from("organization_invitations").delete().eq("id", invitation.id);
    return json({ status: "not_configured", reason: "RESEND_API_KEY not set" });
  }

  const origin = req.headers.get("origin") || Deno.env.get("APP_ORIGIN") || "";
  if (!origin) {
    await admin.from("organization_invitations").delete().eq("id", invitation.id);
    return json({ error: "no_origin", reason: "Origin header missing and APP_ORIGIN not configured" }, 400);
  }
  const acceptUrl = `${origin.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(token)}`;

  const text = `You've been invited to join ${org.name} on TJK Security.\n\nAccept your invitation:\n${acceptUrl}\n\nThis link expires in 7 days.`;
  const html = `<p>You've been invited to join <strong>${org.name}</strong> on TJK Security.</p><p><a href="${acceptUrl}">Accept your invitation</a></p><p>This link expires in 7 days.</p>`;

  try {
    const r = await safeFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "TJK Security <invites@tjksecurity.com>",
        to: [email],
        subject: `You've been invited to ${org.name}`,
        text,
        html,
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      await admin.from("organization_invitations").delete().eq("id", invitation.id);
      return json({ error: "resend_failed", status: r.status, detail });
    }
  } catch (e) {
    await admin.from("organization_invitations").delete().eq("id", invitation.id);
    return json({ error: "resend_error", reason: e instanceof Error ? e.message : String(e) }, 500);
  }

  return json({
    status: "success",
    invitation_id: invitation.id,
    expires_at: invitation.expires_at,
  });
});