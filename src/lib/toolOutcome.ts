import { executeTool } from "@/components/tools/executeTool";
import type { ToolDefinition, ToolResult } from "@/components/tools/types";

export type OutcomeStatus = "success" | "partial" | "demo" | "error" | "not_configured" | "unknown_tool";
export type RunStatus = "completed" | "partial" | "demo" | "failed" | "not_configured";
export type Outcome = ToolResult & { status: OutcomeStatus };
const statuses: OutcomeStatus[] = ["success", "partial", "demo", "error", "not_configured", "unknown_tool"];
export function failureReason(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim() ? error.message.slice(0, 1000) : fallback;
}

// Keep the owner's throwing/manual interface and file validation. Automated
// consumers receive a truthful outcome before deciding whether to save evidence.
export async function executeOutcome(tool: ToolDefinition, inputs: Record<string, unknown>): Promise<Outcome> {
  let raw: ToolResult | undefined;
  try {
    const result = await executeTool({ ...tool, process: async values => { raw = await tool.process(values); return raw; } }, inputs);
    if (!result || typeof result.summary !== "string" || !result.details || typeof result.details !== "object" || Array.isArray(result.details)) throw new Error("Invalid tool result");
    const explicit = (result as ToolResult & { status?: unknown }).status;
    if (explicit !== undefined && !statuses.includes(explicit as OutcomeStatus)) throw new Error("Invalid tool execution status");
    const detailStatus = result.details.status;
    const demo = explicit === "demo" || detailStatus === "demo" || result.details.demo === true || result.tags?.some(tag => ["demo", "mock", "simulated"].includes(tag));
    const status: OutcomeStatus = demo ? "demo" : explicit as OutcomeStatus ?? (statuses.includes(detailStatus as OutcomeStatus) ? detailStatus as OutcomeStatus : "success");
    return { ...result, status, ...(demo && !/^DEMO\b/.test(result.summary) ? { summary: "DEMO - " + result.summary } : {}) };
  } catch (error) {
    const errorStatus = error && typeof error === "object" && "status" in error ? error.status : undefined;
    const value = errorStatus ?? (raw as (ToolResult & { status?: unknown }) | undefined)?.status ?? raw?.details?.status;
    const status = value === "not_configured" || value === "unknown_tool" ? value : "error";
    const reason = failureReason(error, "Tool execution failed");
    return { status, summary: reason, details: { status, reason } };
  }
}

export function runStatus(values: string[]): RunStatus {
  if (values.length && values.every(status => status === "success" || status === "completed")) return "completed";
  if (values.length && values.every(status => status === "demo")) return "demo";
  if (values.length && values.every(status => status === "not_configured")) return "not_configured";
  if (values.some(status => ["success", "completed", "partial"].includes(status))) return "partial";
  return "failed";
}

export function pipelineNotice(result: { status: RunStatus; artifactsCreated: number; entitiesLinked: number }) {
  const counts = `${result.artifactsCreated} artifacts created, ${result.entitiesLinked} entities linked`;
  if (result.status === "completed") return { kind: "success" as const, message: "Pipeline complete: " + counts };
  if (result.status === "failed") return { kind: "error" as const, message: "Pipeline failed; see run history. " + counts };
  return { kind: "warning" as const, message: (result.status === "demo" ? "DEMO pipeline" : result.status === "not_configured" ? "Pipeline not configured" : "Pipeline partially complete") + ": " + counts };
}
