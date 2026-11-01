import { beforeEach, describe, expect, it, vi } from "vitest";
import { runIntelligenceAction, IntelligenceRequestError } from "./api";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

describe("intelligence frontend API", () => {
  beforeEach(() => invoke.mockReset());

  it.each(["ipinfo", "breach", "profile", "onion"] as const)("uses the existing authenticated Supabase adapter for %s", async (action) => {
    invoke.mockResolvedValue({ data: { ok: true, data: { source: "isolated fixture" } }, error: null });
    expect(await runIntelligenceAction(action, { value: "fixture" })).toEqual({ source: "isolated fixture" });
    expect(invoke).toHaveBeenCalledWith("intelligence-tools", { body: { action, input: { value: "fixture" } } });
  });

  it("displays structured non-2xx errors and retry information", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: "Try later.", retryAfter: 7 } }), { status: 429 }) } });
    await expect(runIntelligenceAction("breach", { email: "fixture@example.com" })).rejects.toThrow("Retry after 7 seconds");
  });

  it("rejects malformed success responses", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(runIntelligenceAction("ipinfo", { ip: "8.8.8.8" })).rejects.toBeInstanceOf(IntelligenceRequestError);
  });
});
