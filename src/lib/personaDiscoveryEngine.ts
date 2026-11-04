import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { lookupProfiles } from "./profileLookup";
import { normalizeProfileInput, type ProfileSearchResult } from "./publicProfiles";
import type { Json } from "@/integrations/supabase/types";

export interface PersonaInput { name?: string; username?: string; profileUrl?: string; email?: string; domain?: string; phone?: string; enrich?: boolean; personaId?: string; searchProfiles?: boolean; }

export async function runPersonaDiscovery(userId: string, input: PersonaInput, onProgress?: (step: string) => void): Promise<{ personaId: string; identifiersGenerated: number; lookup: ProfileSearchResult | null }> {
  if (!userId.trim()) throw new Error("Sign in before saving an investigation.");
  if (input.enrich) throw new Error("Provider enrichment runs separately in Tools. Persona Discovery saves exact public account observations and input leads; it cannot save enrichment as a profile lookup.");
  const sanitized = Object.fromEntries(["name", "username", "profileUrl", "email", "domain", "phone"].flatMap(key => {
    const value = input[key as keyof PersonaInput];
    return typeof value === "string" && value.trim() ? [[key, value.trim()]] : [];
  })) as Pick<PersonaInput,"name"|"username"|"profileUrl"|"email"|"domain"|"phone">;
  if (!Object.values(sanitized).length) throw new Error("Provide at least one identifier");
  if (sanitized.username && sanitized.profileUrl) throw new Error("Provide one exact username or profile URL, not both.");
  if (sanitized.username || sanitized.profileUrl) normalizeProfileInput(sanitized.profileUrl ? { profileUrl: sanitized.profileUrl } : sanitized.username!.replace(/^@/, ""));
  if (input.personaId && !/^[0-9a-f-]{36}$/i.test(input.personaId)) throw new Error("Invalid persona ID");
  if (input.personaId) {
    const owner = await checkedDatabase(supabase.from("personas").select("id").eq("id", input.personaId).eq("user_id", userId).single());
    if (!owner.data) throw new Error("This person investigation is unavailable.");
  }
  let lookup: ProfileSearchResult | null = null;
  if ((sanitized.username || sanitized.profileUrl) && input.searchProfiles !== false) {
    onProgress?.("Retrieving exact public account records; person ownership remains unreviewed...");
    lookup = await lookupProfiles(sanitized.profileUrl ? { profileUrl: sanitized.profileUrl } : sanitized.username!.replace(/^@/, ""));
    if (lookup.checks.length && lookup.checks.every(check => check.status === "unavailable")) {
      const reasons = lookup.checks.slice(0, 10).map(check => `${check.platform.replace(/\s+/g, " ").trim().slice(0, 20)}: ${(check.reason?.replace(/\s+/g, " ").trim() || "no provider reason supplied").slice(0, 64)}`).join("; ");
      throw new Error(`All profile providers were unavailable. No account existence was established. ${reasons}`);
    }
  }
  onProgress?.("Saving input leads separately from retrieved account observations...");
  const { data: persona } = input.personaId ? { data: { id: input.personaId } } : await checkedDatabase(supabase.from("personas").insert({ user_id: userId, persona_label: sanitized.name || sanitized.username || sanitized.profileUrl || sanitized.email || sanitized.phone || sanitized.domain || "Investigation" }).select("id").single());
  if (!persona) throw new Error("Failed to create investigation: no record returned");
  const rows = Object.entries(sanitized).map(([type, value]) => ({ identifier_type: type === "profileUrl" ? "social_profile" : type, identifier_value: value!, source: "input", confidence_score: 0, persona_id: persona.id, user_id: userId }));
  await checkedDatabase(supabase.from("persona_identifiers").upsert(rows, { onConflict: "persona_id,identifier_type,identifier_value", ignoreDuplicates: true }));
  if (lookup) {
    await checkedDatabase(supabase.from("tool_results").insert({ user_id: userId, tool_name: "public-profile-search", status: lookup.status || "partial", result_data: { ...lookup, persona_id: persona.id, inputs: sanitized, evidence_classification: "account_observations_unreviewed" } as unknown as Json }));
  }
  onProgress?.(lookup ? `${lookup.profiles.length} source account observations saved for review. No person association was inferred.` : "Input leads saved. No identity or contact ownership was established.");
  return { personaId: persona.id, identifiersGenerated: rows.length, lookup };
}
