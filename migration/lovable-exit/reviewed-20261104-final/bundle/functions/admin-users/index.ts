import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const setRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["admin", "moderator", "user"]),
  remove: z.boolean(),
});

const resetPasswordSchema = z.object({
  user_id: z.string().uuid(),
});

const setToolPermSchema = z.object({
  user_id: z.string().uuid(),
  tool_id: z.string().min(1).max(100),
  allowed: z.boolean(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Check admin role
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "list_users") {
      const { data: { users }, error } = await adminClient.auth.admin.listUsers({ perPage: 100 });
      if (error) throw error;

      const [{ data: allRoles }, { data: allProfiles }] = await Promise.all([
        adminClient.from("user_roles").select("*"),
        adminClient.from("profiles").select("*"),
      ]);

      const enriched = users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        name: allProfiles?.find((p) => p.id === u.id)?.name ?? null,
        profile_role: allProfiles?.find((p) => p.id === u.id)?.role ?? null,
        roles: allRoles?.filter((r) => r.user_id === u.id).map((r) => r.role) ?? [],
      }));

      return new Response(JSON.stringify({ users: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set_role" && req.method === "POST") {
      const body = await req.json();
      const { user_id, role, remove } = setRoleSchema.parse(body);

      if (remove) {
        await adminClient.from("user_roles").delete().eq("user_id", user_id).eq("role", role);
      } else {
        await adminClient.from("user_roles").upsert({ user_id, role }, { onConflict: "user_id,role" });
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "reset_password" && req.method === "POST") {
      const { user_id } = resetPasswordSchema.parse(await req.json());
      const { data: target, error: getErr } = await adminClient.auth.admin.getUserById(user_id);
      if (getErr || !target?.user?.email) throw new Error(getErr?.message || "User has no email");
      const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: target.user.email,
      });
      if (linkErr) throw linkErr;
      return new Response(JSON.stringify({
        success: true,
        email: target.user.email,
        action_link: linkData.properties?.action_link ?? null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "list_tool_permissions") {
      const targetUserId = url.searchParams.get("user_id");
      const q = adminClient.from("tool_permissions").select("user_id,tool_id,allowed,updated_at");
      const { data, error } = targetUserId ? await q.eq("user_id", targetUserId) : await q;
      if (error) throw error;
      return new Response(JSON.stringify({ permissions: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set_tool_permission" && req.method === "POST") {
      const { user_id, tool_id, allowed } = setToolPermSchema.parse(await req.json());
      const { error } = await adminClient
        .from("tool_permissions")
        .upsert({ user_id, tool_id, allowed, updated_by: userId, updated_at: new Date().toISOString() },
          { onConflict: "user_id,tool_id" });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "clear_tool_permission" && req.method === "POST") {
      const { user_id, tool_id } = setToolPermSchema.omit({ allowed: true }).parse(await req.json());
      const { error } = await adminClient
        .from("tool_permissions").delete().eq("user_id", user_id).eq("tool_id", tool_id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "stats") {
      const [cases, artifacts, toolResults, articles, courses] = await Promise.all([
        adminClient.from("cases").select("*", { count: "exact", head: true }),
        adminClient.from("artifacts").select("*", { count: "exact", head: true }),
        adminClient.from("tool_results").select("*", { count: "exact", head: true }),
        adminClient.from("articles").select("*", { count: "exact", head: true }),
        adminClient.from("courses").select("*", { count: "exact", head: true }),
      ]);
      return new Response(JSON.stringify({
        cases: cases.count ?? 0,
        artifacts: artifacts.count ?? 0,
        tool_results: toolResults.count ?? 0,
        articles: articles.count ?? 0,
        courses: courses.count ?? 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    const status = message.includes("parse") ? 400 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
