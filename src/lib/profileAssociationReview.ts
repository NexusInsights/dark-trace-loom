import { supabase } from "@/integrations/supabase/client";
import { checkedDatabase } from "./checkedDatabase";
import type { Json } from "@/integrations/supabase/types";
import { validateLookup } from "./publicProfileEvidence";

export type AssociationDecision = "supported" | "rejected" | "unreviewed";
export interface AssociationReviewInput {
  personaId: string;
  lookupResultId: string;
  accountId: string;
  profileUrl: string;
  decision: AssociationDecision;
  supportingSourceUrl: string;
  reason: string;
}
type StoredLookup = { persona_id?: unknown; profiles?: unknown; [key: string]: unknown };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function publicSourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || /(^localhost$|\.(local|internal|localhost)$|^\d+(?:\.\d+){3}$|:)/i.test(url.hostname)) throw new Error("Use a public HTTPS source URL without credentials.");
  return url.href;
}

/** A review records an analyst's supported claim, not independent verification. */
export function associationReviewPayload(input: AssociationReviewInput, lookup: StoredLookup, reviewedAt = new Date().toISOString()) {
  if (!input.personaId || !input.lookupResultId || lookup.persona_id !== input.personaId) throw new Error("The lookup does not belong to this research record.");
  if (!["supported", "rejected", "unreviewed"].includes(input.decision)) throw new Error("Choose a valid review decision.");
  try { validateLookup(lookup); } catch { throw new Error("Retrieve a fresh account record with a stable platform ID before reviewing its association."); }
  const profile = Array.isArray(lookup.profiles) ? lookup.profiles.map(object).find(row => row.accountId === input.accountId && row.profileUrl === input.profileUrl) : undefined;
  if (!profile || !input.accountId || profile.existence !== "found" || typeof profile.platformId !== "string" || !profile.platformId || typeof profile.sourceUrl !== "string" || typeof profile.retrievedAt !== "string" || !Number.isFinite(Date.parse(profile.retrievedAt))) throw new Error("Retrieve a fresh account record with a stable platform ID before reviewing its association.");
  const reason = input.reason.trim();
  if (reason.length < 15 || reason.length > 2000) throw new Error("Explain the supporting evidence, contradiction or missing evidence in 15–2000 characters.");
  let supportingSourceUrl = "";
  if (input.supportingSourceUrl.trim()) supportingSourceUrl = publicSourceUrl(input.supportingSourceUrl.trim());
  if (input.decision === "supported" && !supportingSourceUrl) throw new Error("A supported association requires a concrete public source URL.");
  return {
    persona_id: input.personaId, lookup_result_id: input.lookupResultId,
    account_id: input.accountId, profile_url: input.profileUrl,
    decision: input.decision, supporting_source_url: supportingSourceUrl, reason,
    reviewed_at: reviewedAt, observed_source_url: profile.sourceUrl,
    observed_at: profile.retrievedAt,
    limitation: "Analyst review of supplied evidence; not independently verified person ownership. A hyperlink alone establishes only that one account links to another.",
  };
}

export async function saveProfileAssociationReview(userId: string, input: AssociationReviewInput) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || auth.user?.id !== userId) throw new Error("Your account could not be verified. Sign in again before saving a review.");
  const { data: persona } = await checkedDatabase(supabase.from("personas").select("id").eq("id", input.personaId).eq("user_id", userId).single());
  if (!persona) throw new Error("This research record is not available to your account.");
  const { data: lookup } = await checkedDatabase(supabase.from("tool_results").select("id,result_data").eq("id", input.lookupResultId).eq("user_id", userId).eq("tool_name", "public-profile-search").single());
  if (!lookup) throw new Error("The original source lookup could not be loaded.");
  const payload = associationReviewPayload(input, object(lookup.result_data));
  await checkedDatabase(supabase.from("tool_results").insert({ user_id: userId, tool_name: "profile-association-review", status: "success", result_data: payload as unknown as Json }));
  return payload;
}
