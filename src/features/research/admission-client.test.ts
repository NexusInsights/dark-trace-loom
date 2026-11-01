import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ getSession: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), calls: [] as { name: string; args: Record<string, unknown>; headers: Record<string, string> }[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: h.getSession, getUser: h.getUser }, rpc: h.rpc } }));
import { executeResearchAction } from "./admission-client";
const USER = "11111111-1111-4111-8111-111111111111", ID = "22222222-2222-4222-8222-222222222222", token = "isolated-original-session";
beforeEach(() => {
  vi.clearAllMocks(); h.calls = [];
  h.getSession.mockResolvedValue({ data: { session: { access_token: token, user: { id: USER } } }, error: null });
  h.getUser.mockResolvedValue({ data: { user: { id: USER, role: "authenticated" } }, error: null });
  h.rpc.mockImplementation((name, args) => {
    const call = { name, args, headers: {} as Record<string, string> }; h.calls.push(call);
    const builder = { setHeader: vi.fn((key, value) => { call.headers[key] = value; return builder; }), abortSignal: vi.fn(() => builder), then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: name === "reserve_intelligence_execution" ? { allowed: true, id: ID } : { ok: true }, error: null }).then(resolve, reject) };
    return builder;
  });
});
describe("research browser admission sends metadata only", () => {
  it("reserves and settles with the exact verified JWT, without serializing password/hash/closure inputs", async () => {
    const refresh = vi.fn(); const privateValue = "PRIVATE_PASSWORD_AND_HASH_FIXTURE";
    const result = await executeResearchAction("research-password", () => ({ privateValue, exposed: false }), { onUsageRefresh: refresh });
    expect(result.privateValue).toBe(privateValue); expect(h.getUser).toHaveBeenCalledWith(token);
    expect(h.calls.map(call => call.args)).toEqual([{ p_action: "research-password" }, { p_execution_id: ID, p_success: true }]);
    expect(h.calls.every(call => call.headers.Authorization === `Bearer ${token}`)).toBe(true);
    expect(JSON.stringify(h.calls.map(call => call.args))).not.toContain(privateValue); expect(refresh).toHaveBeenCalledOnce();
  });
  it("rejects a changed, anonymous or unverifiable account before reservation and local work", async () => {
    for (const user of [{ id: ID }, { id: USER, is_anonymous: true }, null]) {
      h.getUser.mockResolvedValueOnce({ data: { user }, error: null }); const operation = vi.fn();
      await expect(executeResearchAction("research-privacy", operation)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(operation).not.toHaveBeenCalled();
    }
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("does not switch accounting JWT when the current account changes during a local operation", async () => {
    await executeResearchAction("research-privacy", () => { h.getSession.mockResolvedValue({ data: { session: { access_token: "later-account", user: { id: ID } } }, error: null }); return {}; });
    expect(h.calls).toHaveLength(2); expect(h.calls[1].headers.Authorization).toBe(`Bearer ${token}`);
  });
  it("releases on failure and never counts the same local operation a second time", async () => {
    await expect(executeResearchAction("research-password", () => { throw new Error("local fixture failure"); })).rejects.toThrow("local fixture failure");
    expect(h.calls.map(call => call.args)).toEqual([{ p_action: "research-password" }, { p_execution_id: ID, p_success: false }]);
  });
  it("a failed settlement does not return an otherwise completed result or retry", async () => {
    const base = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name, args) => {
      if (name === "reserve_intelligence_execution") return base(name, args);
      return { setHeader() { return this; }, abortSignal() { return this; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: { ok: false }, error: null }).then(resolve); } };
    });
    const operation = vi.fn(() => ({ privateResult: true }));
    await expect(executeResearchAction("research-privacy", operation)).rejects.toMatchObject({ code: "ACCOUNTING_FAILED", operationCompleted: true });
    expect(operation).toHaveBeenCalledOnce(); expect(h.rpc).toHaveBeenCalledTimes(2);
  });
  it("sanitizes SDK authentication errors without exposing JWT diagnostics", async () => {
    h.getUser.mockRejectedValueOnce(new Error(`private SDK Bearer ${token}`));
    try { await executeResearchAction("research-privacy", vi.fn()); throw new Error("Expected denial"); }
    catch (error) { expect((error as Error).message).not.toContain(token); expect(error).toMatchObject({ code: "UNAUTHORIZED" }); }
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("cancels an unresponsive local closure and releases its reservation once", async () => {
    const controller = new AbortController(); let started!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    const result = executeResearchAction("research-password", () => { started(); return new Promise(() => {}); }, { signal: controller.signal });
    await active; controller.abort();
    await expect(result).rejects.toMatchObject({ code: "RESEARCH_CANCELLED" });
    expect(h.calls.map(call => call.args)).toEqual([{ p_action: "research-password" }, { p_execution_id: ID, p_success: false }]);
  });
});
