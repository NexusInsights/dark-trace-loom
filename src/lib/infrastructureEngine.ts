import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** Infrastructure is derived from observed DNS answers, never case co-occurrence. */
export async function runInfrastructureMining(userId: string, onProgress?: (step: string) => void): Promise<{ linksCreated: number; entitiesAnalyzed: number }> {
  const { data: entities, error } = await checkedDatabase(supabase.from("identity_entities").select("id,entity_type,entity_value").eq("user_id", userId));
  if (error) throw error;
  const domains = new Map<string,string[]>();
  for (const entity of entities || []) {
    const domain = (entity.entity_type === "domain" ? entity.entity_value : entity.entity_type === "email" ? entity.entity_value.split("@")[1] : "")?.toLowerCase();
    if (domain && /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(domain)) domains.set(domain, [...(domains.get(domain) || []), entity.id]);
  }
  if (domains.size > 100) throw new Error("Select a smaller investigation: this run is limited to 100 distinct DNS names");
  let linksCreated = 0;
  const failures: string[] = [];
  for (const [domain, entityIds] of domains) {
    onProgress?.(`Retrieving live DNS A, AAAA, MX and NS records for ${domain}…`);
    for (const type of ["A", "AAAA", "MX", "NS"]) {
      const sourceUrl = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`;
      try {
        const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (![0,3].includes(result.Status)) throw new Error(`DNS status ${result.Status}`);
        const recordType = { A: 1, AAAA: 28, MX: 15, NS: 2 }[type];
        const answers = (result.Answer || []).filter((answer: { type: number; data: unknown }) => answer.type === recordType && typeof answer.data === "string");
        const rows = entityIds.flatMap(entity_id => answers.map((answer: { data: string; TTL: number }) => ({ entity_id, user_id: userId, infrastructure_type: type === "MX" ? "email_server" : "dns_record", value: answer.data, confidence_score: 1, source_tool: "live-dns", metadata: { domain, record_type: type, source_url: sourceUrl, retrieved_at: new Date().toISOString(), ttl: answer.TTL, note: "Observed DNS answer; shared infrastructure does not establish common ownership" } as Json })));
        if (rows.length) {
          const saved = await checkedDatabase(supabase.from("infrastructure_links").upsert(rows, { onConflict: "entity_id,infrastructure_type,value" }).select("id"));
          if (saved.error) throw new Error(`Saving evidence failed: ${saved.error.message}`);
          linksCreated += saved.data?.length || 0;
        }
      } catch (failure) { failures.push(`${domain} ${type}: ${failure instanceof Error ? failure.message : "Request failed"}`); }
    }
  }
  if (failures.length) throw new Error(`${linksCreated} DNS records saved; ${failures.length} checks failed. ${failures.slice(0,3).join("; ")}`);
  onProgress?.(`Saved ${linksCreated} observed DNS records. No hosting or ownership was inferred from case membership.`);
  return { linksCreated, entitiesAnalyzed: entities?.length || 0 };
}
