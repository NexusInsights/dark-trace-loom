import { supabase } from "@/integrations/supabase/client";

interface UsernameCandidate {
  username: string;
  confidence: number;
  method: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function generateUsernameCandidates(
  firstName?: string,
  lastName?: string,
  knownUsername?: string
): UsernameCandidate[] {
  const results: UsernameCandidate[] = [];
  const seen = new Set<string>();

  function add(u: string, confidence: number, method: string) {
    const clean = u.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (clean.length < 2 || seen.has(clean)) return;
    seen.add(clean);
    results.push({ username: clean, confidence, method });
  }

  const f = firstName ? normalize(firstName) : "";
  const l = lastName ? normalize(lastName) : "";
  const known = knownUsername?.toLowerCase().replace(/[^a-z0-9._-]/g, "") ?? "";

  // Known username as seed
  if (known) {
    add(known, 1.0, "input");
    add(known.replace(/[._-]/g, ""), 0.85, "strip_separators");
    add(known.replace(/[._-]/g, "_"), 0.8, "normalize_underscore");
    add(known.replace(/[._-]/g, "."), 0.8, "normalize_dot");
    add(`${known}_`, 0.6, "trailing_underscore");
    add(`_${known}`, 0.6, "leading_underscore");
    add(`the${known}`, 0.65, "prefix_the");
    add(`real${known}`, 0.6, "prefix_real");
    add(`official${known}`, 0.55, "prefix_official");
    add(`${known}official`, 0.55, "suffix_official");
    add(`x${known}`, 0.5, "prefix_x");
    add(`${known}x`, 0.5, "suffix_x");
    for (const n of ["1", "2", "11", "12", "13", "21", "22", "23", "69", "77", "88", "99", "123", "007", "101", "420", "666", "777", "911", "000"]) {
      add(`${known}${n}`, 0.55, "numeric_suffix");
    }
    // Year suffixes
    for (let y = 90; y <= 99; y++) add(`${known}${y}`, 0.5, "year_suffix_90s");
    for (let y = 0; y <= 9; y++) add(`${known}0${y}`, 0.5, "year_suffix_00s");
  }

  if (f && l) {
    // Core name patterns
    add(`${f}${l}`, 0.9, "firstlast");
    add(`${l}${f}`, 0.85, "lastfirst");
    add(`${f}.${l}`, 0.88, "first.last");
    add(`${f}_${l}`, 0.88, "first_last");
    add(`${f}-${l}`, 0.85, "first-last");
    add(`${l}.${f}`, 0.8, "last.first");
    add(`${l}_${f}`, 0.8, "last_first");
    add(`${l}-${f}`, 0.78, "last-first");

    // Initial patterns
    add(`${f[0]}${l}`, 0.75, "f_initial_last");
    add(`${f}${l[0]}`, 0.75, "first_l_initial");
    add(`${f[0]}.${l}`, 0.72, "f_dot_last");
    add(`${f[0]}${l[0]}`, 0.4, "initials");
    add(`${l}${f[0]}`, 0.7, "last_f_initial");
    add(`${f[0]}_${l}`, 0.7, "f_underscore_last");

    // Nickname: first 3-4 chars
    if (f.length >= 4) {
      const nick = f.slice(0, 4);
      add(nick, 0.5, "nickname_short");
      add(`${nick}${l}`, 0.6, "nickname_last");
      add(`${nick}_${l}`, 0.58, "nickname_underscore_last");
      add(`${nick}${l[0]}`, 0.55, "nickname_l_initial");
    }
    if (f.length >= 3) {
      const nick3 = f.slice(0, 3);
      add(`${nick3}${l}`, 0.58, "nick3_last");
    }

    // With numbers
    for (const n of ["1", "123", "007", "99"]) {
      add(`${f}${l}${n}`, 0.65, "firstlast_num");
      add(`${f}.${l}${n}`, 0.6, "first.last_num");
    }

    // Common leet/substitutions
    const leetF = f.replace(/a/g, "4").replace(/e/g, "3").replace(/i/g, "1").replace(/o/g, "0");
    if (leetF !== f) add(`${leetF}${l}`, 0.45, "leet_first");

    // Reversed
    add([...f].reverse().join(""), 0.35, "reversed_first");
  } else if (f) {
    add(f, 0.7, "first_only");
    if (f.length >= 4) add(f.slice(0, 4), 0.45, "nickname_short");
    for (const n of ["1", "123", "99"]) add(`${f}${n}`, 0.5, "first_num");
  } else if (l) {
    add(l, 0.7, "last_only");
    for (const n of ["1", "123"]) add(`${l}${n}`, 0.5, "last_num");
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

export async function runUsernamePermutation(
  userId: string,
  personaId: string,
  firstName?: string,
  lastName?: string,
  knownUsername?: string,
  onProgress?: (step: string) => void
): Promise<{ candidatesGenerated: number }> {
  onProgress?.("Generating username variations...");
  const candidates = generateUsernameCandidates(firstName, lastName, knownUsername);

  onProgress?.(`Saving ${candidates.length} candidates...`);
  const batchSize = 50;
  let total = 0;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize).map((c) => ({
      persona_id: personaId,
      user_id: userId,
      candidate_username: c.username,
      confidence_score: c.confidence,
      generation_method: c.method,
    }));
    const { data } = await supabase
      .from("username_candidates")
      .upsert(batch, { ignoreDuplicates: true })
      .select("id");
    if (data) total += data.length;
  }

  onProgress?.("Complete!");
  return { candidatesGenerated: total };
}
