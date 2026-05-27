import { supabase } from "@/integrations/supabase/client";

interface RecommendationRule {
  triggerType: string;
  pattern: (value: string, subjectType: string) => boolean;
  tool: string;
  toolDescription: string;
  confidence: number;
}

const RULES: RecommendationRule[] = [
  // Email triggers
  { triggerType: "email", pattern: (_, t) => t === "email" || t === "person", tool: "breach_search", toolDescription: "Search for email in known data breaches", confidence: 0.95 },
  { triggerType: "email", pattern: (v) => v.includes("@"), tool: "email_reputation", toolDescription: "Check email reputation and deliverability", confidence: 0.9 },
  { triggerType: "email", pattern: (v) => v.includes("@"), tool: "social_lookup", toolDescription: "Find social profiles linked to email", confidence: 0.85 },
  { triggerType: "email", pattern: (v) => v.includes("@"), tool: "domain_whois", toolDescription: "WHOIS lookup on email domain", confidence: 0.7 },

  // Domain triggers
  { triggerType: "domain", pattern: (_, t) => t === "domain", tool: "dns_lookup", toolDescription: "Enumerate DNS records for domain", confidence: 0.95 },
  { triggerType: "domain", pattern: (_, t) => t === "domain", tool: "subdomain_scan", toolDescription: "Discover subdomains", confidence: 0.9 },
  { triggerType: "domain", pattern: (_, t) => t === "domain", tool: "ssl_cert_scan", toolDescription: "Analyze SSL certificates", confidence: 0.85 },
  { triggerType: "domain", pattern: (_, t) => t === "domain", tool: "infrastructure_map", toolDescription: "Map hosting and IP infrastructure", confidence: 0.88 },
  { triggerType: "domain", pattern: (_, t) => t === "domain", tool: "domain_whois", toolDescription: "WHOIS registration lookup", confidence: 0.92 },

  // Person triggers
  { triggerType: "person", pattern: (_, t) => t === "person", tool: "username_search", toolDescription: "Search for usernames across platforms", confidence: 0.9 },
  { triggerType: "person", pattern: (_, t) => t === "person", tool: "social_lookup", toolDescription: "Find social media profiles", confidence: 0.88 },
  { triggerType: "person", pattern: (_, t) => t === "person", tool: "breach_search", toolDescription: "Check for appearances in data breaches", confidence: 0.8 },
  { triggerType: "person", pattern: (_, t) => t === "person", tool: "public_records", toolDescription: "Search public records databases", confidence: 0.75 },

  // IP triggers
  { triggerType: "ip", pattern: (_, t) => t === "ip", tool: "ip_geolocation", toolDescription: "Geolocate IP address", confidence: 0.95 },
  { triggerType: "ip", pattern: (_, t) => t === "ip", tool: "port_scan", toolDescription: "Scan open ports and services", confidence: 0.85 },
  { triggerType: "ip", pattern: (_, t) => t === "ip", tool: "reverse_dns", toolDescription: "Reverse DNS lookup", confidence: 0.9 },
  { triggerType: "ip", pattern: (_, t) => t === "ip", tool: "abuse_check", toolDescription: "Check IP abuse databases", confidence: 0.88 },

  // Organization triggers
  { triggerType: "org", pattern: (_, t) => t === "org" || t === "organization", tool: "company_lookup", toolDescription: "Look up company registration details", confidence: 0.9 },
  { triggerType: "org", pattern: (_, t) => t === "org" || t === "organization", tool: "employee_search", toolDescription: "Discover employees and key personnel", confidence: 0.8 },
  { triggerType: "org", pattern: (_, t) => t === "org" || t === "organization", tool: "domain_discovery", toolDescription: "Find domains owned by organization", confidence: 0.85 },

  // Username triggers
  { triggerType: "username", pattern: (_, t) => t === "username", tool: "username_search", toolDescription: "Search username across 200+ platforms", confidence: 0.95 },
  { triggerType: "username", pattern: (_, t) => t === "username", tool: "social_lookup", toolDescription: "Find social profiles for username", confidence: 0.9 },
  { triggerType: "username", pattern: (_, t) => t === "username", tool: "breach_search", toolDescription: "Check username in breach databases", confidence: 0.8 },

  // Phone triggers
  { triggerType: "phone", pattern: (_, t) => t === "phone", tool: "phone_lookup", toolDescription: "Carrier and registration lookup", confidence: 0.9 },
  { triggerType: "phone", pattern: (_, t) => t === "phone", tool: "social_lookup", toolDescription: "Find accounts linked to phone number", confidence: 0.85 },
];

export async function generateSuggestions(
  userId: string,
  caseId: string,
  onProgress?: (step: string) => void
): Promise<number> {
  onProgress?.("Loading case subjects and artifacts...");

  const [{ data: subjects }, { data: artifacts }] = await Promise.all([
    supabase.from("subjects").select("*").eq("case_id", caseId),
    supabase.from("artifacts").select("*").eq("case_id", caseId),
  ]);

  const triggers: { value: string; type: string }[] = [];

  for (const s of subjects ?? []) {
    triggers.push({ value: s.name, type: s.type });
  }
  for (const a of artifacts ?? []) {
    triggers.push({ value: a.data ?? a.artifact_type, type: a.artifact_type });
  }

  if (!triggers.length) {
    onProgress?.("No subjects or artifacts to analyze.");
    return 0;
  }

  onProgress?.(`Analyzing ${triggers.length} triggers...`);

  const suggestions: {
    case_id: string;
    user_id: string;
    trigger_type: string;
    trigger_value: string;
    recommended_tool: string;
    tool_description: string;
    confidence_score: number;
    metadata: Record<string, unknown>;
  }[] = [];

  for (const trigger of triggers) {
    for (const rule of RULES) {
      if (rule.pattern(trigger.value, trigger.type)) {
        suggestions.push({
          case_id: caseId,
          user_id: userId,
          trigger_type: rule.triggerType,
          trigger_value: trigger.value,
          recommended_tool: rule.tool,
          tool_description: rule.toolDescription,
          confidence_score: rule.confidence,
          metadata: { source_type: trigger.type },
        });
      }
    }
  }

  if (!suggestions.length) {
    onProgress?.("No recommendations generated.");
    return 0;
  }

  // Deduplicate
  const unique = new Map<string, typeof suggestions[0]>();
  for (const s of suggestions) {
    const key = `${s.trigger_value}::${s.recommended_tool}`;
    if (!unique.has(key) || unique.get(key)!.confidence_score < s.confidence_score) {
      unique.set(key, s);
    }
  }

  const deduped = Array.from(unique.values());
  onProgress?.(`Saving ${deduped.length} recommendations...`);

  // Delete existing non-executed suggestions for this case
  await supabase
    .from("investigation_suggestions")
    .delete()
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .eq("executed", false);

  let created = 0;
  const batchSize = 50;
  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from("investigation_suggestions")
      .upsert(batch as any, { onConflict: "case_id,trigger_value,recommended_tool" })
      .select("id");
    if (!error && data) created += data.length;
  }

  onProgress?.("Complete!");
  return created;
}
