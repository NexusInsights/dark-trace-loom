import type { ToolDefinition, ToolResult } from "./types";

export type ExecutionStatus = NonNullable<ToolResult["status"]>;
export class ToolExecutionError extends Error {
  constructor(message: string, public readonly status: ExecutionStatus = "error") { super(message); }
}
export function mapToolInputs(tool: ToolDefinition, params: Record<string, unknown>): Record<string, string> {
  const aliases: Record<string, string[]> = { username: ["target"], domain: ["target", "host"], user: ["username", "target"], email: ["query", "identifier", "target"], ip: ["target"], host: ["domain", "target"] };
  const inputs: Record<string, string> = {};
  for (const field of tool.fields) {
    const value = params[field.key] ?? aliases[field.key]?.map(key => params[key]).find(item => item != null) ?? (field.type === "select" ? field.options?.[0]?.value : undefined);
    if (value == null) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) throw new ToolExecutionError("Invalid " + field.key + ": expected a scalar value");
    const text = field.type === "file" ? String(value) : String(value).trim();
    if (field.type === "file") {
      const limit = field.maxFileBytes ?? 8 * 1024 * 1024;
      if (field.fileEncoding === "text" ? new TextEncoder().encode(text).byteLength > limit : text.length > Math.ceil(limit / 3) * 4 + 4) throw new ToolExecutionError("File input exceeds its byte limit");
    } else if (text.length > 50000) throw new ToolExecutionError("Input exceeds 50,000 characters");
    inputs[field.key] = text;
    if (field.filenameKey && params[field.filenameKey] != null) {
      const name = params[field.filenameKey];
      if (typeof name !== "string" || name.length > 1000) throw new ToolExecutionError("Invalid filename metadata");
      inputs[field.filenameKey] = name;
    }
  }
  return inputs;
}

export function assertToolResult(result: ToolResult): void {
  if (!result || typeof result.summary !== "string" || !result.summary || !result.details || typeof result.details !== "object" || Array.isArray(result.details)) throw new Error("Tool returned no usable result");
  const explicitStatus = (result as ToolResult & { status?: unknown }).status;
  if (explicitStatus !== undefined && (typeof explicitStatus !== "string" || !["success", "partial", "error", "not_configured", "unknown_tool", "demo"].includes(explicitStatus))) throw new Error("Invalid tool execution status");
  const status = String(explicitStatus ?? result.details.status).toLowerCase();
  if (result.tags?.some(tag => ["error", "not-configured", "not_configured", "unavailable"].includes(tag)) || ["error", "not_configured", "unknown_tool", "failed"].includes(String(status))) {
    throw new Error(String(result.details.reason || result.details.error || result.summary));
  }
  if (result.details.error) throw new Error(String(result.details.error));
}
export async function executeTool(tool: ToolDefinition, params: Record<string, unknown>): Promise<ToolResult> {
  const inputs = mapToolInputs(tool, params);
  for (const field of tool.fields) {
    if (field.required && !inputs[field.key]?.trim()) throw new Error(`${tool.name}: ${field.label} is required`);
    if (field.options && inputs[field.key] && !field.options.some(option => option.value === inputs[field.key])) throw new Error(`${tool.name}: invalid ${field.label}`);
  }
  const result = await tool.process(inputs);
  assertToolResult(result);
  const explicitStatus = (result as ToolResult & { status?: unknown }).status;
  const demo = explicitStatus === "demo" || result.details.status === "demo" || result.details.demo === true || result.tags?.some(tag => ["demo", "mock", "simulated"].includes(tag));
  const statuses: ExecutionStatus[] = ["success", "partial", "error", "not_configured", "unknown_tool", "demo"];
  const status: ExecutionStatus = demo ? "demo" : explicitStatus as ExecutionStatus ?? (statuses.includes(result.details.status as ExecutionStatus) ? result.details.status as ExecutionStatus : "success");
  return { ...result, status, ...(demo && !/^DEMO\b/.test(result.summary) ? { summary: "DEMO - " + result.summary } : {}) };
}
