import type { ProfileLookupInput, ProfileSearchResult, PublicProfile, PublicProfileLink } from "./publicProfiles";
type Seed = { platform: string; username: string };
const ids: Record<string, string> = { GitHub: "github", GitLab: "gitlab", "DEV Community": "dev", "Hacker News": "hackernews", Keybase: "keybase" };
const obj = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const handle = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(value);
const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value.slice(0, 10);
};
const boundedText = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max;
function publicResourceUrl(value: unknown): boolean {
  try { const u = new URL(String(value)); return typeof value === "string" && value.length <= 2000 && u.protocol === "https:" && !u.username && !u.password && !u.port && u.hostname.includes(".") && !/^[\d.]+$/.test(u.hostname) && !u.hostname.includes(":") && !/(?:^|\.)(localhost|local|internal|invalid)$/.test(u.hostname); } catch { return false; }
}
function safe(value: unknown): URL | null {
  try { const u = new URL(String(value)); return typeof value === "string" && value.length <= 2000 && u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash ? u : null; } catch { return null; }
}
export function profileSeed(value: unknown): Seed | null {
  const u = safe(value); if (!u) return null;
  if (u.hostname === "news.ycombinator.com" && u.pathname === "/user" && [...u.searchParams.keys()].length === 1 && handle(u.searchParams.get("id"))) return { platform: "Hacker News", username: u.searchParams.get("id")! };
  const platform = ({ "github.com": "GitHub", "gitlab.com": "GitLab", "dev.to": "DEV Community", "keybase.io": "Keybase" } as Record<string, string>)[u.hostname];
  const match = u.pathname.match(/^\/([a-zA-Z0-9_.-]{1,64})\/?$/);
  return platform && match && !u.search ? { platform, username: match[1] } : null;
}
export function canonicalProfileUrl(seed: Seed): string {
  const user = encodeURIComponent(seed.username);
  return seed.platform === "GitHub" ? `https://github.com/${user}` : seed.platform === "GitLab" ? `https://gitlab.com/${user}` : seed.platform === "DEV Community" ? `https://dev.to/${user}` : seed.platform === "Keybase" ? `https://keybase.io/${user}` : `https://news.ycombinator.com/user?id=${user}`;
}
export function normalizeProfileInput(input: string | ProfileLookupInput): { username: string; profileUrl?: string } {
  const data = typeof input === "string" ? { username: input } : obj(input);
  if (!data || Object.keys(data).some(key => !["username", "profileUrl"].includes(key)) || data.username !== undefined && typeof data.username !== "string" || data.profileUrl !== undefined && typeof data.profileUrl !== "string") throw new Error("Provide an exact username or supported public profile URL.");
  const username = typeof data.username === "string" ? data.username.trim() : "", url = typeof data.profileUrl === "string" ? data.profileUrl.trim() : "";
  if (!!username === !!url) throw new Error("Provide exactly one exact username or supported public profile URL.");
  if (url) { const seed = profileSeed(url); if (!seed) throw new Error("Use a direct GitHub, GitLab, DEV Community, Hacker News or Keybase public profile URL."); return { username: seed.username, profileUrl: canonicalProfileUrl(seed) }; }
  if (!handle(username)) throw new Error("Use an exact username of 1-64 letters, digits, dots, underscores or hyphens.");
  return { username };
}
export function profileSourceUrl(platform: string, username: string): string {
  const user = encodeURIComponent(username);
  return platform === "GitHub" ? `https://api.github.com/users/${user}` : platform === "GitLab" ? `https://gitlab.com/api/v4/users?username=${user}` : platform === "DEV Community" ? `https://dev.to/api/users/by_username?url=${user}` : platform === "Keybase" ? `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${user}&fields=basics,profile,proofs_summary` : `https://hacker-news.firebaseio.com/v0/user/${user}.json`;
}
function equal(platform: string, a: string, b: string): boolean { return platform === "Hacker News" ? a === b : a.toLowerCase() === b.toLowerCase(); }
function sourceHandle(platform: string, value: string): string | null {
  const u = safe(value); if (!u) return null;
  const name = platform === "GitHub" ? u.pathname.split("/")[2] : platform === "GitLab" ? u.searchParams.get("username") : platform === "DEV Community" ? u.searchParams.get("url") : platform === "Keybase" ? u.searchParams.get("usernames") : u.pathname.split("/").at(-1)?.replace(/\.json$/, "");
  return handle(name) && equal(platform, value, profileSourceUrl(platform, name)) ? name : null;
}
function externalSeed(value: unknown): Seed | null {
  const supported = profileSeed(value); if (supported) return supported;
  const u = safe(value), match = u?.pathname.match(/^\/([a-zA-Z0-9_]{1,64})\/?$/);
  return u && ["x.com", "twitter.com"].includes(u.hostname) && !u.search && match ? { platform: "X", username: match[1] } : null;
}
export function observedLinks(platform: string, platformId: string, data: Record<string, unknown>, sourceUrl: string, retrievedAt: string): PublicProfileLink[] {
  const links: PublicProfileLink[] = [];
  function add(url: unknown, path: string, observedValue: unknown, relation: "links_to" | "provider_reported_proof" = "links_to", reportedHandle?: unknown) {
    const seed = externalSeed(url); if (!seed || typeof observedValue !== "string" || links.length >= 20 || reportedHandle !== undefined && (!handle(reportedHandle) || !equal(seed.platform, seed.username, reportedHandle))) return;
    const target = seed.platform === "X" ? `https://x.com/${encodeURIComponent(seed.username)}` : canonicalProfileUrl(seed);
    if (links.some(link => link.profileUrl === target && link.evidencePath === path)) return;
    links.push({ ...seed, profileUrl: target, evidence: `Source field ${path} reports ${JSON.stringify(observedValue)}; account link only, person ownership unverified.`, sourceUrl, retrievedAt, sourceAccountId: `${ids[platform]}:${platformId}`, evidencePath: path, observedValue, relation, targetExistence: "unverified" });
  }
  if (typeof data.blog === "string") add(data.blog, "blog", data.blog);
  if (typeof data.website_url === "string") add(data.website_url, "website_url", data.website_url);
  if (platform === "DEV Community" && handle(data.github_username)) add(`https://github.com/${data.github_username}`, "github_username", data.github_username);
  if (platform === "GitHub" && handle(data.twitter_username)) add(`https://x.com/${data.twitter_username}`, "twitter_username", data.twitter_username);
  const proofs = obj(data.proofs_summary)?.all;
  if (platform === "Keybase" && Array.isArray(proofs)) for (const [index, raw] of proofs.slice(0, 20).entries()) { const proof = obj(raw); if (proof?.state === 1) add(proof.service_url, `proofs_summary.all[${index}].service_url`, proof.service_url, "provider_reported_proof", proof.nametag); }
  return links;
}
/** This validates an observed account record; it never admits person association. */
export function validateObservation(value: unknown): value is PublicProfile {
  const p = obj(value); if (!p || typeof p.platform !== "string" || !ids[p.platform] || !handle(p.username) || typeof p.platformId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.platformId) || p.accountId !== `${ids[p.platform]}:${p.platformId}` || typeof p.profileUrl !== "string" || !equal(p.platform, p.profileUrl.replace(/\/$/, ""), canonicalProfileUrl({ platform: p.platform, username: p.username })) || typeof p.sourceUrl !== "string" || !equal(p.platform, p.sourceUrl, profileSourceUrl(p.platform, p.username)) || !date(p.retrievedAt) || p.existence !== "found" || p.personAssociation !== "unreviewed" || p.evidenceKind !== "public_account") return false;
  if (["GitHub", "GitLab", "DEV Community"].includes(p.platform) && (!/^\d+$/.test(p.platformId) || !Number.isSafeInteger(Number(p.platformId)) || String(Number(p.platformId)) !== p.platformId) || p.platform === "Hacker News" && p.platformId !== p.username) return false;
  for (const [field, max] of Object.entries({ displayName:1000, bio:20000, location:2000, email:320, phone:100 })) if (p[field] !== undefined && !boundedText(p[field], max)) return false;
  if (p.followers !== undefined && (!Number.isSafeInteger(p.followers) || Number(p.followers) < 0) || p.accountCreatedAt !== undefined && !date(p.accountCreatedAt)) return false;
  if (p.website !== undefined && !publicResourceUrl(p.website) || p.avatarUrl !== undefined && !publicResourceUrl(p.avatarUrl)) return false;
  return p.relatedProfiles === undefined || Array.isArray(p.relatedProfiles) && p.relatedProfiles.length <= 20 && p.relatedProfiles.every(raw => { const link = obj(raw), target = externalSeed(link?.profileUrl); return link && target && target.platform === link.platform && equal(target.platform, target.username, String(link.username)) && boundedText(link.evidence,5000) && link.sourceAccountId === p.accountId && link.sourceUrl === p.sourceUrl && link.retrievedAt === p.retrievedAt && boundedText(link.observedValue,2000) && boundedText(link.evidencePath,250) && ["links_to", "provider_reported_proof"].includes(String(link.relation)) && ["unverified", "found", "not_found", "unavailable"].includes(String(link.targetExistence)); });
}
export function validateLookup(value: unknown): ProfileSearchResult {
  const r = obj(value); if (!r || r.schemaVersion !== 2 || !handle(r.username) || !date(r.retrievedAt) || !Array.isArray(r.profiles) || r.profiles.length > 10 || !r.profiles.every(validateObservation) || !Array.isArray(r.checks) || !r.checks.length || r.checks.length > 10) throw new Error("Invalid profile lookup response");
  const profiles = r.profiles as PublicProfile[], checks = r.checks as Array<Record<string, unknown>>;
  for (const c of checks) {
    if (!obj(c) || typeof c.platform !== "string" || !ids[c.platform] || typeof c.sourceUrl !== "string" || !sourceHandle(c.platform, c.sourceUrl) || !date(c.retrievedAt) || c.reason !== undefined && !boundedText(c.reason,2000) || !["found", "not_found", "unavailable"].includes(String(c.status))) throw new Error("Invalid profile lookup source check");
    const profile = c.profile;
    if (c.status === "found" ? !validateObservation(profile) || profile.platform !== c.platform || profile.retrievedAt !== c.retrievedAt || profile.sourceUrl !== c.sourceUrl || !profiles.some(p => p.accountId === profile.accountId && p.sourceUrl === c.sourceUrl && p.platform === c.platform && p.retrievedAt === c.retrievedAt) : profile !== undefined) throw new Error("Invalid profile lookup source check");
  }
  if (profiles.some(p => !checks.some(c => c.status === "found" && c.sourceUrl === p.sourceUrl && obj(c.profile)?.accountId === p.accountId))) throw new Error("Profile observation has no matching source check");
  if (new Set(checks.map(c => c.sourceUrl)).size !== checks.length || new Set(profiles.map(p => p.accountId)).size !== profiles.length) throw new Error("Duplicate profile source checks or account identities");
  for (const p of profiles) for (const link of p.relatedProfiles ?? []) {
    if (link.targetExistence === "found" && !profiles.some(target => target.accountId === link.targetAccountId && equal(target.platform, target.profileUrl, link.profileUrl)) || link.targetExistence !== "found" && link.targetAccountId !== undefined) throw new Error("Explicit link target has no matching account observation");
  }
  const status = r.checks.every(c => c.status === "unavailable") ? "error" : r.checks.some(c => c.status === "unavailable") ? "partial" : "success";
  const seed = r.inputProfileUrl === undefined ? null : profileSeed(r.inputProfileUrl);
  if (r.status !== status || r.inputProfileUrl !== undefined && (!seed || seed.username !== r.username || !checks.some(c => c.platform === seed.platform && typeof c.sourceUrl === "string" && equal(seed.platform,c.sourceUrl,profileSourceUrl(seed.platform,seed.username))))) throw new Error("Invalid profile lookup status or seed");
  return r as unknown as ProfileSearchResult;
}
