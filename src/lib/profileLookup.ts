import { supabase } from "@/integrations/supabase/client";
import type { ProfileSearchResult } from "./publicProfiles";

export async function lookupProfiles(username: string): Promise<ProfileSearchResult> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Sign in to search profiles");
  const response = await fetch("/api/profile-search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ username }), signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `Profile lookup failed (HTTP ${response.status})`);
  if (!Array.isArray(result.profiles) || !Array.isArray(result.checks)) throw new Error("Invalid profile lookup response");
  return result;
}

export function isEvidenceIdentifier(identifier: { source?: string | null }): boolean {
  return identifier.source === "input" || identifier.source === "auto_expansion" || !!identifier.source?.startsWith("live:");
}
export function identifierSource(source?: string | null): string {
  if (source?.startsWith("live:")) return `Retrieved from ${source.split(":")[1]}`;
  if (source === "input" || source === "auto_expansion") return "Provided input — ownership unverified";
  return "Unverified generated candidate";
}
