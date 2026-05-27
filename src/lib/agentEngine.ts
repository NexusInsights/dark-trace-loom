import { supabase } from "@/integrations/supabase/client";
import { allTools } from "@/components/tools/toolDefinitions";
import type { ToolResult } from "@/components/tools/types";
import type { Json } from "@/integrations/supabase/types";

export interface AgentStepResult {
  toolId: string;
  toolName: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: ToolResult;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentRunState {
  runId: string;
  status: "pending" | "running" | "completed" | "failed";
  steps: AgentStepResult[];
}

// Default OSINT investigation sequence
export const DEFAULT_TOOL_SEQUENCE = [
  "username-search",
  "domain-intel",
  "email-header-analysis",
  "image-metadata",
];

// Built-in agent templates
export const AGENT_TEMPLATES = [
  {
    name: "Full OSINT Sweep",
    description: "Run all OSINT tools sequentially: username search, domain lookup, email analysis, and image metadata extraction.",
    toolSequence: DEFAULT_TOOL_SEQUENCE,
  },
  {
    name: "Identity Recon",
    description: "Focus on identity-related intelligence: username search across platforms and email header analysis.",
    toolSequence: ["username-search", "email-header-analysis"],
  },
  {
    name: "Domain Recon",
    description: "Focused domain investigation: domain intelligence and site mapping.",
    toolSequence: ["domain-intel"],
  },
];

/**
 * Maps an input subject to tool-specific inputs.
 * The agent is designed to work with a single subject string that gets
 * routed to each tool's required fields.
 */
function buildToolInputs(toolId: string, subject: string): Record<string, string> {
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
      return { input: subject };
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
  await supabase
    .from("agent_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId);

  onProgress({ ...state });

  for (let i = 0; i < toolSequence.length; i++) {
    const toolId = toolSequence[i];
    const tool = allTools.find((t) => t.id === toolId);

    steps[i].status = "running";
    steps[i].startedAt = new Date().toISOString();
    onProgress({ ...state, steps: [...steps] });

    if (!tool) {
      steps[i].status = "failed";
      steps[i].error = `Tool "${toolId}" not found`;
      steps[i].completedAt = new Date().toISOString();
      onProgress({ ...state, steps: [...steps] });
      continue;
    }

    try {
      const inputs = buildToolInputs(toolId, subject);
      const result = await tool.process(inputs);
      steps[i].status = "completed";
      steps[i].result = result;
      steps[i].completedAt = new Date().toISOString();

      // Save finding as artifact if case is linked
      if (caseId) {
        await supabase.from("artifacts").insert({
          case_id: caseId,
          artifact_type: `agent:${toolId}`,
          data: JSON.stringify({ tool: toolId, subject, ...result }),
        });
      }
    } catch (err) {
      steps[i].status = "failed";
      steps[i].error = err instanceof Error ? err.message : "Unknown error";
      steps[i].completedAt = new Date().toISOString();
    }

    onProgress({ ...state, steps: [...steps] });

    // Brief pause between tools
    if (i < toolSequence.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const allCompleted = steps.every((s) => s.status === "completed");
  const anyFailed = steps.some((s) => s.status === "failed");
  state.status = allCompleted ? "completed" : anyFailed ? "failed" : "completed";

  // Update run record
  await supabase
    .from("agent_runs")
    .update({
      status: state.status,
      results: steps.map((s) => ({
        toolId: s.toolId,
        toolName: s.toolName,
        status: s.status,
        summary: s.result?.summary ?? s.error ?? null,
        tags: s.result?.tags ?? [],
      })) as unknown as Json,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  onProgress({ ...state });
  return state;
}
