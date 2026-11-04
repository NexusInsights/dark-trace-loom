import { readResearchRawBody } from "../../services/research/admission.mjs";
import { profileSeed, profileSourceUrl, canonicalProfileUrl, normalizeProfileInput, observedLinks, validateObservation, validateLookup } from "./publicProfileEvidence";
export { profileSeed, normalizeProfileInput, validateObservation as isObservedPublicProfile, validateLookup as validateProfileSearchResult } from "./publicProfileEvidence";
export interface ProfileLookupInput { username?: string; profileUrl?: string; }
export interface PublicProfileLink {
  platform: string; username: string; profileUrl: string; evidence: string;
  sourceUrl?: string; retrievedAt?: string; sourceAccountId?: string; evidencePath?: string; observedValue?: string;
  relation?: "links_to" | "provider_reported_proof"; targetExistence?: "unverified" | "found" | "not_found" | "unavailable"; targetAccountId?: string;
}
export interface PublicProfile {
  platform: string;
  username: string;
  profileUrl: string;
  sourceUrl: string;
  retrievedAt: string;
  platformId?: string; accountId?: string; existence?: "found"; personAssociation?: "unreviewed";
  evidenceKind?: "public_account" | "provider_match";
  displayName?: string;
  bio?: string;
  location?: string;
  email?: string;
  phone?: string;
  website?: string;
  followers?: number;
  accountCreatedAt?: string;
  avatarUrl?: string;
  relatedProfiles?: PublicProfileLink[];
}
export interface ProfileCheck {
  platform: string;
  sourceUrl: string;
  status: "found" | "not_found" | "unavailable";
  reason?: string;
  retrievedAt?: string;
  profile?: PublicProfile;
}
export interface ProfileSearchResult {
  schemaVersion?: 2; status?: "success" | "partial" | "error"; inputProfileUrl?: string;
  username: string;
  retrievedAt: string;
  profiles: PublicProfile[];
  checks: ProfileCheck[];
  enrichment?: Record<string,unknown>;
}
const text = (v: unknown): string | undefined => typeof v === "string" && v.trim() ? v : undefined;
const safeUrl = (v: unknown): string | undefined => {
  try { const u = new URL(String(v)); return u.protocol === "https:" && !u.username && !u.password && !u.port && u.href.length <= 2000 && u.hostname.includes(".") && !/^[\d.]+$/.test(u.hostname) && !u.hostname.includes(":") && !/(?:^|\.)(localhost|local|internal|invalid)$/.test(u.hostname) ? u.href : undefined; }
  catch { return undefined; }
};

/** Exact account existence only. A shared handle does not establish shared ownership. */
export async function searchPublicProfiles(input: string | ProfileLookupInput, fetcher: typeof fetch = fetch, followLinks = true): Promise<ProfileSearchResult> {
  const normalized = normalizeProfileInput(input), username = normalized.username;
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) throw new Error("Use an exact username of 1–64 letters, digits, dots, underscores or hyphens.");
  const handle = encodeURIComponent(username);
  const retrievedAt = new Date().toISOString();
  const providers = [
    { platform: "GitHub", url: `https://api.github.com/users/${handle}`, parse: (d: Record<string, unknown>): PublicProfile | null => {
      if (!Number.isSafeInteger(d.id) || Number(d.id) < 0 || typeof d.login !== "string" || d.login.toLowerCase() !== username.toLowerCase() || safeUrl(d.html_url)?.replace(/\/$/, "") !== `https://github.com/${encodeURIComponent(d.login)}`) return null;
      return { platform: "GitHub", username: d.login, profileUrl: String(d.html_url), sourceUrl: `https://api.github.com/users/${handle}`, retrievedAt,
        platformId: String(d.id), accountId: `github:${d.id}`, existence: "found", personAssociation: "unreviewed", evidenceKind: "public_account", relatedProfiles: observedLinks("GitHub", String(d.id), d, `https://api.github.com/users/${handle}`, retrievedAt),
        displayName: text(d.name), bio: text(d.bio), location: text(d.location), email: text(d.email), website: safeUrl(d.blog),
        followers: typeof d.followers === "number" ? d.followers : undefined, accountCreatedAt: text(d.created_at), avatarUrl: safeUrl(d.avatar_url) };
    } },
    { platform: "DEV Community", url: `https://dev.to/api/users/by_username?url=${handle}`, parse: (d: Record<string, unknown>): PublicProfile | null => {
      if (!Number.isSafeInteger(d.id) || Number(d.id) < 0 || typeof d.username !== "string" || d.username.toLowerCase() !== username.toLowerCase()) return null;
      return { platform: "DEV Community", username: d.username, profileUrl: `https://dev.to/${encodeURIComponent(d.username)}`, sourceUrl: `https://dev.to/api/users/by_username?url=${handle}`, retrievedAt,
        platformId: String(d.id), accountId: `dev:${d.id}`, existence: "found", personAssociation: "unreviewed", evidenceKind: "public_account", relatedProfiles: observedLinks("DEV Community", String(d.id), d, `https://dev.to/api/users/by_username?url=${handle}`, retrievedAt),
        displayName: text(d.name), bio: text(d.summary), location: text(d.location), website: safeUrl(d.website_url), avatarUrl: safeUrl(d.profile_image) };
    } },
    { platform: "Hacker News", url: `https://hacker-news.firebaseio.com/v0/user/${handle}.json`, parse: (d: Record<string, unknown>): PublicProfile | null => {
      if (typeof d.id !== "string" || d.id !== username || typeof d.created !== "number" || !Number.isFinite(new Date(d.created * 1000).getTime())) return null;
      return { platform: "Hacker News", username: d.id, profileUrl: `https://news.ycombinator.com/user?id=${encodeURIComponent(d.id)}`, sourceUrl: `https://hacker-news.firebaseio.com/v0/user/${handle}.json`, retrievedAt,
        platformId: d.id, accountId: `hackernews:${d.id}`, existence: "found", personAssociation: "unreviewed", evidenceKind: "public_account",
        bio: text(d.about), accountCreatedAt: new Date(d.created * 1000).toISOString() };
    } },
    { platform: "GitLab", url: `https://gitlab.com/api/v4/users?username=${handle}`, parse: (raw: Record<string,unknown>): PublicProfile | null => {
      if (!Array.isArray(raw)) return null;
      const d = raw.find(user => user && typeof user === "object" && typeof user.username === "string" && user.username.toLowerCase() === username.toLowerCase());
      if (!d || !Number.isSafeInteger(d.id) || d.id < 0 || safeUrl(d.web_url)?.replace(/\/$/, "") !== `https://gitlab.com/${encodeURIComponent(d.username)}`) return null;
      return { platform: "GitLab", username: d.username, profileUrl: d.web_url, sourceUrl: `https://gitlab.com/api/v4/users?username=${handle}`, retrievedAt, platformId: String(d.id), accountId: `gitlab:${d.id}`, existence: "found", personAssociation: "unreviewed", evidenceKind: "public_account", relatedProfiles: observedLinks("GitLab", String(d.id), d, `https://gitlab.com/api/v4/users?username=${handle}`, retrievedAt), displayName: text(d.name), bio: text(d.bio), location: text(d.location), email: text(d.public_email), website: safeUrl(d.website_url), avatarUrl: safeUrl(d.avatar_url) };
    } },
    { platform: "Keybase", url: `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${handle}&fields=basics,profile,proofs_summary`, parse: (d: Record<string,unknown>): PublicProfile | null => {
      const status = d.status as { code?: number };
      const users = d.them as Array<{ id?: string; basics?: { username?: string; ctime?: number }; profile?: { full_name?: string; bio?: string; location?: string }; proofs_summary?: { all?: Array<{ nametag?: string; service_url?: string; proof_type?: string; state?: number }> } } | null>;
      const user = Array.isArray(users) ? users.find(u => u?.basics?.username?.toLowerCase() === username.toLowerCase()) : null;
      if (status?.code !== 0 || typeof user?.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(user.id) || !user.basics?.username) return null;
      return { platform: "Keybase", username: user.basics.username, profileUrl: `https://keybase.io/${encodeURIComponent(user.basics.username)}`, sourceUrl: `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${handle}&fields=basics,profile,proofs_summary`, retrievedAt,
        platformId: user.id, accountId: `keybase:${user.id}`, existence: "found", personAssociation: "unreviewed", evidenceKind: "public_account",
        displayName: text(user.profile?.full_name), bio: text(user.profile?.bio), location: text(user.profile?.location), accountCreatedAt: typeof user.basics.ctime === "number" ? new Date(user.basics.ctime * 1000).toISOString() : undefined,
        relatedProfiles: observedLinks("Keybase", user.id, user as unknown as Record<string, unknown>, `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${handle}&fields=basics,profile,proofs_summary`, retrievedAt) };
    } },
  ];
  const selected = normalized.profileUrl ? providers.filter(provider => provider.platform === profileSeed(normalized.profileUrl)?.platform) : providers;
  const checks = await Promise.all(selected.map(async (provider): Promise<ProfileCheck> => {
    const base = { platform: provider.platform, sourceUrl: provider.url };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(provider.url, { headers: { Accept: "application/json", "User-Agent": "Insight-Nexus-Public-Profile-Lookup/1.0" }, signal: controller.signal, redirect: "manual" });
      if (response.status === 404) return { ...base, status: "not_found" };
      if (!response.ok) return { ...base, status: "unavailable", reason: `Provider returned HTTP ${response.status}` };
      if (!(response.headers.get("content-type") || "").includes("json")) return { ...base, status: "unavailable", reason: "Provider returned a non-JSON page; account existence was not established" };
      let data: unknown;
      try { data = JSON.parse(await readResearchRawBody(response, 128 * 1024, { signal: controller.signal, timeoutMs: 10000 })); }
      catch { return { ...base, retrievedAt: new Date().toISOString(), status: "unavailable", reason: "Provider body was invalid, oversized, cancelled or timed out" }; }
      if (data === null && provider.platform === "Hacker News") return { ...base, status: "not_found" };
      if (provider.platform === "GitLab" && Array.isArray(data) && data.length === 0) return { ...base, status: "not_found" };
      const keybase = data && typeof data === "object" && !Array.isArray(data) ? data as { status?: {code?:unknown}; them?:unknown[] } : null;
      if (provider.platform === "Keybase" && keybase?.status?.code === 0 && Array.isArray(keybase.them) && keybase.them.length > 0 && keybase.them.every((user: unknown) => user === null)) return { ...base, status: "not_found" };
      const profile = data && typeof data === "object" ? provider.parse(data as Record<string, unknown>) : null;
      const completedAt = new Date().toISOString();
      if (profile) { profile.retrievedAt = completedAt; for (const link of profile.relatedProfiles ?? []) link.retrievedAt = completedAt; }
      return profile && validateObservation(profile) ? { ...base, retrievedAt: completedAt, status: "found", profile } : { ...base, retrievedAt: completedAt, status: "unavailable", reason: "Response did not contain the requested account record" };
    } catch (error) {
      return { ...base, status: "unavailable", reason: error instanceof Error ? error.message : "Provider request failed" };
    } finally { clearTimeout(timer); }
  }));
  for (const check of checks) check.retrievedAt ||= new Date().toISOString();
  const profiles = checks.flatMap(c => c.profile ? [c.profile] : []);
  if (followLinks) {
    const seen = new Set(checks.map(check => check.platform === "Hacker News" ? check.sourceUrl : check.sourceUrl.toLowerCase())), linked = profiles.flatMap(profile => profile.relatedProfiles ?? []);
    const pivots: { profileUrl: string }[] = [];
    for (const link of linked) {
      const seed = profileSeed(link.profileUrl); if (!seed || pivots.length >= 5) continue;
      const source = profileSourceUrl(seed.platform, seed.username), key = seed.platform === "Hacker News" ? source : source.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key); pivots.push({ profileUrl: link.profileUrl });
      }
    }
    const results = await Promise.all(pivots.map(seed => searchPublicProfiles(seed, fetcher, false)));
    for (const result of results) { checks.push(...result.checks); profiles.push(...result.profiles); }
    for (const link of linked) {
      const seed = profileSeed(link.profileUrl); if (!seed) continue;
      const key = profileSourceUrl(seed.platform, seed.username);
      const targetUrl = canonicalProfileUrl(seed);
      const target = profiles.find(profile => seed.platform === "Hacker News" ? profile.profileUrl === targetUrl : profile.profileUrl.toLowerCase() === targetUrl.toLowerCase());
      link.targetExistence = target ? "found" : checks.find(check => seed.platform === "Hacker News" ? check.sourceUrl === key : check.sourceUrl.toLowerCase() === key.toLowerCase())?.status ?? "unverified";
      link.targetAccountId = target?.accountId;
    }
  }
  return validateLookup({ schemaVersion: 2, status: checks.every(check => check.status === "unavailable") ? "error" : checks.some(check => check.status === "unavailable") ? "partial" : "success", username, retrievedAt, ...(normalized.profileUrl ? { inputProfileUrl: normalized.profileUrl } : {}), profiles, checks });
}
