export function googleOAuthConfiguration(enabled?: string): { enabled: boolean; reason?: string } {
  if (enabled?.trim() === "true") return { enabled: true };
  return {
    enabled: false,
    reason: "Google sign-in has not been configured for this deployment. Please use email sign-in.",
  };
}

export function authReturnUrl(origin: string, path: "/" | "/auth/callback" | "/dashboard" | "/reset-password"): string {
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error("The app's authentication return URL is invalid."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("Authentication requires HTTPS, except local development on this computer.");
  }
  return new URL(path, url.origin).href;
}

type OAuthClient = {
  signInWithOAuth: (options: {
    provider: "google";
    options: { redirectTo: string; skipBrowserRedirect: true };
  }) => Promise<{ data: { url: string | null }; error: { message: string } | null }>;
};

/** Returns only an authorization URL belonging to the configured backend.
 * Credentials are configured on Supabase Auth; no provider secret enters this client.
 */
export async function beginGoogleOAuth(auth: OAuthClient, backendUrl: string, origin: string, enabled?: string): Promise<string> {
  const configuration = googleOAuthConfiguration(enabled);
  if (!configuration.enabled) throw new Error(configuration.reason);
  const redirectTo = authReturnUrl(origin, "/auth/callback");
  let backend: URL;
  try { backend = new URL(backendUrl); } catch { throw new Error("Authentication backend is not configured."); }
  if (backend.protocol !== "https:" || backend.username || backend.password || backend.search || backend.hash)
    throw new Error("Authentication backend must be a secure HTTPS URL.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Google sign-in could not start within 15 seconds. Please try again.")), 15000); }),
    ]);
    if (result.error) throw new Error(result.error.message);
    if (!result.data?.url) throw new Error("Authentication returned no Google sign-in URL.");
    let authorization: URL;
    try { authorization = new URL(result.data.url); } catch { throw new Error("Authentication returned an invalid Google sign-in URL."); }
    const expectedPath = `${backend.pathname.replace(/\/$/, "")}/auth/v1/authorize`;
    if (authorization.origin !== backend.origin || authorization.pathname !== expectedPath
      || authorization.username || authorization.password || authorization.hash
      || authorization.searchParams.get("provider") !== "google"
      || authorization.searchParams.get("redirect_to") !== redirectTo)
      throw new Error("Authentication returned an unexpected Google sign-in destination.");
    return authorization.href;
  } finally { clearTimeout(timer); }
}
