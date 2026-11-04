import { checkedDatabase } from "@/lib/checkedDatabase";
import { jsonValue } from "@/lib/jsonValue";
import { supabase } from "@/integrations/supabase/client";
import { evidenceDate, evidenceObject, filterCurrentIdentityEntities, publicEvidenceUrl, type IdentityEvidence } from "./identityEvidence";
import { loadIdentitySourceRecords } from "./loadIdentityEvidence";

/** Current reviews, not identifier text or a historical confidence number, admit a person-linked account. */
export async function loadReviewedPersonaEntities(userId: string, personaId: string) {
  if (!userId.trim() || !personaId.trim()) throw new Error("A signed-in owner and research record are required.");
  const [{ data }, records] = await Promise.all([
    checkedDatabase(supabase.from("identity_entities").select("id,entity_type,entity_value,metadata").eq("user_id", userId)),
    loadIdentitySourceRecords(userId),
  ]);
  const entities = filterCurrentIdentityEntities(data ?? [], records).filter(entity => evidenceObject(evidenceObject(entity.metadata).identity_evidence).persona_id === personaId);
  return { entities, records };
}
type PersonaContext = Awaited<ReturnType<typeof loadReviewedPersonaEntities>>;
interface TimelineEvent {
  event_type: "account_observed" | "account_created";
  event_label: string;
  event_timestamp: string;
  source: string;
  metadata: Record<string, unknown>;
}

function sourceEvents(context: PersonaContext): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const entity of context.entities) {
    const evidence = evidenceObject(evidenceObject(entity.metadata).identity_evidence) as unknown as IdentityEvidence;
    const lookup = context.records.find(row => row.id === evidence.lookup_result_id);
    const saved = evidenceObject(lookup?.result_data), result = Array.isArray(saved.profiles) ? saved : evidenceObject(saved.details);
    const profile = Array.isArray(result.profiles) ? result.profiles.map(evidenceObject).find(row => row.accountId === evidence.account_id && publicEvidenceUrl(row.profileUrl) === evidence.profile_url) : undefined;
    if (!profile) continue;
    const metadata = { entity_id: entity.id, source_record_id: evidence.lookup_result_id, identity_evidence: evidence };
    events.push({ event_type: "account_observed", event_label: `Account record retrieved: ${profile.platform} ${profile.username} (analyst-supported association)`, event_timestamp: evidence.retrieved_at, source: evidence.source_url, metadata: { ...metadata, timestamp_basis: "source_retrieval" } });
    if (evidenceDate(profile.accountCreatedAt) && Date.parse(profile.accountCreatedAt) <= Date.parse(evidence.retrieved_at)) {
      events.push({ event_type: "account_created", event_label: `Source reports account created: ${profile.platform} ${profile.username}`, event_timestamp: profile.accountCreatedAt, source: evidence.source_url, metadata: { ...metadata, timestamp_basis: "provider_account_created" } });
    }
  }
  return events;
}
function eventKey(event: { event_type?: unknown; event_label?: unknown; event_timestamp?: unknown; source?: unknown; metadata?: unknown }): string {
  const metadata = evidenceObject(event.metadata), evidence = evidenceObject(metadata.identity_evidence);
  return JSON.stringify([event.event_type, event.event_label, event.event_timestamp, publicEvidenceUrl(event.source), metadata.entity_id, metadata.source_record_id, metadata.timestamp_basis, evidence.classification, evidence.persona_id, evidence.account_id, evidence.profile_url, evidence.lookup_result_id, evidence.review_id, evidence.source_url, evidence.retrieved_at, evidence.supporting_source_url, evidence.reviewed_at]);
}

/** Retain legacy rows in storage while excluding unsupported, stale or fabricated source events from findings. */
export function visiblePersonaEvents<T extends { persona_id?: unknown; event_type?: unknown; event_label?: unknown; event_timestamp?: unknown; source?: unknown; metadata?: unknown }>(events: T[], personaId: string, context: PersonaContext): T[] {
  const current = new Set(sourceEvents(context).map(eventKey));
  return events.filter(event => event.persona_id === personaId && evidenceObject(event.metadata).resolution_excluded !== true && current.has(eventKey(event)));
}

export async function buildPersonaTimeline(userId: string, personaId: string, onProgress?: (step: string) => void): Promise<{ eventsCreated: number }> {
  onProgress?.("Loading currently reviewed source accounts...");
  const context = await loadReviewedPersonaEntities(userId, personaId);
  const events = sourceEvents(context).sort((a, b) => Date.parse(a.event_timestamp) - Date.parse(b.event_timestamp));
  if (!events.length) { onProgress?.("No currently supported source observations; original records retained."); return { eventsCreated: 0 }; }
  const { data: existing } = await checkedDatabase(supabase.from("persona_events").select("event_type,event_timestamp,event_label,source,metadata").eq("persona_id", personaId).eq("user_id", userId));
  const keys = new Set((existing ?? []).map(eventKey));
  const fresh = events.filter(event => { const key = eventKey(event); if (keys.has(key)) return false; keys.add(key); return true; });
  onProgress?.(`Saving ${fresh.length} source-timed events...`);
  let total = 0;
  for (let index = 0; index < fresh.length; index += 50) {
    const batch = fresh.slice(index, index + 50).map(event => ({ persona_id: personaId, user_id: userId, ...event, metadata: jsonValue(event.metadata) }));
    const { data } = await checkedDatabase(supabase.from("persona_events").insert(batch).select("id"));
    total += data?.length ?? 0;
  }
  onProgress?.("Complete!");
  return { eventsCreated: total };
}
