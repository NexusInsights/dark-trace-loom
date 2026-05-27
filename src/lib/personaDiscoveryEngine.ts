import { supabase } from "@/integrations/supabase/client";

export interface PersonaInput {
  name?: string;
  username?: string;
  email?: string;
  domain?: string;
  phone?: string;
}

interface GeneratedIdentifier {
  type: string;
  value: string;
  confidence: number;
  source: string;
}

function generateUsernameVariations(base: string): GeneratedIdentifier[] {
  const clean = base.replace(/[^a-zA-Z0-9_.-]/g, "").toLowerCase();
  if (clean.length < 2) return [];
  const results: GeneratedIdentifier[] = [];
  const variations = [
    clean,
    clean.replace(/[._-]/g, ""),
    clean.replace(/[._-]/g, "_"),
    clean.replace(/[._-]/g, "."),
    `${clean}_`,
    `_${clean}`,
    `${clean}1`,
    `${clean}123`,
    `the${clean}`,
    `real${clean}`,
    `official${clean}`,
    `${clean}official`,
  ];
  const seen = new Set<string>();
  for (const v of variations) {
    if (v.length >= 2 && !seen.has(v)) {
      seen.add(v);
      results.push({ type: "username", value: v, confidence: v === clean ? 1.0 : 0.6, source: "username_variation" });
    }
  }
  return results;
}

function generateEmailPermutations(name?: string, username?: string, domain?: string, email?: string): GeneratedIdentifier[] {
  const results: GeneratedIdentifier[] = [];
  const domains = ["gmail.com", "yahoo.com", "outlook.com", "protonmail.com", "hotmail.com"];
  if (domain) domains.unshift(domain);

  const locals: string[] = [];
  if (email) {
    const [local] = email.split("@");
    if (local) locals.push(local.toLowerCase());
  }
  if (username) locals.push(username.toLowerCase().replace(/[^a-z0-9._-]/g, ""));
  if (name) {
    const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      locals.push(`${parts[0]}.${parts[parts.length - 1]}`);
      locals.push(`${parts[0]}${parts[parts.length - 1]}`);
      locals.push(`${parts[0][0]}${parts[parts.length - 1]}`);
      locals.push(`${parts[parts.length - 1]}${parts[0][0]}`);
    } else if (parts.length === 1) {
      locals.push(parts[0]);
    }
  }

  const seen = new Set<string>();
  if (email) seen.add(email.toLowerCase());

  for (const local of [...new Set(locals)]) {
    if (local.length < 2) continue;
    for (const d of domains) {
      const addr = `${local}@${d}`;
      if (!seen.has(addr)) {
        seen.add(addr);
        results.push({ type: "email", value: addr, confidence: 0.5, source: "email_permutation" });
      }
    }
  }
  return results;
}

function generateSocialHandles(username?: string, name?: string): GeneratedIdentifier[] {
  const results: GeneratedIdentifier[] = [];
  const platforms = ["twitter.com", "instagram.com", "github.com", "linkedin.com", "facebook.com"];
  const handles: string[] = [];

  if (username) handles.push(username.toLowerCase().replace(/[^a-z0-9_.-]/g, ""));
  if (name) {
    const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      handles.push(`${parts[0]}${parts[parts.length - 1]}`);
      handles.push(`${parts[0]}.${parts[parts.length - 1]}`);
    }
  }

  const seen = new Set<string>();
  for (const h of [...new Set(handles)]) {
    if (h.length < 2) continue;
    for (const p of platforms) {
      const url = `https://${p}/${h}`;
      if (!seen.has(url)) {
        seen.add(url);
        results.push({ type: "social_profile", value: url, confidence: 0.45, source: "social_handle_guess" });
      }
    }
  }
  return results;
}

function generateDomainGuesses(name?: string, username?: string, domain?: string): GeneratedIdentifier[] {
  const results: GeneratedIdentifier[] = [];
  const tlds = [".com", ".net", ".org", ".io", ".dev"];
  const bases: string[] = [];

  if (domain) {
    results.push({ type: "domain", value: domain.toLowerCase(), confidence: 1.0, source: "input" });
  }
  if (username) bases.push(username.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (name) {
    const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) bases.push(`${parts[0]}${parts[parts.length - 1]}`);
    else if (parts.length === 1) bases.push(parts[0]);
  }

  const seen = new Set<string>(domain ? [domain.toLowerCase()] : []);
  for (const b of [...new Set(bases)]) {
    if (b.length < 3) continue;
    for (const tld of tlds) {
      const d = b + tld;
      if (!seen.has(d)) {
        seen.add(d);
        results.push({ type: "domain", value: d, confidence: 0.35, source: "domain_guess" });
      }
    }
  }
  return results;
}

export async function runPersonaDiscovery(
  userId: string,
  input: PersonaInput,
  onProgress?: (step: string) => void
): Promise<{ personaId: string; identifiersGenerated: number }> {
  // Sanitize inputs
  const sanitized: PersonaInput = {
    name: input.name?.trim().slice(0, 200),
    username: input.username?.trim().slice(0, 100).replace(/[^a-zA-Z0-9._\-@]/g, ""),
    email: input.email?.trim().slice(0, 255).toLowerCase(),
    domain: input.domain?.trim().slice(0, 253).toLowerCase(),
    phone: input.phone?.trim().slice(0, 30).replace(/[^+\d\s()-]/g, ""),
  };

  const label = sanitized.name || sanitized.username || sanitized.email?.split("@")[0] || "Unknown";
  onProgress?.("Creating persona record...");

  const { data: persona, error: pErr } = await supabase
    .from("personas")
    .insert({ user_id: userId, persona_label: label })
    .select("id")
    .single();

  if (pErr || !persona) throw new Error(`Failed to create persona: ${pErr?.message}`);

  onProgress?.("Generating identifier variations...");

  const allIds: GeneratedIdentifier[] = [];

  // Seed inputs as high-confidence
  if (sanitized.username) allIds.push({ type: "username", value: sanitized.username.toLowerCase(), confidence: 1.0, source: "input" });
  if (sanitized.email) allIds.push({ type: "email", value: sanitized.email.toLowerCase(), confidence: 1.0, source: "input" });
  if (sanitized.phone) allIds.push({ type: "phone", value: sanitized.phone, confidence: 1.0, source: "input" });
  if (sanitized.name) allIds.push({ type: "name", value: sanitized.name, confidence: 1.0, source: "input" });

  allIds.push(...generateUsernameVariations(sanitized.username || sanitized.name || ""));
  allIds.push(...generateEmailPermutations(sanitized.name, sanitized.username, sanitized.domain, sanitized.email));
  allIds.push(...generateSocialHandles(sanitized.username, sanitized.name));
  allIds.push(...generateDomainGuesses(sanitized.name, sanitized.username, sanitized.domain));

  // Deduplicate & cap at 500
  const seen = new Set<string>();
  const unique = allIds.filter((id) => {
    const key = `${id.type}:${id.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);

  onProgress?.(`Saving ${unique.length} identifiers...`);

  const batchSize = 50;
  let total = 0;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize).map((id) => ({
      persona_id: persona.id,
      user_id: userId,
      identifier_type: id.type,
      identifier_value: id.value,
      confidence_score: id.confidence,
      source: id.source,
    }));
    const { data } = await supabase.from("persona_identifiers").upsert(batch, { ignoreDuplicates: true }).select("id");
    if (data) total += data.length;
  }

  // Cross-reference with existing identity entities
  onProgress?.("Cross-referencing with known entities...");
  const inputValues = unique.filter((u) => u.confidence >= 0.8).map((u) => u.value);
  if (inputValues.length > 0) {
    const { data: matches } = await supabase
      .from("identity_entities")
      .select("id, entity_type, entity_value")
      .eq("user_id", userId)
      .in("entity_value", inputValues.slice(0, 100));

    if (matches?.length) {
      onProgress?.(`Found ${matches.length} existing entity matches`);
    }
  }

  onProgress?.("Complete!");
  return { personaId: persona.id, identifiersGenerated: total };
}
