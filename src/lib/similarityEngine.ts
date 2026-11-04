import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { filterCurrentIdentityEntities } from "./identityEvidence";
import { loadIdentitySourceRecords } from "./loadIdentityEvidence";
import { sourceContextComparisons } from "./reviewedIdentityGroups";

export async function readResearchComparisons(userId: string) {
  if (!userId.trim()) throw new Error("Sign in before comparing source evidence.");
  const [{ data: entities }, records] = await Promise.all([
    checkedDatabase(supabase.from("identity_entities").select("*").eq("user_id", userId)),
    loadIdentitySourceRecords(userId),
  ]);
  return sourceContextComparisons(filterCurrentIdentityEntities(entities ?? [], records), userId);
}

/** No synthetic probabilities, persistent links, score replacement or historical deletion. */
export async function runBehavioralSimilarity(userId: string, onProgress?: (step: string) => void): Promise<{ pairsScored: number; highSimilarity: number }> {
  onProgress?.("Comparing the source context of current analyst-supported account associations...");
  const rows = await readResearchComparisons(userId);
  onProgress?.(`Found ${rows.length} source-context research leads (up to 200 account records and 500 pairs). These are not ownership probabilities; no records were changed.`);
  return { pairsScored: rows.length, highSimilarity: 0 };
}
