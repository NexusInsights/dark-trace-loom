import { supabase } from "@/integrations/supabase/client";

export interface PipelineConfig {
  id?: string;
  name: string;
  description?: string;
  schedule: string;
  tool_sequence: string[];
  target_case_id?: string | null;
  input_params?: Record<string, unknown>;
}

const PIPELINE_TEMPLATES: PipelineConfig[] = [
  {
    name: "Username Presence Scan",
    description: "Scan for username presence across platforms and link discovered accounts to entity records.",
    schedule: "daily",
    tool_sequence: ["username_search", "social_analyzer"],
  },
  {
    name: "Domain Infrastructure Scan",
    description: "Analyze domain WHOIS, DNS, and subdomains to map infrastructure relationships.",
    schedule: "weekly",
    tool_sequence: ["domain_whois", "dns_lookup", "subdomain_finder"],
  },
  {
    name: "Email Breach Check",
    description: "Check email addresses against breach databases and flag compromised accounts.",
    schedule: "daily",
    tool_sequence: ["email_validator", "breach_search"],
  },
  {
    name: "Social Profile Discovery",
    description: "Discover social media profiles linked to target identifiers.",
    schedule: "weekly",
    tool_sequence: ["username_search", "social_analyzer", "reverse_image"],
  },
];

export function getPipelineTemplates(): PipelineConfig[] {
  return PIPELINE_TEMPLATES;
}

export async function executePipeline(
  pipelineId: string,
  userId: string,
  onProgress?: (step: string, index: number, total: number) => void
): Promise<{ runId: string; artifactsCreated: number; entitiesLinked: number }> {
  // Fetch pipeline
  const { data: pipeline, error: pErr } = await supabase
    .from("pipelines")
    .select("*")
    .eq("id", pipelineId)
    .single();

  if (pErr || !pipeline) throw new Error("Pipeline not found");

  // Create run record
  const { data: run, error: rErr } = await supabase
    .from("pipeline_runs")
    .insert({
      pipeline_id: pipelineId,
      user_id: userId,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (rErr || !run) throw new Error("Failed to create pipeline run");

  const tools = pipeline.tool_sequence as string[];
  const results: Record<string, unknown>[] = [];
  let artifactsCreated = 0;
  let entitiesLinked = 0;

  try {
    for (let i = 0; i < tools.length; i++) {
      const toolName = tools[i];
      onProgress?.(toolName, i, tools.length);

      // Real dispatch — calls actual APIs or returns honest not_configured / error / unknown_tool.
      const { data, error } = await supabase.functions.invoke("osint-dispatch", {
        body: {
          tool: toolName,
          params: (pipeline.input_params as Record<string, unknown> | null) ?? {},
          case_id: pipeline.target_case_id ?? null,
        },
      });

      const toolResult: Record<string, unknown> = error
        ? { status: "error", reason: error.message }
        : (data as Record<string, unknown>);

      results.push({ tool: toolName, ...toolResult });

      // osint-dispatch already persists to tool_results with the correct status.
      if (toolResult.status === "success") artifactsCreated++;

      // Entity extraction: only auto-link entities the real dispatcher explicitly returns.
      // Each tool's success payload may include entities: [{ type, value }, ...]; if the real
      // API response doesn't include them, no entities are fabricated here.
      const successResult = toolResult.status === "success" ? toolResult.result as Record<string, unknown> | undefined : undefined;
      const entitiesArr = successResult && Array.isArray((successResult as { entities?: unknown }).entities)
        ? (successResult as { entities: Array<{ type: string; value: string }> }).entities
        : [];
      for (const entity of entitiesArr) {
        if (!entity?.type || !entity?.value) continue;
        const { data: existing } = await supabase
          .from("identity_entities")
          .select("id")
          .eq("user_id", userId)
          .eq("entity_type", entity.type)
          .eq("entity_value", entity.value)
          .maybeSingle();

        let entityId = existing?.id;
        if (!entityId) {
          const { data: created } = await supabase
            .from("identity_entities")
            .insert({
              user_id: userId,
              entity_type: entity.type,
              entity_value: entity.value,
              source_tool: toolName,
              source_case_id: pipeline.target_case_id ?? null,
            })
            .select("id")
            .single();
          entityId = created?.id;
        }

        if (entityId) {
          await supabase.from("entity_observations").insert({
            entity_id: entityId,
            user_id: userId,
            case_id: pipeline.target_case_id ?? null,
            source_tool: `pipeline:${pipeline.name}`,
            observed_value: entity.value,
          });
          entitiesLinked++;
        }
      }
    }

    // Mark run as completed
    await supabase
      .from("pipeline_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        results: results as any,
        artifacts_created: artifactsCreated,
        entities_linked: entitiesLinked,
      })
      .eq("id", run.id);

    // Update pipeline last_run_at
    await supabase
      .from("pipelines")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", pipelineId);

  } catch (err) {
    await supabase
      .from("pipeline_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        errors: [{ message: err instanceof Error ? err.message : "Unknown error" }],
      })
      .eq("id", run.id);
    throw err;
  }

  return { runId: run.id, artifactsCreated, entitiesLinked };
}
