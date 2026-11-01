/** Preserve the response body Supabase attaches to a failed Edge Function call. */
export async function edgeFunctionError(error: unknown): Promise<Error> {
  const fallback = error instanceof Error ? error.message : "Backend request failed";
  const context = error && typeof error === "object" && "context" in error ? error.context : null;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      const message = typeof body?.error === "string" ? body.error : body?.error?.message || body?.reason || body?.message;
      if (typeof message === "string" && message.trim()) return new Error(message.slice(0, 1000));
    } catch {
      // Empty/invalid JSON must still produce a useful HTTP failure, not success.
    }
    return new Error(`Backend HTTP ${context.status}: ${fallback}`);
  }
  return new Error(fallback);
}
