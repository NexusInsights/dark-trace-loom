import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { allTools } from "@/components/tools/toolDefinitions";
import { executeOutcome, runStatus, failureReason, type OutcomeStatus, type RunStatus } from "@/lib/toolOutcome";
import type { ToolResult } from "@/components/tools/types";
import type { Json } from "@/integrations/supabase/types";
import { mapToolInputs } from "@/components/tools/executeTool";
import { assertToolResultOwnership } from "@/lib/ownedToolResults";
import { assertToolPermission } from "@/lib/toolPermission";

export interface AgentStepResult {
  toolId: string;
  toolName: string;
  status: "pending" | "running" | "completed" | "failed" | Exclude<OutcomeStatus, "success">;
  result?: ToolResult;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentRunState {
  runId: string;
  status: "pending" | "running" | RunStatus;
  steps: AgentStepResult[];
}

// Default OSINT investigation sequence
export const DEFAULT_TOOL_SEQUENCE = [
  "username-search",
];


/**
 * Maps an input subject to tool-specific inputs.
 * The agent is designed to work with a single subject string that gets
 * routed to each tool's required fields.
 */
export function buildToolInputs(toolId: string, subject: string): Record<string, string> {
  if (subject.trim().startsWith("{")) {
    let parsed: unknown;
    try { parsed = JSON.parse(subject); } catch { throw new Error("Agent subject contains invalid JSON inputs"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Agent JSON inputs must be an object");
    const perTool = (parsed as Record<string,unknown>)[toolId];
    const fields = perTool && typeof perTool === "object" && !Array.isArray(perTool) ? perTool : parsed;
    const tool = allTools.find(candidate => candidate.id === toolId);
    if (!tool) throw new Error("Unsupported tool ID");
    return mapToolInputs(tool, fields as Record<string, unknown>);
  }
  switch (toolId) {
    case "username-search":
      return { username: subject };
    case "domain-intel":
      return { domain: subject };
    case "email-header-analysis":
      return { headers: subject };
    case "image-metadata":
      return { image_url: subject, notes: "Auto-collected by investigation agent" };
    case "timestamp-decoder":
      return { timestamp: subject, format: "auto" };
    default:
      { const tool = allTools.find(t => t.id === toolId); const required = tool?.fields.filter(f => f.required) || [];
        if (required.length !== 1) throw new Error(`${tool?.name || toolId} needs named JSON inputs for its required fields`);
        return { [required[0].key]: subject, ...Object.fromEntries((tool?.fields || []).filter(f => f.options?.length).map(f => [f.key, f.options![0].value])) };
      }
  }
}

/**
 * Execute an agent run: iterate tools in sequence, collect results,
 * save artifacts to case, and update the agent_runs record.
 */
export async function executeAgentRun(
  runId: string,
  toolSequence: string[],
  subject: string,
  caseId: string | null,
  onProgress: (state: AgentRunState) => void
): Promise<AgentRunState> {
  if (!Array.isArray(toolSequence) || !toolSequence.length || toolSequence.some(id => typeof id !== "string" || !id)) throw new Error("Agent must contain at least one tool ID");
  const auth = await supabase.auth.getUser();
  const userId = auth.data?.user?.id;
  if (auth.error || !userId) throw new Error("A verified user is required for an agent run");
  await assertToolResultOwnership(userId, caseId);
  const existing = await checkedDatabase(supabase.from("agent_runs").select("id,user_id,case_id").eq("id", runId).eq("user_id", userId).single());
  if (existing.error || existing.data?.id !== runId || existing.data.user_id !== userId || (existing.data.case_id ?? null) !== caseId) throw new Error("Agent run ownership could not be verified");
  const steps: AgentStepResult[] = toolSequence.map((toolId) => {
    const tool = allTools.find((t) => t.id === toolId);
    return {
      toolId,
      toolName: tool?.name ?? toolId,
      status: "pending" as const,
    };
  });

  const state: AgentRunState = { runId, status: "running", steps };

  // Mark run as running
  await checkedDatabase(supabase
    .from("agent_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId).eq("user_id", userId));

  onProgress({ ...state });

  for (let i = 0; i < toolSequence.length; i++) {
    const toolId = toolSequence[i];
    const tool = allTools.find((t) => t.id === toolId);

    steps[i].status = "running";
    steps[i].startedAt = new Date().toISOString();
    onProgress({ ...state, steps: [...steps] });

    if (!tool) {
      steps[i].status = "unknown_tool";
      steps[i].error = `Tool "${toolId}" not found`;
      steps[i].completedAt = new Date().toISOString();
      onProgress({ ...state, steps: [...steps] });
      continue;
    }

    try {
      await assertToolPermission(userId, tool.id);
      const inputs = buildToolInputs(toolId, subject);
      const result = await executeOutcome(tool, inputs);
      steps[i].status = result.status === "success" ? "completed" : result.status;
      steps[i].result = result;
      steps[i].completedAt = new Date().toISOString();

      // Save finding as artifact if case is linked
      if (result.status === "success" && caseId) {
        await assertToolResultOwnership(userId, caseId);
        const saved = await checkedDatabase(supabase.from("artifacts").insert({
          case_id: caseId,
          artifact_type: `agent:${toolId}`,
          data: JSON.stringify({ tool: toolId, subject, ...result }),
        }));
        if (saved.error) throw new Error(`Tool succeeded, but evidence could not be saved: ${saved.error.message}`);
      }
    } catch (err) {
      steps[i].status = "failed";
      steps[i].error = failureReason(err, "Unknown error");
      steps[i].completedAt = new Date().toISOString();
    }

    onProgress({ ...state, steps: [...steps] });

    // Brief pause between tools
    if (i < toolSequence.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  state.status = runStatus(steps.map(step => step.status));

  // Update run record
  await checkedDatabase(supabase
    .from("agent_runs")
    .update({
      status: state.status,
      results: steps.map((s) => ({
        toolId: s.toolId,
        toolName: s.toolName,
        status: s.status,
        summary: s.result?.summary ?? s.error ?? null,
        tags: s.result?.tags ?? [],
        details: s.result?.details ?? null,
      })) as unknown as Json,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId).eq("user_id", userId));

  onProgress({ ...state });
  return state;
}
