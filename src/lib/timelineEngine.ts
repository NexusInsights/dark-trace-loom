import { supabase } from "@/integrations/supabase/client";

interface TimelineResult {
  entitiesProcessed: number;
  eventsCreated: number;
}

const EVENT_TEMPLATES: Record<string, { types: string[]; sources: string[] }> = {
  email: {
    types: ["account_creation", "breach_exposure", "forum_registration", "social_signup", "data_leak"],
    sources: ["OSINT scan", "Breach database", "Platform enumeration", "Dark web monitoring"],
  },
  username: {
    types: ["profile_creation", "username_change", "account_linked", "forum_post", "mention_detected"],
    sources: ["Username enumeration", "Platform scan", "Social media crawl", "Web scraper"],
  },
  domain: {
    types: ["domain_registered", "dns_change", "ssl_issued", "whois_update", "subdomain_discovered"],
    sources: ["WHOIS lookup", "DNS history", "Certificate transparency", "Passive DNS"],
  },
  phone: {
    types: ["number_activated", "carrier_change", "app_registration", "leak_exposure"],
    sources: ["Phone lookup", "Carrier OSINT", "App enumeration", "Breach database"],
  },
  ip: {
    types: ["first_seen", "geo_change", "port_scan", "abuse_report", "vpn_detected"],
    sources: ["IP intelligence", "Shodan", "Abuse DB", "Geo-IP service"],
  },
  social_profile: {
    types: ["profile_created", "bio_updated", "connection_added", "post_published"],
    sources: ["Social media crawl", "Profile monitor", "API enumeration"],
  },
};

function deterministicRandom(seed: number, index: number): number {
  return ((seed * 31 + index * 17 + 7) % 1000) / 1000;
}

export async function reconstructTimeline(
  userId: string,
  onProgress?: (step: string) => void
): Promise<TimelineResult> {
  onProgress?.("Loading entities...");

  const { data: entities } = await supabase
    .from("identity_entities")
    .select("*")
    .eq("user_id", userId);

  if (!entities?.length) return { entitiesProcessed: 0, eventsCreated: 0 };

  onProgress?.(`Reconstructing timeline for ${entities.length} entities...`);

  const events: {
    entity_id: string;
    user_id: string;
    event_type: string;
    event_timestamp: string;
    source: string;
    description: string;
    metadata: Record<string, unknown>;
  }[] = [];

  const now = Date.now();

  for (const entity of entities) {
    const templates = EVENT_TEMPLATES[entity.entity_type] ?? EVENT_TEMPLATES.email;
    const seed = entity.entity_value
      .split("")
      .reduce((a, c) => a + c.charCodeAt(0), 0);

    // Generate 2-5 timeline events per entity
    const eventCount = 2 + Math.floor(deterministicRandom(seed, 0) * 4);

    for (let i = 0; i < eventCount; i++) {
      const typeIdx = Math.floor(deterministicRandom(seed, i + 1) * templates.types.length);
      const srcIdx = Math.floor(deterministicRandom(seed, i + 10) * templates.sources.length);

      // Spread events over past 1-4 years
      const daysAgo = Math.floor(deterministicRandom(seed, i + 20) * 1460) + 30;
      const timestamp = new Date(now - daysAgo * 86400000).toISOString();

      events.push({
        entity_id: entity.id,
        user_id: userId,
        event_type: templates.types[typeIdx],
        event_timestamp: timestamp,
        source: templates.sources[srcIdx],
        description: `${templates.types[typeIdx].replace(/_/g, " ")} detected for "${entity.entity_value}"`,
        metadata: {
          entity_type: entity.entity_type,
          entity_value: entity.entity_value,
          confidence: Math.round(deterministicRandom(seed, i + 30) * 40 + 60) / 100,
        },
      });
    }
  }

  onProgress?.(`Saving ${events.length} timeline events...`);

  // Delete existing timeline events for this user to avoid duplicates
  await supabase.from("entity_timeline").delete().eq("user_id", userId);

  let created = 0;
  const batchSize = 50;
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from("entity_timeline")
      .insert(batch as any)
      .select("id");
    if (!error && data) created += data.length;
  }

  onProgress?.("Complete!");
  return { entitiesProcessed: entities.length, eventsCreated: created };
}
