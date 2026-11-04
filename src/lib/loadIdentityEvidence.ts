import { supabase } from "@/integrations/supabase/client";
import { checkedDatabase } from "./checkedDatabase";
import type { SavedIdentityRecord } from "./identityEvidence";
import { evidenceObject } from "./identityEvidence";

/** Read the current review ledger under the signed-in caller's RLS and owner filter. */
export async function loadIdentitySourceRecords(userId: string): Promise<SavedIdentityRecord[]> {
  if (!userId.trim()) throw new Error("Sign in before loading identity evidence.");
  const ownedPeople = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const query = supabase.from("personas").select("id").eq("user_id", userId).order("id").range(offset, offset + 499);
      const { data } = await checkedDatabase(typeof query.abortSignal === "function" ? query.abortSignal(controller.signal) : query);
      for (const person of data ?? []) ownedPeople.add(person.id);
      if (!data || data.length < 500) break;
    } finally { clearTimeout(timer); }
  }
  if (!ownedPeople.size) return [];
  const rows: SavedIdentityRecord[] = [];
  for (let offset = 0; ; offset += 500) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const query = supabase.from("tool_results").select("id,case_id,tool_name,result_data,status,created_at").eq("user_id", userId).in("tool_name", ["public-profile-search", "profile-association-review"]).order("id").range(offset, offset + 499);
      const { data } = await checkedDatabase(typeof query.abortSignal === "function" ? query.abortSignal(controller.signal) : query);
      rows.push(...(data ?? []).filter(row => ownedPeople.has(String(evidenceObject(row.result_data).persona_id))));
      if (!data || data.length < 500) return rows;
    } finally { clearTimeout(timer); }
  }
}
