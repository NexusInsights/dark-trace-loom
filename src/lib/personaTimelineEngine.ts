import { checkedDatabase } from "@/lib/checkedDatabase";
import { jsonValue } from "@/lib/jsonValue";
import { supabase } from "@/integrations/supabase/client";
import { isEvidenceIdentifier } from "./profileLookup";

interface TimelineEvent {
  event_type: string;
  event_label: string;
  event_timestamp: string;
  source: string;
  metadata: Record<string, unknown>;
}

export async function buildPersonaTimeline(
  userId: string,
  personaId: string,
  onProgress?: (step: string) => void
): Promise<{ eventsCreated: number }> {
  onProgress?.("Loading persona data...");

  // Get persona identifiers
  const { data: rawIdentifiers } = await checkedDatabase(supabase
    .from("persona_identifiers")
    .select("identifier_type, identifier_value, confidence_score, created_at, source")
    .eq("persona_id", personaId)
    .eq("user_id", userId));
  const identifiers = rawIdentifiers?.filter(isEvidenceIdentifier);

  if (!identifiers?.length) {
    onProgress?.("No identifiers found");
    return { eventsCreated: 0 };
  }

  const values = new Set(identifiers.map((i) => i.identifier_value.toLowerCase()));

  // Load related data in parallel
  onProgress?.("Scanning data sources...");
  const [
    { data: entities },
    { data: usernames },
    { data: emails },
    { data: breaches },
    { data: observations },
    { data: entityTimeline },
    { data: infraLinks },
  ] = await Promise.all([
    checkedDatabase(supabase.from("identity_entities").select("id, entity_type, entity_value, created_at").eq("user_id", userId)),
    checkedDatabase(supabase.from("username_candidates").select("candidate_username, created_at, generation_method").eq("persona_id", personaId)),
    checkedDatabase(supabase.from("email_candidates").select("candidate_email, created_at, generation_method").eq("persona_id", personaId)),
    checkedDatabase(supabase.from("breach_records").select("id, entity_id, breach_source, breach_date, severity, data_exposed, created_at").eq("status", "exposure").eq("user_id", userId)),
    checkedDatabase(supabase.from("entity_observations").select("entity_id, case_id, source_tool, observed_value, created_at").eq("user_id", userId)),
    checkedDatabase(supabase.from("entity_timeline").select("entity_id, event_type, event_timestamp, description, source").eq("user_id", userId)),
    checkedDatabase(supabase.from("infrastructure_links").select("entity_id, infrastructure_type, value, created_at").eq("source_tool", "live-dns").eq("user_id", userId)),
  ]);

  // Match entities to persona
  const matchedEntityIds = new Set(
    (entities ?? []).filter((e) => values.has(e.entity_value.toLowerCase())).map((e) => e.id)
  );

  const events: TimelineEvent[] = [];

  onProgress?.("Building timeline events...");

  // 1. Identifier discovery events
  for (const id of identifiers) {
    events.push({
      event_type: id.source?.startsWith("live:") ? "identifier_retrieved" : "input_recorded",
      event_label: `${id.source?.startsWith("live:") ? "Retrieved" : "Input recorded"} ${id.identifier_type}: ${id.identifier_value}`,
      event_timestamp: id.created_at,
      source: "persona_discovery",
      metadata: { type: id.identifier_type, value: id.identifier_value, confidence: id.confidence_score },
    });
  }

  // 4. Entity creation events (matched)
  for (const e of entities ?? []) {
    if (matchedEntityIds.has(e.id)) {
      events.push({
        event_type: "entity_created",
        event_label: `Entity registered: ${e.entity_value} (${e.entity_type})`,
        event_timestamp: e.created_at,
        source: "identity_resolution",
        metadata: { entity_id: e.id, entity_type: e.entity_type },
      });
    }
  }

  // 5. Breach exposure events
  for (const b of breaches ?? []) {
    if (matchedEntityIds.has(b.entity_id)) {
      events.push({
        event_type: "breach_exposure",
        event_label: `Breach: ${b.breach_source} (${b.severity})`,
        event_timestamp: b.breach_date ?? b.created_at,
        source: b.breach_source,
        metadata: { severity: b.severity, data_exposed: b.data_exposed, breach_id: b.id },
      });
    }
  }

  // 6. Investigation sightings
  for (const obs of observations ?? []) {
    if (matchedEntityIds.has(obs.entity_id)) {
      events.push({
        event_type: "investigation_sighting",
        event_label: `Observed: ${obs.observed_value}${obs.source_tool ? ` via ${obs.source_tool}` : ""}`,
        event_timestamp: obs.created_at,
        source: obs.source_tool ?? "investigation",
        metadata: { case_id: obs.case_id, observed_value: obs.observed_value },
      });
    }
  }

  // 7. Entity timeline events (matched)
  for (const ev of entityTimeline ?? []) {
    if (matchedEntityIds.has(ev.entity_id)) {
      events.push({
        event_type: ev.event_type,
        event_label: ev.description ?? `${ev.event_type} event`,
        event_timestamp: ev.event_timestamp,
        source: ev.source ?? "entity_timeline",
        metadata: { entity_id: ev.entity_id },
      });
    }
  }

  // 8. Domain/infrastructure registration events
  for (const il of infraLinks ?? []) {
    if (matchedEntityIds.has(il.entity_id)) {
      events.push({
        event_type: "infrastructure_linked",
        event_label: `${il.infrastructure_type}: ${il.value}`,
        event_timestamp: il.created_at,
        source: "infrastructure_mapping",
        metadata: { type: il.infrastructure_type, value: il.value },
      });
    }
  }

  if (events.length === 0) {
    onProgress?.("No events found");
    return { eventsCreated: 0 };
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime());

  // Clear old events for this persona
  onProgress?.(`Saving ${events.length} events...`);
  const existing = await checkedDatabase(supabase.from("persona_events").select("event_type,event_timestamp,event_label").eq("persona_id", personaId).eq("user_id", userId));
  const existingKeys = new Set((existing.data || []).map(event => `${event.event_type}:${event.event_timestamp}:${event.event_label}`));
  const fresh = events.filter(event => !existingKeys.has(`${event.event_type}:${event.event_timestamp}:${event.event_label}`));

  // Batch insert
  const batchSize = 50;
  let total = 0;
  for (let i = 0; i < fresh.length; i += batchSize) {
    const batch = fresh.slice(i, i + batchSize).map((ev) => ({
      persona_id: personaId,
      user_id: userId,
      ...ev, metadata: jsonValue(ev.metadata),
    }));
    const { data } = await checkedDatabase(supabase.from("persona_events").insert(batch).select("id"));
    total += data?.length ?? 0;
  }

  onProgress?.("Complete!");
  return { eventsCreated: total };
}
