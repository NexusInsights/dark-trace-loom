// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession } } }));
import { verifyEmailMessage } from "./email-client";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const safe = { status: "unsigned", dkim: { signatures: [] }, fromAlignment: {}, uploadedReceiverClaims: {} };
describe("raw EML authenticated client", () => {
  it("sends original File bytes to the fixed same-origin path with explicit consent and the existing session", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "fixture-session-secret" } }, error: null });
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ok: true, data: safe })); vi.stubGlobal("fetch", fetchImpl);
    const file = new File([new Uint8Array([0, 255, 13, 10])], "fixture.eml");
    expect(await verifyEmailMessage(file)).toEqual(safe);
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/research-email"); expect(init.body).toBe(file);
    expect(init.headers).toMatchObject({ Authorization: "Bearer fixture-session-secret", "Content-Type": "message/rfc822", "X-Email-Processing-Consent": "true" });
    expect(init.redirect).toBe("error"); expect(init.credentials).toBe("same-origin");
  });
  it("fails closed on absent auth and cancellation during session restoration", async () => {
    const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(verifyEmailMessage(new File(["EML"], "fixture.eml"))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    let finish!: (value: unknown) => void; getSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController(); const pending = verifyEmailMessage(new File(["EML"], "fixture.eml"), { signal: controller.signal });
    await Promise.resolve();
    controller.abort(); finish({ data: { session: { access_token: "fixture" } } });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("bounds session restoration and sends no email request after its timeout", async () => {
    vi.useFakeTimers(); getSession.mockImplementation(() => new Promise(() => {}));
    const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
    const pending = verifyEmailMessage(new File(["EML"], "fixture.eml"));
    const rejected = expect(pending).rejects.toMatchObject({ code: "ACCOUNT_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(12000); await rejected; expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("uses a single HTTP deadline with no retry even if transport ignores cancellation", async () => {
    vi.useFakeTimers(); getSession.mockResolvedValue({ data: { session: { access_token: "fixture" } }, error: null });
    const fetchImpl = vi.fn(() => new Promise(() => {})); vi.stubGlobal("fetch", fetchImpl);
    const pending = verifyEmailMessage(new File(["EML"], "fixture.eml"));
    const rejected = expect(pending).rejects.toMatchObject({ code: "VERIFICATION_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(70000); await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
  });
  it("bounds JSON by actual response bytes and rejects oversized declared lengths", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "fixture" } }, error: null });
    for (const response of [new Response('"' + "PRIVATE_RESPONSE".repeat(5000) + '"'), new Response('{}', { headers: { 'Content-Length': '65537' } })]) {
      const fetchImpl = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetchImpl);
      await expect(verifyEmailMessage(new File(["EML"], "fixture.eml"))).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
  it("preserves explicit admission/accounting codes without exposing provider errors", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "fixture" } }, error: null });
    for (const code of ["DAILY_LIMIT", "FORBIDDEN", "ACCOUNTING_FAILED", "ACCOUNTING_RELEASE_FAILED"]) {
      const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ok: false, error: { code, message: "PRIVATE_RESPONSE", operationCompleted: code === "ACCOUNTING_FAILED" } }, { status: 503 })); vi.stubGlobal("fetch", fetchImpl);
      await expect(verifyEmailMessage(new File(["EML"], "fixture.eml"))).rejects.toMatchObject({ code, operationCompleted: code === "ACCOUNTING_FAILED", message: "The email verification request could not be completed." });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});
