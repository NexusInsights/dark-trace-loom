import { supabase } from "@/integrations/supabase/client";

export type CorrelationType = "username" | "email" | "domain" | "ip" | "phone";

interface ExtractedIdentifier {
  type: CorrelationType;
  value: string;
  artifactId: string;
  caseId: string;
}

interface CorrelationMatch {
  sourceType: CorrelationType;
  sourceValue: string;
  sourceCaseId: string;
  sourceArtifactId: string;
  targetType: CorrelationType;
  targetValue: string;
  targetCaseId: string;
  targetArtifactId: string;
  relationshipType: string;
  confidence: number;
}

// Regex patterns for identifier extraction
const PATTERNS: Record<CorrelationType, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  domain: /(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g,
  ip: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  phone: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
  username: /@([a-zA-Z0-9_]{2,30})/g,
};

/** Extract identifiers from text */
function extractIdentifiers(text: string, artifactId: string, caseId: string): ExtractedIdentifier[] {
  const results: ExtractedIdentifier[] = [];
  const seen = new Set<string>();

  for (const [type, regex] of Object.entries(PATTERNS) as [CorrelationType, RegExp][]) {
    const re = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const value = (type === "username" ? match[1] : match[0]).toLowerCase();
      // Skip common false positives
      if (type === "domain" && /^(localhost|example\.com|test\.\w+)$/i.test(value)) continue;
      if (type === "ip" && (value === "0.0.0.0" || value === "127.0.0.1" || value.startsWith("255."))) continue;

      const key = `${type}:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ type, value, artifactId, caseId });
      }
    }
  }

  return results;
}

/** Find correlations across all identifiers */
function findCorrelations(identifiers: ExtractedIdentifier[]): CorrelationMatch[] {
  const matches: CorrelationMatch[] = [];
  const seen = new Set<string>();

  // Group by value
  const byValue = new Map<string, ExtractedIdentifier[]>();
  for (const id of identifiers) {
    const key = `${id.type}:${id.value}`;
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key)!.push(id);
  }

  // Find cross-case matches (same value appearing in different cases)
  for (const [, group] of byValue) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].caseId === group[j].caseId) continue;
        const pairKey = [group[i].artifactId, group[j].artifactId].sort().join(":");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        matches.push({
          sourceType: group[i].type,
          sourceValue: group[i].value,
          sourceCaseId: group[i].caseId,
          sourceArtifactId: group[i].artifactId,
          targetType: group[j].type,
          targetValue: group[j].value,
          targetCaseId: group[j].caseId,
          targetArtifactId: group[j].artifactId,
          relationshipType: `shared_${group[i].type}`,
          confidence: 1.0,
        });
      }
    }
  }

  // Cross-type correlations: email domain ↔ domain
  const emails = identifiers.filter((id) => id.type === "email");
  const domains = identifiers.filter((id) => id.type === "domain");
  for (const email of emails) {
    const emailDomain = email.value.split("@")[1];
    for (const domain of domains) {
      if (domain.caseId === email.caseId) continue;
      if (emailDomain === domain.value) {
        const pairKey = [email.artifactId, domain.artifactId].sort().join(":domain:");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        matches.push({
          sourceType: "email",
          sourceValue: email.value,
          sourceCaseId: email.caseId,
          sourceArtifactId: email.artifactId,
          targetType: "domain",
          targetValue: domain.value,
          targetCaseId: domain.caseId,
          targetArtifactId: domain.artifactId,
          relationshipType: "email_domain_match",
          confidence: 0.85,
        });
      }
    }
  }

  return matches;
}

/** Run correlation engine across all user's cases */
export async function runCorrelationEngine(
  userId: string,
  onProgress?: (step: string) => void
): Promise<{ correlationsFound: number; identifiersScanned: number }> {
  onProgress?.("Loading cases...");
  const { data: cases, error: casesError } = await supabase
    .from("cases")
    .select("id, title")
    .order("created_at", { ascending: false });

  if (casesError) throw new Error(`Failed to load cases: ${casesError.message}`);
  if (!cases || cases.length < 2) {
    return { correlationsFound: 0, identifiersScanned: 0 };
  }

  onProgress?.(`Scanning artifacts across ${cases.length} cases...`);
  const caseIds = cases.map((c) => c.id);
  const { data: artifacts, error: artError } = await supabase
    .from("artifacts")
    .select("id, case_id, data, artifact_type")
    .in("case_id", caseIds);

  if (artError) throw new Error(`Failed to load artifacts: ${artError.message}`);

  // Also scan subjects
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, case_id, name, notes, type")
    .in("case_id", caseIds);

  onProgress?.("Extracting identifiers...");
  const allIdentifiers: ExtractedIdentifier[] = [];

  for (const a of artifacts ?? []) {
    if (a.data) {
      allIdentifiers.push(...extractIdentifiers(a.data, a.id, a.case_id));
    }
  }

  // Treat subject names as potential identifiers
  for (const s of subjects ?? []) {
    const text = [s.name, s.notes ?? ""].join(" ");
    // Create a pseudo artifact ID for subjects
    allIdentifiers.push(...extractIdentifiers(text, s.id, s.case_id));
  }

  onProgress?.(`Found ${allIdentifiers.length} identifiers. Correlating...`);
  const correlations = findCorrelations(allIdentifiers);

  if (correlations.length > 0) {
    onProgress?.(`Saving ${correlations.length} correlations...`);
    // Clear old correlations for this user
    await supabase.from("cross_case_correlations").delete().eq("user_id", userId);

    // Insert new correlations in batches
    const batchSize = 50;
    for (let i = 0; i < correlations.length; i += batchSize) {
      const batch = correlations.slice(i, i + batchSize).map((c) => ({
        user_id: userId,
        source_case_id: c.sourceCaseId,
        source_type: c.sourceType,
        source_value: c.sourceValue,
        source_artifact_id: c.sourceArtifactId,
        target_case_id: c.targetCaseId,
        target_type: c.targetType,
        target_value: c.targetValue,
        target_artifact_id: c.targetArtifactId,
        relationship_type: c.relationshipType,
        confidence: c.confidence,
      }));

      const { error } = await supabase.from("cross_case_correlations").insert(batch);
      if (error) console.error("Batch insert error:", error.message);
    }
  }

  onProgress?.("Complete!");
  return {
    correlationsFound: correlations.length,
    identifiersScanned: allIdentifiers.length,
  };
}
