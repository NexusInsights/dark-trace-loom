import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateUser, boundedJsonBody, RequestAuthenticationError } from "../_shared/authenticateUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The retired expansion algorithm invented handles, contacts and ownership links.
// No source-backed expansion provider exists on this route. Preserve old records,
// but never create new findings, personas, links, clusters or success logs here.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "error", reason: "method_not_allowed" }, 405);
  try {
    const actor = await authenticateUser(req);
    const raw = await boundedJsonBody(req, 4096);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ status: "error", reason: "invalid_body" }, 400);
    const body = raw as Record<string, unknown>;
    if (typeof body.entity_id !== "string" || !UUID.test(body.entity_id)
      || typeof body.entity_type !== "string" || !/^[a-z_]{1,40}$/.test(body.entity_type)
      || typeof body.entity_value !== "string" || !body.entity_value.trim() || body.entity_value.length > 2000
      || typeof body.user_id !== "string" || !UUID.test(body.user_id)) {
      return json({ status: "error", reason: "invalid_body" }, 400);
    }
    if (body.user_id !== actor.id) return json({ status: "error", reason: "user_mismatch" }, 403);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY"))!, {
        global: { headers: { Authorization: req.headers.get("Authorization")! } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
    const { data: entity, error } = await supabase.from("identity_entities")
      .select("id,entity_type,entity_value").eq("id", body.entity_id).eq("user_id", actor.id).maybeSingle();
    if (error) return json({ status: "error", reason: "entity_access_unavailable" }, 503);
    if (!entity) return json({ status: "error", reason: "entity_not_found_or_not_owned" }, 404);
    if (entity.entity_type !== body.entity_type || entity.entity_value !== body.entity_value) {
      return json({ status: "error", reason: "entity_input_mismatch" }, 409);
    }

    return json({
      status: "not_configured", success: false,
      reason: "Automatic identity expansion is unavailable: name, username and email permutations are not evidence of an account or person association. Use Persona Discovery with a known public profile or exact username, then review the retrieved sources.",
      results: {
        persona: { action: "unchanged" },
        permutations: { generated: 0, status: "not_configured" },
        linking: { links_created: 0, status: "not_configured" },
        clustering: { action: "unchanged", status: "not_configured" },
      },
    });
  } catch (error) {
    return json({ status: "error", reason: error instanceof RequestAuthenticationError ? error.code : "expansion_unavailable" },
      error instanceof RequestAuthenticationError ? error.status : 503);
  }
});
