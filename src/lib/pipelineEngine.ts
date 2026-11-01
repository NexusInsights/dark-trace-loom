import { supabase } from "@/integrations/supabase/client";
import { allTools } from "@/components/tools/toolDefinitions";
import { type ExecutionStatus } from "@/components/tools/executeTool";
import type { Json } from "@/integrations/supabase/types";
import { assertToolResultOwnership, saveOwnedToolResult } from "./ownedToolResults";
import { assertToolPermission } from "./toolPermission";
export interface PipelineConfig { id?: string; name: string; description?: string; schedule: string; tool_sequence: string[]; target_case_id?: string | null; input_params?: Record<string, unknown>; }
const ALIASES: Record<string, string> = {
  username_search: "username-search", domain_whois: "whois-history", dns_lookup: "dns-query",
  subdomain_finder: "subdomain-enum", subdomain_enum: "subdomain-enum", ip_geolocation: "ip-geolocation",
  github_recon: "github-recon", breach_search: "breach-lookup", ssl_inspection: "ssl-inspector", asn_lookup: "asn-lookup",
  social_profile_scrape: "social-scrape", person_enrichment_pdl: "pdl-person-enrich", person_search_pdl: "pdl-person-search",
};
export function resolvePipelineTool(id: string) { return allTools.find(tool => tool.id === (ALIASES[id] ?? id)); }
export function getPipelineTemplates(): PipelineConfig[] {
  return [
    { name: "Username Presence Lookup", description: "Check public presence for an exact username.", schedule: "manual", tool_sequence: ["username-search"], input_params: { username: "" } },
    { name: "Domain Infrastructure Lookup", description: "Retrieve current RDAP, DNS and certificate transparency records.", schedule: "manual", tool_sequence: ["whois-history", "dns-query", "subdomain-enum"], input_params: { domain: "" } },
    { name: "Email Breach Lookup", description: "Query the public breach provider; incomplete responses remain explicit.", schedule: "manual", tool_sequence: ["breach-lookup"], input_params: { email: "" } },
  ];
}
import { executeOutcome, runStatus } from "@/lib/toolOutcome";
export type PipelineStatus = "completed" | "partial" | "failed" | "not_configured" | "demo";
export const pipelineStatus = runStatus;
export async function executePipeline(pipelineId: string, userId: string, onProgress?: (step: string, index: number, total: number) => void) {
  await assertToolResultOwnership(userId, null);
  const { data: pipeline, error } = await supabase.from("pipelines").select("*").eq("id", pipelineId).eq("user_id", userId).single();
  if (error || !pipeline) throw new Error(error?.message || "Pipeline not found");
  if (pipeline.user_id !== userId) throw new Error("Pipeline ownership could not be verified");
  const sequence = pipeline.tool_sequence;
  if (!Array.isArray(sequence) || !sequence.length || sequence.some(id => typeof id !== "string")) throw new Error("Pipeline must contain at least one tool ID");
  await assertToolResultOwnership(userId, pipeline.target_case_id ?? null);
  const { data: run, error: runError } = await supabase.from("pipeline_runs").insert({ pipeline_id: pipelineId, user_id: userId, status: "running", started_at: new Date().toISOString() }).select("id").single();
  if (runError || !run) throw new Error(runError?.message || "Failed to create pipeline run");
  const results: Array<{ tool: string; status: ExecutionStatus; summary: string; details: Record<string, unknown> }> = [];
  let artifactsCreated = 0;
  let entitiesLinked = 0;
  try {
    for (const [index, id] of sequence.entries()) {
      const tool = resolvePipelineTool(id);
      onProgress?.(tool?.name ?? id, index, sequence.length);
      let outcome;
      if (!tool) outcome = { status: "unknown_tool" as const, summary: "Unsupported tool ID: " + id, details: { reason: "Edit using current Tool Suite IDs" } };
      else {
        const params = (pipeline.input_params ?? {}) as Record<string, unknown>;
        const selected = params[tool.id] ?? params[id];
        if (selected != null && (typeof selected !== "object" || Array.isArray(selected))) outcome = { status: "error" as const, summary: "Invalid per-tool inputs for " + id, details: {} };
        else {
          try { await assertToolPermission(userId, tool.id); outcome = await executeOutcome(tool, { ...params, ...((selected as Record<string, unknown>) ?? {}) }); }
          catch (error) { outcome = { status: "error" as const, summary: error instanceof Error ? error.message : "Tool permission check failed", details: {} }; }
        }
      }
      let step = { tool: tool?.id ?? id, ...outcome, execution_version: "sourced-v2" };
      try {
        await saveOwnedToolResult({ userId, caseId: pipeline.target_case_id ?? null, toolName: step.tool, status: step.status, resultData: { ...step, pipeline_run_id: run.id } as unknown as Json });
      } catch (failure) { step = { ...step, status: "error", summary: "Result persistence failed: " + (failure instanceof Error ? failure.message : "Ownership or persistence check failed") }; }
      // Count actual confirmed artifact INSERTs only. Incomplete/demo data are not case evidence.
      if (step.status === "success" && pipeline.target_case_id) {
        try {
          await assertToolResultOwnership(userId, pipeline.target_case_id);
          const artifact = await supabase.from("artifacts").insert({ case_id: pipeline.target_case_id, artifact_type: "pipeline:" + step.tool, data: JSON.stringify({ ...step, pipeline_run_id: run.id }) });
          if (artifact.error) throw new Error(artifact.error.message);
          artifactsCreated++;
        } catch (failure) { step = { ...step, status: "error", summary: "Artifact persistence failed: " + (failure instanceof Error ? failure.message : "Ownership or persistence check failed") }; }
      }
      // Preserve the previous explicit entity-link contract; never derive identities from
      // guessed matches or partial provider output.
      if (step.status === "success" && Array.isArray(step.details.entities)) {
        try {
          await assertToolResultOwnership(userId, pipeline.target_case_id ?? null);
          for (const entity of step.details.entities as Array<{ type?: unknown; value?: unknown }>) {
            if (typeof entity?.type !== "string" || typeof entity?.value !== "string" || !entity.type.trim() || !entity.value.trim()) continue;
            const existing = await supabase.from("identity_entities").select("id").eq("user_id", userId).eq("entity_type", entity.type).eq("entity_value", entity.value).maybeSingle();
            if (existing.error) throw new Error(existing.error.message);
            let entityId = existing.data?.id;
            if (!entityId) {
              const created = await supabase.from("identity_entities").insert({ user_id: userId, entity_type: entity.type, entity_value: entity.value, source_tool: step.tool, source_case_id: pipeline.target_case_id ?? null }).select("id").single();
              if (created.error || !created.data) throw new Error(created.error?.message ?? "Entity insert returned no ID");
              entityId = created.data.id;
            }
            const observation = await supabase.from("entity_observations").insert({ entity_id: entityId, user_id: userId, case_id: pipeline.target_case_id ?? null, source_tool: "pipeline:" + step.tool, observed_value: entity.value });
            if (observation.error) throw new Error(observation.error.message);
            entitiesLinked++;
          }
        } catch (error) { step = { ...step, status: "partial", summary: "Entity linkage incomplete: " + (error instanceof Error ? error.message : "Database failure") }; }
      }
      results.push(step);
    }
    const status = pipelineStatus(results.map(step => step.status));
    const errors = results.filter(step => step.status !== "success");
    const saved = await supabase.from("pipeline_runs").update({ status, completed_at: new Date().toISOString(), results: results as unknown as Json, errors: errors as unknown as Json, artifacts_created: artifactsCreated, entities_linked: entitiesLinked }).eq("id", run.id).eq("user_id", userId);
    if (saved.error) throw new Error("Run persistence failed: " + saved.error.message);
    const updated = await supabase.from("pipelines").update({ last_run_at: new Date().toISOString() }).eq("id", pipelineId).eq("user_id", userId);
    return { runId: run.id, status, artifactsCreated, entitiesLinked, ...(updated.error ? { warning: "Last-run timestamp not saved: " + updated.error.message } : {}) };
  } catch (failure) {
    const marked = await supabase.from("pipeline_runs").update({ status: "failed", completed_at: new Date().toISOString(), results: results as unknown as Json, artifacts_created: artifactsCreated, entities_linked: entitiesLinked, errors: [{ message: failure instanceof Error ? failure.message : "Run failed" }] }).eq("id", run.id).eq("user_id", userId);
    if (marked.error) throw new Error("Run failed and its status could not be saved: " + marked.error.message);
    throw failure;
  }
}
