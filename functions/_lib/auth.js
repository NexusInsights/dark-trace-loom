export async function authenticatedUser(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error("Lookup authentication is not configured");
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}
