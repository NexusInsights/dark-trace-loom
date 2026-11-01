import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.object({ token: z.string().min(8).max(128) });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "unauthenticated" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: ures, error: uerr } = await userClient.auth.getUser();
  if (uerr || !ures.user) return json({ error: "unauthenticated" }, 401);
  const user = ures.user;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);

  const { data: inv } = await admin
    .from("organization_invitations")
    .select("*")
    .eq("token", parsed.data.token)
    .maybeSingle();

  if (!inv) return json({ error: "not_found" }, 404);
  if (inv.accepted_at) return json({ error: "already_accepted" }, 410);
  if (new Date(inv.expires_at).getTime() < Date.now()) return json({ error: "expired" }, 410);

  if ((user.email ?? "").toLowerCase() !== inv.email.toLowerCase()) {
    return json({ error: "email_mismatch" }, 403);
  }

  const { error: merr } = await admin
    .from("organization_members")
    .upsert(
      {
        organization_id: inv.organization_id,
        user_id: user.id,
        role: inv.role,
        invited_by: inv.invited_by,
      },
      { onConflict: "organization_id,user_id" },
    );
  if (merr) return json({ error: "membership_failed", detail: merr.message }, 500);

  await admin
    .from("organization_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", inv.id);

  return json({ status: "success", org_id: inv.organization_id, role: inv.role });
});