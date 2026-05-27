import { supabase } from "@/integrations/supabase/client";

interface EmailCandidate {
  email: string;
  confidence: number;
  method: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function generateEmailCandidates(
  firstName?: string,
  lastName?: string,
  knownDomains?: string[],
  companyDomains?: string[]
): EmailCandidate[] {
  const results: EmailCandidate[] = [];
  const seen = new Set<string>();

  function add(email: string, confidence: number, method: string) {
    const clean = email.toLowerCase().trim();
    if (!clean.includes("@") || seen.has(clean)) return;
    seen.add(clean);
    results.push({ email: clean, confidence, method });
  }

  const f = firstName ? norm(firstName) : "";
  const l = lastName ? norm(lastName) : "";

  const allDomains = [
    ...(companyDomains ?? []).map((d) => ({ domain: d.toLowerCase().trim(), isCompany: true })),
    ...(knownDomains ?? []).map((d) => ({ domain: d.toLowerCase().trim(), isCompany: false })),
  ];

  // Add common free providers as fallback
  const freeProviders = ["gmail.com", "yahoo.com", "outlook.com", "protonmail.com", "hotmail.com", "icloud.com"];
  for (const fp of freeProviders) {
    if (!allDomains.some((d) => d.domain === fp)) {
      allDomains.push({ domain: fp, isCompany: false });
    }
  }

  for (const { domain, isCompany } of allDomains) {
    if (!domain || domain.length < 3) continue;
    const boost = isCompany ? 0.15 : 0;

    if (f && l) {
      add(`${f}.${l}@${domain}`, 0.92 + boost, "first.last");
      add(`${f}${l}@${domain}`, 0.88 + boost, "firstlast");
      add(`${f[0]}.${l}@${domain}`, 0.82 + boost, "f.last");
      add(`${f[0]}${l}@${domain}`, 0.80 + boost, "flast");
      add(`${f}@${domain}`, 0.70 + boost, "first");
      add(`${l}.${f}@${domain}`, 0.78 + boost, "last.first");
      add(`${l}${f}@${domain}`, 0.75 + boost, "lastfirst");
      add(`${l}${f[0]}@${domain}`, 0.72 + boost, "lastf");
      add(`${f}_${l}@${domain}`, 0.76 + boost, "first_last");
      add(`${f}-${l}@${domain}`, 0.74 + boost, "first-last");
      add(`${l}_${f}@${domain}`, 0.68 + boost, "last_first");
      add(`${f[0]}${l[0]}@${domain}`, 0.35 + boost, "initials");

      // With numbers
      for (const n of ["1", "123", "01"]) {
        add(`${f}.${l}${n}@${domain}`, 0.55 + boost, "first.last_num");
        add(`${f}${l}${n}@${domain}`, 0.52 + boost, "firstlast_num");
      }

      // Nickname (first 3-4 chars)
      if (f.length >= 4) {
        const nick = f.slice(0, 4);
        add(`${nick}.${l}@${domain}`, 0.58 + boost, "nick.last");
        add(`${nick}${l}@${domain}`, 0.55 + boost, "nicklast");
      }
    } else if (f) {
      add(`${f}@${domain}`, 0.65 + boost, "first_only");
      for (const n of ["1", "123"]) add(`${f}${n}@${domain}`, 0.45 + boost, "first_num");
    } else if (l) {
      add(`${l}@${domain}`, 0.65 + boost, "last_only");
    }
  }

  // Cap at 1.0
  for (const r of results) r.confidence = Math.min(r.confidence, 1.0);

  return results.sort((a, b) => b.confidence - a.confidence);
}

export async function runEmailPermutation(
  userId: string,
  personaId: string,
  firstName?: string,
  lastName?: string,
  knownDomains?: string[],
  companyDomains?: string[],
  onProgress?: (step: string) => void
): Promise<{ candidatesGenerated: number }> {
  onProgress?.("Generating email permutations...");
  const candidates = generateEmailCandidates(firstName, lastName, knownDomains, companyDomains);

  onProgress?.(`Saving ${candidates.length} candidates...`);
  const batchSize = 50;
  let total = 0;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize).map((c) => ({
      persona_id: personaId,
      user_id: userId,
      candidate_email: c.email,
      confidence_score: c.confidence,
      generation_method: c.method,
    }));
    const { data } = await supabase
      .from("email_candidates")
      .upsert(batch, { ignoreDuplicates: true })
      .select("id");
    if (data) total += data.length;
  }

  onProgress?.("Complete!");
  return { candidatesGenerated: total };
}
