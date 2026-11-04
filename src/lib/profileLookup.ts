import { supabase } from "@/integrations/supabase/client";
import { normalizeProfileInput, validateProfileSearchResult, type ProfileLookupInput, type ProfileSearchResult } from "./publicProfiles";
import { readResearchRawBody } from "../../services/research/admission.mjs";

export async function lookupProfiles(input: string | ProfileLookupInput): Promise<ProfileSearchResult> {
  const normalized = normalizeProfileInput(input);
  const body = normalized.profileUrl ? { profileUrl: normalized.profileUrl } : { username: normalized.username };
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Sign in to search profiles");
  const signal = AbortSignal.timeout(30000);
  const response = await fetch("/api/profile-search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body), signal });
  let result;
  try { result = JSON.parse(await readResearchRawBody(response, 512 * 1024, { signal, timeoutMs: 10000 })); }
  catch { throw new Error("Profile lookup returned an invalid, oversized or timed-out response"); }
  if (!response.ok || result.error) throw new Error(result.error || `Profile lookup failed (HTTP ${response.status})`);
  return validateProfileSearchResult(result);
}

export function isEvidenceIdentifier(identifier: { source?: string | null }): boolean {
  return identifier.source === "input" || identifier.source === "auto_expansion" || !!identifier.source?.startsWith("live:");
}
export function identifierSource(source?: string | null): string {
  if (source?.startsWith("live:")) return `Retrieved from ${source.split(":")[1]}`;
  if (source === "input" || source === "auto_expansion") return "Provided input — ownership unverified";
  return "Unverified generated candidate";
}
