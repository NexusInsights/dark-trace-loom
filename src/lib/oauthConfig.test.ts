import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { authReturnUrl, beginGoogleOAuth, googleOAuthConfiguration } from "./oauthConfig";

const backend = "https://owned-auth.example.test";
const origin = "https://dark-trace-loom.pages.dev";
const callback = `${origin}/auth/callback`;
const nativeUrl = `${backend}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callback)}`;
const client = (url: string | null = nativeUrl, error: { message: string } | null = null) => ({
  signInWithOAuth: vi.fn(async () => ({ data: { url }, error })),
});
afterEach(() => vi.useRealTimers());

describe("direct backend OAuth configuration", () => {
  it.each([undefined, "", "false", "TRUE", "yes"])("keeps unconfigured Google access disabled for %s", value => {
    expect(googleOAuthConfiguration(value)).toMatchObject({ enabled: false });
  });
  it("requires an explicit enable flag after provider credentials are configured", () => {
    expect(googleOAuthConfiguration("true")).toEqual({ enabled: true });
  });
  it("preserves exact same-origin authentication return paths", () => {
    for (const path of ["/", "/auth/callback", "/dashboard", "/reset-password"] as const)
      expect(authReturnUrl(origin, path)).toBe(`${origin}${path}`);
    expect(authReturnUrl("http://localhost:8080", "/auth/callback")).toBe("http://localhost:8080/auth/callback");
  });
  it.each(["http://public.example", "https://user:password@app.example", "https://app.example?token=x", "https://app.example/#fragment", "https://app.example/path", "not-a-url"])(
    "rejects unsafe origin %s", value => expect(() => authReturnUrl(value, "/auth/callback")).toThrow(),
  );
  it("does not call any OAuth endpoint when Google is unconfigured", async () => {
    const auth = client();
    await expect(beginGoogleOAuth(auth, backend, origin)).rejects.toThrow("not been configured");
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });
  it("asks the native client for the current app callback and verifies its URL", async () => {
    const auth = client();
    await expect(beginGoogleOAuth(auth, backend, origin, "true")).resolves.toBe(nativeUrl);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: callback, skipBrowserRedirect: true } });
  });
  it("uses the installed real Supabase SDK to construct a direct authorization URL without a broker", async () => {
    const unexpectedFetch = vi.fn(async () => { throw new Error("OAuth URL construction must not issue a provider request"); });
    const actualClient = createClient(backend, "sb_publishable_controlled_fixture", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: unexpectedFetch },
    });
    const url = new URL(await beginGoogleOAuth(actualClient.auth, backend, origin, "true"));
    expect(url.origin).toBe(backend);
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(callback);
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });
  it("preserves an actual provider setup failure", async () => {
    await expect(beginGoogleOAuth(client(null, { message: "Unsupported provider: missing OAuth secret" }), backend, origin, "true"))
      .rejects.toThrow("missing OAuth secret");
  });
  it.each([
    "https://other.example/auth/v1/authorize?provider=google", `${backend}/some-broker?provider=google`,
    `${backend}/auth/v1/authorize?provider=apple`, `${backend}/auth/v1/authorize?provider=google&redirect_to=https://other.example`,
  ])("blocks an unexpected OAuth destination %s", async url => {
    await expect(beginGoogleOAuth(client(url), backend, origin, "true")).rejects.toThrow("unexpected Google sign-in destination");
  });
  it("fails explicitly when no authorization URL is returned", async () => {
    await expect(beginGoogleOAuth(client(null), backend, origin, "true")).rejects.toThrow("no Google sign-in URL");
  });
  it("times out without navigating when OAuth initialization never finishes", async () => {
    vi.useFakeTimers();
    const auth = { signInWithOAuth: vi.fn(() => new Promise<never>(() => {})) };
    const rejection = expect(beginGoogleOAuth(auth, backend, origin, "true")).rejects.toThrow("within 15 seconds");
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
  });
});
