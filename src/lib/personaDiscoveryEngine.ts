import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { lookupProfiles } from "./profileLookup";
import type { ProfileSearchResult } from "./publicProfiles";
import type { Json } from "@/integrations/supabase/types";
import { edgeFunctionError } from "./edgeFunctionError";
import { normalizePdlResult } from "./pdlResults";

export interface PersonaInput { name?: string; username?: string; email?: string; domain?: string; phone?: string; enrich?: boolean; personaId?: string; searchProfiles?: boolean; }

export async function runPersonaDiscovery(userId: string, input: PersonaInput, onProgress?: (step: string) => void): Promise<{ personaId: string; identifiersGenerated: number; lookup: ProfileSearchResult | null }> {
  const sanitized = Object.fromEntries(Object.entries(input).filter(([key]) => !["enrich","personaId"].includes(key)).map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""]).filter(([,value]) => value)) as Pick<PersonaInput,"name"|"username"|"email"|"domain"|"phone">;
  if (!Object.values(sanitized).length) throw new Error("Provide at least one identifier");
  let lookup: ProfileSearchResult | null = null;
  if (sanitized.username && input.searchProfiles !== false) {
    onProgress?.("Checking GitHub, GitLab, DEV Community, Hacker News and Keybase account records...");
    lookup = await lookupProfiles(sanitized.username.replace(/^@/, ""));
    if (lookup.checks.every(check => check.status === "unavailable")) throw new Error("All profile providers were unavailable. No account existence was established. Try again later.");
  }
  if (input.enrich) {
    if (!sanitized.email && !sanitized.phone && !sanitized.name) throw new Error("Provider enrichment requires an email, phone or full name");
    onProgress?.("Requesting an actual People Data Labs match with the configured provider account...");
    const { data: providerData, error } = await supabase.functions.invoke("osint-tools", { body: { action: "pdl-person-enrich", params: sanitized } });
    if (error) throw await edgeFunctionError(error);
    const data = providerData ? normalizePdlResult(providerData) : null;
    if (data?.error) throw new Error(String(data.error));
    if (!data?.raw?.id) throw new Error("The enrichment provider did not return an identifiable person record");
    lookup ||= { username: sanitized.username || "", retrievedAt: new Date().toISOString(), profiles: [], checks: [] };
    lookup.enrichment = data;
    const sourceUrl = "https://api.peopledatalabs.com/v5/person/enrich";
    for (const [platform,key] of [["LinkedIn","linkedin_url"],["Twitter","twitter_url"],["Facebook","facebook_url"],["GitHub","github_url"]]) {
      if (typeof data[key] !== "string" || !data[key]) continue;
      let url: URL;
      try { url = new URL(data[key].startsWith("http") ? data[key] : `https://${data[key]}`); } catch { continue; }
      if (!["https:","http:"].includes(url.protocol)) continue;
      lookup.profiles.push({ platform, username: decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || ""), profileUrl: url.href, sourceUrl, retrievedAt: lookup.retrievedAt, displayName: data.full_name, location: data.location_name, email: data.work_email, phone: data.mobile_phone, evidenceKind: "provider_match" });
    }
  }
  onProgress?.("Saving inputs and retrieved evidence...");
  if (input.personaId && !/^[0-9a-f-]{36}$/i.test(input.personaId)) throw new Error("Invalid persona ID");
  const query = input.personaId ? supabase.from("personas").select("id").eq("id",input.personaId).eq("user_id",userId).single() : supabase.from("personas").insert({ user_id: userId, persona_label: sanitized.name || sanitized.username || sanitized.email || sanitized.phone || sanitized.domain || "Persona" }).select("id").single();
  const { data: persona, error } = await checkedDatabase(query);
  if (error || !persona) throw new Error(`Failed to create persona: ${error?.message || "No record returned"}`);
  const identifiers = Object.entries(sanitized).map(([type,value]) => ({ identifier_type: type, identifier_value: value!, source: "input", confidence_score: 1 }));
  for (const profile of lookup?.profiles || []) {
    const source = `live:${profile.platform}:${profile.sourceUrl}`;
    identifiers.push({ identifier_type: "social_profile", identifier_value: profile.profileUrl, source, confidence_score: 1 });
    identifiers.push({ identifier_type: "username", identifier_value: profile.username, source, confidence_score: 1 });
    if (profile.email) identifiers.push({ identifier_type: "email", identifier_value: profile.email, source, confidence_score: 1 });
    if (profile.phone) identifiers.push({ identifier_type: "phone", identifier_value: profile.phone, source, confidence_score: 1 });
  }
  if (lookup?.enrichment) {
    const data = lookup.enrichment;
    for (const [type,values] of [["email",[data.work_email, ...(Array.isArray(data.personal_emails) ? data.personal_emails : [])]], ["phone",[data.mobile_phone, ...(Array.isArray(data.phone_numbers) ? data.phone_numbers : [])]]] as const) {
      for (const value of values) if (typeof value === "string" && value.trim()) identifiers.push({ identifier_type: type, identifier_value: value, source: "live:People Data Labs:https://api.peopledatalabs.com/v5/person/enrich", confidence_score: 1 });
    }
  }
  const seen = new Set<string>();
  const rows = identifiers.filter(i => { const k = `${i.identifier_type}:${i.identifier_value}`; if (seen.has(k)) return false; seen.add(k); return true; }).map(i => ({ ...i, persona_id: persona.id, user_id: userId }));
  const saved = await checkedDatabase(supabase.from("persona_identifiers").upsert(rows,{onConflict:"persona_id,identifier_type,identifier_value"}));
  if (saved.error) throw new Error(`Persona was created, but its identifiers could not be saved: ${saved.error.message}`);
  if (lookup) {
    const result = await checkedDatabase(supabase.from("tool_results").insert({ user_id: userId, tool_name: "public-profile-search", result_data: { ...lookup, persona_id: persona.id, inputs: sanitized } as unknown as Json }));
    if (result.error) throw new Error(`Identifiers saved, but lookup provenance could not be saved: ${result.error.message}`);
  }
  onProgress?.(lookup ? `${lookup.profiles.length} confirmed account records; ${lookup.checks.filter(c => c.status === "unavailable").length} unavailable providers. Shared usernames do not prove shared ownership.` : "Inputs saved. Name, email and phone ownership require a configured enrichment provider; no inferred contacts were generated.");
  return { personaId: persona.id, identifiersGenerated: rows.length, lookup };
}
