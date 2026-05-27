import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    const { case_id, analysis_type = "full" } = await req.json();
    if (!case_id) {
      return new Response(JSON.stringify({ error: "case_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch case data using the user's auth context (RLS enforced)
    const [caseRes, subjectsRes, artifactsRes, eventsRes, entitiesRes, relationshipsRes] = await Promise.all([
      supabase.from("cases").select("*").eq("id", case_id).single(),
      supabase.from("subjects").select("*").eq("case_id", case_id),
      supabase.from("artifacts").select("*").eq("case_id", case_id),
      supabase.from("events").select("*").eq("case_id", case_id).order("timestamp"),
      supabase.from("entities").select("*").eq("case_id", case_id),
      supabase.from("entity_relationships").select("*").eq("case_id", case_id),
    ]);

    if (caseRes.error) {
      return new Response(JSON.stringify({ error: "Case not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const caseData = caseRes.data;
    const subjects = subjectsRes.data ?? [];
    const artifacts = artifactsRes.data ?? [];
    const events = eventsRes.data ?? [];
    const entities = entitiesRes.data ?? [];
    const relationships = relationshipsRes.data ?? [];

    // Build context for AI
    const investigationContext = `
INVESTIGATION: "${caseData.title}"
Description: ${caseData.description ?? "None"}
Created: ${caseData.created_at}

SUBJECTS (${subjects.length}):
${subjects.map((s: any) => `- ${s.name} (${s.type})${s.notes ? `: ${s.notes}` : ""}`).join("\n") || "None"}

ARTIFACTS (${artifacts.length}):
${artifacts.map((a: any) => `- [${a.artifact_type}] ${(a.data ?? "").substring(0, 500)}`).join("\n") || "None"}

TIMELINE EVENTS (${events.length}):
${events.map((e: any) => `- [${e.timestamp ?? "no date"}] ${e.event_type}: ${e.description ?? ""}`).join("\n") || "None"}

ENTITIES (${entities.length}):
${entities.map((e: any) => `- ${e.label} (${e.entity_type})`).join("\n") || "None"}

RELATIONSHIPS (${relationships.length}):
${relationships.map((r: any) => `- ${r.source_id} → ${r.relationship_type} → ${r.target_id} (confidence: ${r.confidence})`).join("\n") || "None"}
`.trim();

    const systemPrompt = `You are an expert OSINT intelligence analyst. Analyze the following investigation data and produce a structured analysis report.

You must call the "produce_analysis" tool with your findings. Be thorough, specific, and cite evidence from the data provided.

For suspicious_patterns: identify anomalies, contradictions, temporal inconsistencies, or indicators of deception/fraud.
For key_relationships: highlight important connections between subjects, entities, and artifacts.
For narrative_draft: write a professional investigative narrative suitable for a legal or compliance report.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: investigationContext },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "produce_analysis",
              description: "Produce a structured investigation analysis report.",
              parameters: {
                type: "object",
                properties: {
                  summary: {
                    type: "string",
                    description: "Executive summary of the investigation findings (2-4 paragraphs).",
                  },
                  key_findings: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        finding: { type: "string" },
                        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                        evidence: { type: "string" },
                      },
                      required: ["finding", "severity", "evidence"],
                      additionalProperties: false,
                    },
                  },
                  suspicious_patterns: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        pattern: { type: "string" },
                        indicators: { type: "string" },
                        risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
                      },
                      required: ["pattern", "indicators", "risk_level"],
                      additionalProperties: false,
                    },
                  },
                  key_relationships: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        from_entity: { type: "string" },
                        to_entity: { type: "string" },
                        relationship: { type: "string" },
                        significance: { type: "string" },
                      },
                      required: ["from_entity", "to_entity", "relationship", "significance"],
                      additionalProperties: false,
                    },
                  },
                  narrative_draft: {
                    type: "string",
                    description: "Professional investigative narrative report draft.",
                  },
                },
                required: ["summary", "key_findings", "suspicious_patterns", "key_relationships", "narrative_draft"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "produce_analysis" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "AI rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", status, errText);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await aiResponse.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "AI did not produce structured output" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const analysis = JSON.parse(toolCall.function.arguments);

    // Save to database using service role for insert
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: report, error: insertError } = await adminClient
      .from("analysis_reports")
      .insert({
        case_id,
        user_id: userId,
        analysis_type,
        generated_summary: analysis.summary,
        key_findings: analysis.key_findings,
        suspicious_patterns: analysis.suspicious_patterns,
        key_relationships: analysis.key_relationships,
        narrative_draft: analysis.narrative_draft,
        model_used: "google/gemini-3-flash-preview",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to save analysis report" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ data: report }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-case error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
