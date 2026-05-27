import { supabase } from "@/integrations/supabase/client";

interface InfraMiningResult {
  linksCreated: number;
  entitiesAnalyzed: number;
}

/**
 * Mine infrastructure relationships from identity entities.
 *
 * Detection rules:
 * 1. Shared hosting: emails on the same domain → shared email server
 * 2. Shared IP ranges: IPs in the same /24 subnet
 * 3. Shared DNS: domains observed in same cases → likely shared DNS
 * 4. Shared email servers: email domains matching known infrastructure patterns
 */
export async function runInfrastructureMining(
  userId: string,
  onProgress?: (step: string) => void
): Promise<InfraMiningResult> {
  onProgress?.("Loading entities...");

  const { data: entities } = await supabase
    .from("identity_entities")
    .select("*")
    .eq("user_id", userId);

  if (!entities?.length) return { linksCreated: 0, entitiesAnalyzed: 0 };

  onProgress?.(`Analyzing ${entities.length} entities for infrastructure...`);

  const { data: observations } = await supabase
    .from("entity_observations")
    .select("entity_id, case_id, source_tool")
    .eq("user_id", userId);

  // Build case groupings
  const entityCases = new Map<string, Set<string>>();
  for (const obs of observations ?? []) {
    if (!obs.case_id) continue;
    if (!entityCases.has(obs.entity_id)) entityCases.set(obs.entity_id, new Set());
    entityCases.get(obs.entity_id)!.add(obs.case_id);
  }

  const links: {
    entity_id: string;
    user_id: string;
    infrastructure_type: string;
    value: string;
    confidence_score: number;
    source_tool: string | null;
    metadata: Record<string, unknown>;
  }[] = [];

  const seen = new Set<string>();

  function addLink(
    entityId: string, infraType: string, value: string,
    confidence: number, tool: string | null, meta: Record<string, unknown> = {}
  ) {
    const key = `${entityId}:${infraType}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({
      entity_id: entityId,
      user_id: userId,
      infrastructure_type: infraType,
      value,
      confidence_score: confidence,
      source_tool: tool,
      metadata: meta,
    });
  }

  const emails = entities.filter((e) => e.entity_type === "email");
  const domains = entities.filter((e) => e.entity_type === "domain");
  const ips = entities.filter((e) => e.entity_type === "ip");

  // 1. Shared email servers: extract domain from emails
  onProgress?.("Detecting shared email servers...");
  const emailDomainGroups = new Map<string, string[]>();
  for (const email of emails) {
    const domain = email.entity_value.split("@")[1];
    if (!domain) continue;
    addLink(email.id, "email_server", domain, 0.9, null, { email: email.entity_value });
    if (!emailDomainGroups.has(domain)) emailDomainGroups.set(domain, []);
    emailDomainGroups.get(domain)!.push(email.id);
  }

  // 2. Shared hosting: domains link to hosting infrastructure
  onProgress?.("Detecting shared hosting...");
  for (const domain of domains) {
    // Map domain to its hosting value (the domain itself acts as infrastructure)
    addLink(domain.id, "hosting", domain.entity_value, 0.85, null, { type: "domain_hosting" });

    // If domain matches an email domain, link them
    for (const [emailDomain, emailIds] of emailDomainGroups) {
      if (emailDomain === domain.entity_value) {
        addLink(domain.id, "email_server", emailDomain, 0.95, null, {
          linked_emails: emailIds.length,
        });
      }
    }
  }

  // 3. Shared IP ranges: group IPs by /24 subnet
  onProgress?.("Detecting shared IP ranges...");
  const subnetGroups = new Map<string, string[]>();
  for (const ip of ips) {
    const parts = ip.entity_value.split(".");
    if (parts.length === 4) {
      const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      addLink(ip.id, "ip_range", subnet, 0.8, null, { ip: ip.entity_value });
      if (!subnetGroups.has(subnet)) subnetGroups.set(subnet, []);
      subnetGroups.get(subnet)!.push(ip.id);
    }
  }

  // Boost confidence for IPs in shared subnets
  for (const [subnet, ipIds] of subnetGroups) {
    if (ipIds.length > 1) {
      for (const ipId of ipIds) {
        addLink(ipId, "shared_subnet", subnet, 0.9, null, { peers: ipIds.length });
      }
    }
  }

  // 4. Shared DNS: domains co-observed in same case
  onProgress?.("Detecting shared DNS records...");
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const aCases = entityCases.get(domains[i].id);
      const bCases = entityCases.get(domains[j].id);
      if (aCases && bCases) {
        const shared = [...aCases].filter((c) => bCases.has(c));
        if (shared.length > 0) {
          const infraValue = [domains[i].entity_value, domains[j].entity_value].sort().join("+");
          addLink(domains[i].id, "dns_record", infraValue, 0.7, null, { shared_cases: shared.length });
          addLink(domains[j].id, "dns_record", infraValue, 0.7, null, { shared_cases: shared.length });
        }
      }
    }
  }

  // IP-to-domain co-observation → shared hosting
  for (const ip of ips) {
    for (const domain of domains) {
      const ipC = entityCases.get(ip.id);
      const dC = entityCases.get(domain.id);
      if (ipC && dC) {
        const shared = [...ipC].filter((c) => dC.has(c));
        if (shared.length > 0) {
          const val = `${ip.entity_value}→${domain.entity_value}`;
          addLink(ip.id, "hosting", val, 0.75, null, { domain: domain.entity_value, shared_cases: shared.length });
          addLink(domain.id, "hosting", val, 0.75, null, { ip: ip.entity_value, shared_cases: shared.length });
        }
      }
    }
  }

  onProgress?.(`Saving ${links.length} infrastructure links...`);

  let linksCreated = 0;
  const batchSize = 50;
  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from("infrastructure_links")
      .upsert(batch as any, { onConflict: "entity_id,infrastructure_type,value" })
      .select("id");
    if (!error && data) linksCreated += data.length;
  }

  onProgress?.("Complete!");
  return { linksCreated, entitiesAnalyzed: entities.length };
}
