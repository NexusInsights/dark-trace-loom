export interface PublicProfile {
  platform: string;
  username: string;
  profileUrl: string;
  sourceUrl: string;
  retrievedAt: string;
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
  relatedProfiles?: { platform: string; username: string; profileUrl: string; evidence: string }[];
}
export interface ProfileCheck {
  platform: string;
  sourceUrl: string;
  status: "found" | "not_found" | "unavailable";
  reason?: string;
  profile?: PublicProfile;
}
export interface ProfileSearchResult {
  username: string;
  retrievedAt: string;
  profiles: PublicProfile[];
  checks: ProfileCheck[];
  enrichment?: Record<string,unknown>;
}
const text = (v: unknown): string | undefined => typeof v === "string" && v.trim() ? v : undefined;
const safeUrl = (v: unknown): string | undefined => {
  try { const u = new URL(String(v)); return ["https:", "http:"].includes(u.protocol) ? u.href : undefined; }
  catch { return undefined; }
};

/** Exact account existence only. A shared handle does not establish shared ownership. */
export async function searchPublicProfiles(username: string, fetcher: typeof fetch = fetch): Promise<ProfileSearchResult> {
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) throw new Error("Use an exact username of 1–64 letters, digits, dots, underscores or hyphens.");
  const handle = encodeURIComponent(username);
  const retrievedAt = new Date().toISOString();
  const providers = [
    { platform: "GitHub", url: `https://api.github.com/users/${handle}`, parse: (d: Record<string, unknown>): PublicProfile | null => {
      if (typeof d.id !== "number" || typeof d.login !== "string" || d.login.toLowerCase() !== username.toLowerCase() || !safeUrl(d.html_url)) return null;
      return { platform: "GitHub", username: d.login, profileUrl: String(d.html_url), sourceUrl: `https://api.github.com/users/${handle}`, retrievedAt,
        displayName: text(d.name), bio: text(d.bio), location: text(d.location), email: text(d.email), website: safeUrl(d.blog),
        followers: typeof d.followers === "number" ? d.followers : undefined, accountCreatedAt: text(d.created_at), avatarUrl: safeUrl(d.avatar_url) };
    } },
    { platform: "DEV Community", url: `https://dev.to/api/users/by_username?url=${handle}`, parse: (d: Record<string, unknown>): PublicProfile | null => {
      if (typeof d.id !== "number" || typeof d.username !== "string" || d.username.toLowerCase() !== username.toLowerCase()) return null;
      return { platform: "DEV Community", username: d.username, profileUrl: `https://dev.to/${encodeURIComponent(d.username)}`, sourceUrl: `https://dev.to/api/users/by_username?url=${handle}`, retrievedAt,
        displayName: text(d.name), bio: text(d.summary), location: text(d.location), website: safeUrl(d.website_url), avatarUrl: safeUrl(d.profile_image) };
    } },
    { platform: "Hacker News", url: `https://hacker-news.firebaseio.com/v0/user/${handle}.json`, parse: (d: Record<string, unknown>): PublicProfile | null => {
      if (typeof d.id !== "string" || d.id !== username || typeof d.created !== "number") return null;
      return { platform: "Hacker News", username: d.id, profileUrl: `https://news.ycombinator.com/user?id=${encodeURIComponent(d.id)}`, sourceUrl: `https://hacker-news.firebaseio.com/v0/user/${handle}.json`, retrievedAt,
        bio: text(d.about), accountCreatedAt: new Date(d.created * 1000).toISOString() };
    } },
    { platform: "GitLab", url: `https://gitlab.com/api/v4/users?username=${handle}`, parse: (raw: Record<string,unknown>): PublicProfile | null => {
      if (!Array.isArray(raw)) return null;
      const d = raw.find(user => typeof user.username === "string" && user.username.toLowerCase() === username.toLowerCase());
      if (!d || typeof d.id !== "number" || !safeUrl(d.web_url)) return null;
      return { platform: "GitLab", username: d.username, profileUrl: d.web_url, sourceUrl: `https://gitlab.com/api/v4/users?username=${handle}`, retrievedAt, displayName: text(d.name), bio: text(d.bio), location: text(d.location), email: text(d.public_email), website: safeUrl(d.website_url), avatarUrl: safeUrl(d.avatar_url) };
    } },
    { platform: "Keybase", url: `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${handle}&fields=basics,profile,proofs_summary`, parse: (d: Record<string,unknown>): PublicProfile | null => {
      const status = d.status as { code?: number };
      const users = d.them as Array<{ id?: string; basics?: { username?: string; ctime?: number }; profile?: { full_name?: string; bio?: string; location?: string }; proofs_summary?: { all?: Array<{ nametag?: string; service_url?: string; proof_type?: string; state?: number }> } } | null>;
      const user = Array.isArray(users) ? users.find(u => u?.basics?.username?.toLowerCase() === username.toLowerCase()) : null;
      if (status?.code !== 0 || !user?.id || !user.basics?.username) return null;
      return { platform: "Keybase", username: user.basics.username, profileUrl: `https://keybase.io/${encodeURIComponent(user.basics.username)}`, sourceUrl: `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${handle}&fields=basics,profile,proofs_summary`, retrievedAt,
        displayName: text(user.profile?.full_name), bio: text(user.profile?.bio), location: text(user.profile?.location), accountCreatedAt: typeof user.basics.ctime === "number" ? new Date(user.basics.ctime * 1000).toISOString() : undefined,
        relatedProfiles: (user.proofs_summary?.all || []).filter(proof => proof.state === 1 && safeUrl(proof.service_url) && text(proof.nametag)).map(proof => ({ platform: proof.proof_type || "External profile", username: proof.nametag!, profileUrl: safeUrl(proof.service_url)!, evidence: "Active identity proof reported by Keybase; review the source proof" })) };
    } },
  ];
  const checks = await Promise.all(providers.map(async (provider): Promise<ProfileCheck> => {
    const base = { platform: provider.platform, sourceUrl: provider.url };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(provider.url, { headers: { Accept: "application/json", "User-Agent": "Insight-Nexus-Public-Profile-Lookup/1.0" }, signal: controller.signal, redirect: "manual" });
      if (response.status === 404) return { ...base, status: "not_found" };
      if (!response.ok) return { ...base, status: "unavailable", reason: `Provider returned HTTP ${response.status}` };
      if (!(response.headers.get("content-type") || "").includes("json")) return { ...base, status: "unavailable", reason: "Provider returned a non-JSON page; account existence was not established" };
      const data = await response.json();
      if (data === null && provider.platform === "Hacker News") return { ...base, status: "not_found" };
      if (provider.platform === "GitLab" && Array.isArray(data) && data.length === 0) return { ...base, status: "not_found" };
      if (provider.platform === "Keybase" && data?.status?.code === 0 && Array.isArray(data.them) && data.them.every((user: unknown) => user === null)) return { ...base, status: "not_found" };
      const profile = data && typeof data === "object" ? provider.parse(data) : null;
      return profile ? { ...base, status: "found", profile } : { ...base, status: "unavailable", reason: "Response did not contain the requested account record" };
    } catch (error) {
      return { ...base, status: "unavailable", reason: error instanceof Error ? error.message : "Provider request failed" };
    } finally { clearTimeout(timer); }
  }));
  return { username, retrievedAt, profiles: checks.flatMap(c => c.profile ? [c.profile] : []), checks };
}
