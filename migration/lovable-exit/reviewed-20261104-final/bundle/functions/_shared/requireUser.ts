declare const Deno: { env: { get(name: string): string | undefined } };
// Validate a user session in application code even when gateway JWT checks are disabled.
export async function requireUser(req: Request): Promise<boolean> {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return false;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return false;
  try {
    const response = await fetch(url + "/auth/v1/user", {
      headers: { Authorization: authorization, apikey: key },
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
    const user = response.ok ? await response.json() : null;
    return typeof user?.id === "string" && user.id.length > 0;
  } catch { return false; }
}
