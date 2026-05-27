import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Input validation helpers ───
function validateUuid(val: unknown, field: string): string | null {
  if (typeof val !== "string") return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRe.test(val) ? val : null;
}

function sanitizeString(val: unknown, maxLen = 2000): string {
  if (typeof val !== "string") return "";
  return val.trim().slice(0, maxLen);
}

const MAX_BODY_SIZE = 50_000; // 50KB

async function parseBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_SIZE) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ─── Authenticate via API key ───
  const apiKey =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace("Bearer ", "");

  if (!apiKey || apiKey.length > 256) {
    return json({ error: "Missing or invalid API key." }, 401);
  }

  const { data: keyRow, error: keyErr } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", apiKey)
    .eq("active", true)
    .single();

  if (keyErr || !keyRow) {
    return json({ error: "Invalid or inactive API key." }, 403);
  }

  // ─── Rate limiting (daily check) ───
  const planLimits: Record<string, number> = {
    free: 100,
    professional: 10000,
    team: 10000,
    enterprise: -1,
  };
  const dailyLimit = planLimits[keyRow.plan] ?? 100;

  if (dailyLimit !== -1) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { count } = await supabase
      .from("api_usage")
      .select("*", { count: "exact", head: true })
      .eq("key_id", keyRow.id)
      .gte("timestamp", todayStart.toISOString());

    if ((count ?? 0) >= dailyLimit) {
      return json({ error: "Daily rate limit exceeded.", limit: dailyLimit }, 429);
    }
  }

  // ─── Route parsing ───
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const version = pathParts[1];
  const resource = pathParts[2];
  const resourceId = pathParts[3];

  if (version !== "v1") {
    return json({ error: "Unsupported API version. Use /v1/." }, 400);
  }

  // Validate resourceId if present
  if (resourceId && !validateUuid(resourceId, "resourceId")) {
    return json({ error: "Invalid resource ID format." }, 400);
  }

  const userId = keyRow.user_id;

  const logUsage = async (endpoint: string, method: string, statusCode: number) => {
    await supabase.from("api_usage").insert({
      key_id: keyRow.id,
      endpoint: sanitizeString(endpoint, 200),
      method,
      status_code: statusCode,
    });
  };

  try {
    // ─── /v1/cases ───
    if (resource === "cases") {
      if (req.method === "GET" && !resourceId) {
        const { data, error } = await supabase
          .from("cases")
          .select("id, title, description, created_at")
          .eq("owner_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        await logUsage("/v1/cases", "GET", error ? 500 : 200);
        if (error) return json({ error: error.message }, 500);
        return json({ data });
      }

      if (req.method === "GET" && resourceId) {
        const { data, error } = await supabase
          .from("cases")
          .select("id, title, description, created_at")
          .eq("id", resourceId)
          .eq("owner_id", userId)
          .single();

        await logUsage(`/v1/cases/${resourceId}`, "GET", error ? 404 : 200);
        if (error) return json({ error: "Case not found." }, 404);
        return json({ data });
      }
    }

    // ─── /v1/subjects ───
    if (resource === "subjects" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body) {
        await logUsage("/v1/subjects", "POST", 400);
        return json({ error: "Invalid or oversized request body." }, 400);
      }

      const case_id = validateUuid(body.case_id, "case_id");
      const name = sanitizeString(body.name, 200);
      const type = sanitizeString(body.type, 50);
      const notes = sanitizeString(body.notes, 2000);

      if (!case_id || !name || !type) {
        await logUsage("/v1/subjects", "POST", 400);
        return json({ error: "case_id (uuid), name, and type are required." }, 400);
      }

      const { data: caseData } = await supabase
        .from("cases")
        .select("id")
        .eq("id", case_id)
        .eq("owner_id", userId)
        .single();

      if (!caseData) {
        await logUsage("/v1/subjects", "POST", 403);
        return json({ error: "Case not found or access denied." }, 403);
      }

      const { data, error } = await supabase
        .from("subjects")
        .insert({ case_id, name, type, notes: notes || null })
        .select()
        .single();

      await logUsage("/v1/subjects", "POST", error ? 500 : 201);
      if (error) return json({ error: error.message }, 500);
      return json({ data }, 201);
    }

    // ─── /v1/tools/run ───
    if (resource === "tools" && pathParts[3] === "run" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body) {
        await logUsage("/v1/tools/run", "POST", 400);
        return json({ error: "Invalid or oversized request body." }, 400);
      }

      const tool_name = sanitizeString(body.tool_name, 100);
      const case_id = body.case_id ? validateUuid(body.case_id, "case_id") : null;

      if (!tool_name) {
        await logUsage("/v1/tools/run", "POST", 400);
        return json({ error: "tool_name is required." }, 400);
      }

      if (body.case_id && !case_id) {
        await logUsage("/v1/tools/run", "POST", 400);
        return json({ error: "Invalid case_id format." }, 400);
      }

      if (case_id) {
        const { data: caseData } = await supabase
          .from("cases")
          .select("id")
          .eq("id", case_id)
          .eq("owner_id", userId)
          .single();

        if (!caseData) {
          await logUsage("/v1/tools/run", "POST", 403);
          return json({ error: "Case not found or access denied." }, 403);
        }
      }

      // Validate input object size
      const input = typeof body.input === "object" && body.input !== null ? body.input : {};
      if (Object.keys(input as Record<string, unknown>).length > 20) {
        await logUsage("/v1/tools/run", "POST", 400);
        return json({ error: "Too many input fields (max 20)." }, 400);
      }

      const { data, error } = await supabase
        .from("tool_results")
        .insert({
          tool_name,
          case_id: case_id ?? null,
          user_id: userId,
          result_data: { status: "queued", input },
        })
        .select()
        .single();

      await logUsage("/v1/tools/run", "POST", error ? 500 : 202);
      if (error) return json({ error: error.message }, 500);
      return json({ data, message: "Tool execution queued." }, 202);
    }

    // ─── /v1/reports ───
    if (resource === "reports") {
      if (req.method === "GET" && !resourceId) {
        const caseId = url.searchParams.get("case_id");
        if (caseId && !validateUuid(caseId, "case_id")) {
          return json({ error: "Invalid case_id format." }, 400);
        }

        let query = supabase
          .from("reports")
          .select("id, case_id, report_type, format, file_size, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (caseId) query = query.eq("case_id", caseId);
        const { data, error } = await query;

        await logUsage("/v1/reports", "GET", error ? 500 : 200);
        if (error) return json({ error: error.message }, 500);
        return json({ data });
      }

      if (req.method === "GET" && resourceId) {
        const { data, error } = await supabase
          .from("reports")
          .select("*")
          .eq("id", resourceId)
          .eq("user_id", userId)
          .single();

        await logUsage(`/v1/reports/${resourceId}`, "GET", error ? 404 : 200);
        if (error) return json({ error: "Report not found." }, 404);
        return json({ data });
      }
    }

    // ─── /v1/artifacts ───
    if (resource === "artifacts" && req.method === "GET") {
      const caseId = url.searchParams.get("case_id");
      if (!caseId || !validateUuid(caseId, "case_id")) {
        await logUsage("/v1/artifacts", "GET", 400);
        return json({ error: "Valid case_id query parameter required." }, 400);
      }

      const { data: caseData } = await supabase
        .from("cases")
        .select("id")
        .eq("id", caseId)
        .eq("owner_id", userId)
        .single();

      if (!caseData) {
        await logUsage("/v1/artifacts", "GET", 403);
        return json({ error: "Case not found or access denied." }, 403);
      }

      const { data, error } = await supabase
        .from("artifacts")
        .select("id, artifact_type, data, created_at")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });

      await logUsage("/v1/artifacts", "GET", error ? 500 : 200);
      if (error) return json({ error: error.message }, 500);
      return json({ data });
    }

    // ─── /v1/entities ───
    if (resource === "entities" && req.method === "GET") {
      const entityType = url.searchParams.get("type");
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

      let query = supabase
        .from("identity_entities")
        .select("id, entity_type, entity_value, confidence_score, source_tool, source_case_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (entityType) query = query.eq("entity_type", sanitizeString(entityType, 50));

      const { data, error } = await query;
      await logUsage("/v1/entities", "GET", error ? 500 : 200);
      if (error) return json({ error: error.message }, 500);
      return json({ data, count: data?.length ?? 0 });
    }

    // ─── /v1/entities/:id ───
    if (resource === "entities" && req.method === "GET" && resourceId) {
      const { data, error } = await supabase
        .from("identity_entities")
        .select("*")
        .eq("id", resourceId)
        .eq("user_id", userId)
        .single();

      await logUsage(`/v1/entities/${resourceId}`, "GET", error ? 404 : 200);
      if (error) return json({ error: "Entity not found." }, 404);
      return json({ data });
    }

    // ─── /v1/relationships ───
    if (resource === "relationships" && req.method === "GET") {
      const entityId = url.searchParams.get("entity_id");
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

      let query = supabase
        .from("identity_entity_links")
        .select("id, source_entity_id, target_entity_id, relationship_type, confidence_score, evidence, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (entityId) {
        if (!validateUuid(entityId, "entity_id")) {
          await logUsage("/v1/relationships", "GET", 400);
          return json({ error: "Invalid entity_id format." }, 400);
        }
        query = query.or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`);
      }

      const { data, error } = await query;
      await logUsage("/v1/relationships", "GET", error ? 500 : 200);
      if (error) return json({ error: error.message }, 500);
      return json({ data, count: data?.length ?? 0 });
    }

    // ─── /v1/graph ───
    if (resource === "graph" && req.method === "GET") {
      const caseId = url.searchParams.get("case_id");

      // Get entities
      let entQuery = supabase
        .from("identity_entities")
        .select("id, entity_type, entity_value, confidence_score")
        .eq("user_id", userId);
      if (caseId) {
        if (!validateUuid(caseId, "case_id")) {
          await logUsage("/v1/graph", "GET", 400);
          return json({ error: "Invalid case_id format." }, 400);
        }
        entQuery = entQuery.eq("source_case_id", caseId);
      }
      const { data: entities } = await entQuery.limit(200);

      // Get links
      const entityIds = (entities ?? []).map((e: any) => e.id);
      let edges: any[] = [];
      if (entityIds.length > 0) {
        const { data: links } = await supabase
          .from("identity_entity_links")
          .select("id, source_entity_id, target_entity_id, relationship_type, confidence_score")
          .eq("user_id", userId)
          .or(entityIds.map((id: string) => `source_entity_id.eq.${id}`).join(","))
          .limit(500);
        edges = links ?? [];
      }

      // Get scores
      let scoreMap: Record<string, number> = {};
      if (entityIds.length > 0) {
        const { data: scores } = await supabase
          .from("entity_scores")
          .select("entity_id, score")
          .eq("user_id", userId)
          .in("entity_id", entityIds.slice(0, 200));
        for (const s of scores ?? []) scoreMap[s.entity_id] = Number(s.score);
      }

      const nodes = (entities ?? []).map((e: any) => ({
        id: e.id,
        type: e.entity_type,
        value: e.entity_value,
        confidence: e.confidence_score,
        risk_score: scoreMap[e.id] ?? null,
      }));

      await logUsage("/v1/graph", "GET", 200);
      return json({ nodes, edges, node_count: nodes.length, edge_count: edges.length });
    }

    // ─── /v1/scores ───
    if (resource === "scores" && req.method === "GET") {
      const entityId = url.searchParams.get("entity_id");
      const minScore = parseFloat(url.searchParams.get("min_score") ?? "0");
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

      let query = supabase
        .from("entity_scores")
        .select("id, entity_id, score, linked_identifiers, case_appearances, infrastructure_overlap, relationship_density, score_reasons, updated_at, entity:identity_entities!entity_scores_entity_id_fkey(entity_type, entity_value)")
        .eq("user_id", userId)
        .gte("score", minScore)
        .order("score", { ascending: false })
        .limit(limit);

      if (entityId) {
        if (!validateUuid(entityId, "entity_id")) {
          await logUsage("/v1/scores", "GET", 400);
          return json({ error: "Invalid entity_id format." }, 400);
        }
        query = query.eq("entity_id", entityId);
      }

      const { data, error } = await query;
      await logUsage("/v1/scores", "GET", error ? 500 : 200);
      if (error) return json({ error: error.message }, 500);
      return json({ data, count: data?.length ?? 0 });
    }

    // ─── /v1/analysis ───
    if (resource === "analysis" && req.method === "GET") {
      const caseId = url.searchParams.get("case_id");
      if (!caseId || !validateUuid(caseId, "case_id")) {
        await logUsage("/v1/analysis", "GET", 400);
        return json({ error: "Valid case_id query parameter required." }, 400);
      }

      const { data: caseData } = await supabase
        .from("cases")
        .select("id")
        .eq("id", caseId)
        .eq("owner_id", userId)
        .single();

      if (!caseData) {
        await logUsage("/v1/analysis", "GET", 403);
        return json({ error: "Case not found or access denied." }, 403);
      }

      const { data, error } = await supabase
        .from("analysis_reports")
        .select("id, analysis_type, generated_summary, key_findings, key_relationships, suspicious_patterns, narrative_draft, model_used, created_at")
        .eq("case_id", caseId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      await logUsage("/v1/analysis", "GET", error ? 500 : 200);
      if (error) return json({ error: error.message }, 500);
      return json({ data, count: data?.length ?? 0 });
    }

    // ─── /v1/breaches ───
    if (resource === "breaches" && req.method === "GET") {
      const entityId = url.searchParams.get("entity_id");
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

      let query = supabase
        .from("breach_records")
        .select("id, entity_id, breach_source, breach_date, severity, data_exposed, credential_leaked, password_reuse_detected, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (entityId) {
        if (!validateUuid(entityId, "entity_id")) {
          await logUsage("/v1/breaches", "GET", 400);
          return json({ error: "Invalid entity_id format." }, 400);
        }
        query = query.eq("entity_id", entityId);
      }

      const { data, error } = await query;
      await logUsage("/v1/breaches", "GET", error ? 500 : 200);
      if (error) return json({ error: error.message }, 500);
      return json({ data, count: data?.length ?? 0 });
    }

    await logUsage(url.pathname, req.method, 404);
    return json({ error: "Endpoint not found.", available: [
      "GET /v1/cases",
      "GET /v1/cases/:id",
      "POST /v1/subjects",
      "POST /v1/tools/run",
      "GET /v1/reports",
      "GET /v1/reports/:id",
      "GET /v1/artifacts?case_id=",
      "GET /v1/entities",
      "GET /v1/entities/:id",
      "GET /v1/relationships?entity_id=",
      "GET /v1/graph?case_id=",
      "GET /v1/scores?min_score=&entity_id=",
      "GET /v1/analysis?case_id=",
      "GET /v1/breaches?entity_id=",
    ]}, 404);

  } catch (err) {
    await logUsage(url.pathname, req.method, 500);
    return json({ error: "Internal server error." }, 500);
  }
});
