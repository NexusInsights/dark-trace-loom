import { describe, expect, it } from "vitest";
import { edgeFunctionError } from "./edgeFunctionError";

describe("Edge Function response errors", () => {
  it("shows the actual PDL error instead of Supabase's generic non-2xx message", async () => {
    const context = new Response(JSON.stringify({error: "PDL 400: The from parameter is no longer supported"}), {status:500});
    const failure = Object.assign(new Error("Edge Function returned a non-2xx status code"), {context});
    expect((await edgeFunctionError(failure)).message).toBe("PDL 400: The from parameter is no longer supported");
    expect(context.bodyUsed).toBe(false);
  });
  it("preserves HTTP status when the backend returns invalid JSON", async () => {
    const failure = Object.assign(new Error("Backend failed"), {context:new Response("unavailable",{status:503})});
    expect((await edgeFunctionError(failure)).message).toBe("Backend HTTP 503: Backend failed");
  });
  it("preserves network errors without a response", async () => {
    expect((await edgeFunctionError(new Error("Failed to fetch"))).message).toBe("Failed to fetch");
  });
});
