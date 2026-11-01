import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";

export interface BreachScanResult {
  identifiersScanned: number;
  exposuresFound: number;
  notConfigured: boolean;
  reason?: string;
}

/**
 * Scan identity entities for breach exposure via the real breach-lookup edge function.
 * Calls HIBP and DeHashed; persists every result (exposure / no_exposure / not_configured)
 * to breach_records as honest provenance. Returns not_configured=true if both API keys
 * are unset on the server.
 */
export async function runBreachScan(
  userId: string,
  onProgress?: (step: string) => void,
): Promise<BreachScanResult> {
  onProgress?.("Loading identifiers...");

  const { data: entities } = await checkedDatabase(supabase
    .from("identity_entities")
    .select("id, entity_type, entity_value")
    .eq("user_id", userId));

  const scannable = (entities ?? []).filter((e) =>
    ["email", "username", "phone"].includes(e.entity_type),
  );

  if (scannable.length === 0) {
    return { identifiersScanned: 0, exposuresFound: 0, notConfigured: false };
  }

  const identifiers = scannable.map((e) => e.entity_value);
  onProgress?.(`Querying breach databases for ${identifiers.length} identifier(s)...`);

  // Chunk to keep request size reasonable (edge function caps at 50).
  const CHUNK = 25;
  let exposures = 0;
  let notConfigured = false;
  let reason: string | undefined;

  for (let i = 0; i < identifiers.length; i += CHUNK) {
    const slice = identifiers.slice(i, i + CHUNK);
    const { data, error } = await supabase.functions.invoke("breach-lookup", {
      body: { identifiers: slice },
    });
    if (error) throw new Error(error.message);
    const payload = data as {
      status?: string;
      reason?: string;
      results?: Array<{ status: string }>;
    };
    if (payload?.status === "not_configured") {
      notConfigured = true;
      reason = payload.reason;
      break;
    }
    if (!payload || payload.status === "error" || !Array.isArray(payload.results)) throw new Error(payload?.reason || "Breach provider returned no usable scan result");
    if (payload.results.some(result => result.status === "error" || result.status === "not_configured")) throw new Error("One or more breach providers failed; an absence of exposure has not been established");
    for (const r of payload?.results ?? []) {
      if (r.status === "exposure") exposures++;
    }
  }

  onProgress?.("Complete");
  return {
    identifiersScanned: identifiers.length,
    exposuresFound: exposures,
    notConfigured,
    reason,
  };
}
