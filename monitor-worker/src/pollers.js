import { HttpError, text, number, plain, sourceRequest, visibleText, decodeEntities, MONITOR_USER_AGENT } from "./core.js";

export const KINDS = ["cve", "threat_feed", "telegram", "rss", "page", "social_account", "adsb", "dark_web", "geofence"];
const PUBLIC_SOCIAL = ["github", "gitlab", "devto", "hackernews", "keybase"];
const BRIDGE_SOCIAL = ["linkedin", "instagram", "tiktok", "reddit", "x"];
export function needsBridge(kind, params) { return kind === "dark_web" || (kind === "social_account" && !PUBLIC_SOCIAL.includes(params.platform)); }
export function publicUrl(value, env, allowlist = true) {
  const raw = text(value, "source URL", 2000);
  let url; try { url = new URL(raw); } catch { throw new HttpError("Source URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":") || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname)) throw new HttpError("Use a public HTTPS hostname without credentials or custom ports");
  if ([...url.searchParams.keys()].some(key => /(?:token|secret|password|api.?key|auth)/i.test(key))) throw new HttpError("Public source URLs must not include credential parameters");
  if (allowlist) {
    const allowed = new Set(String(env.MONITOR_ALLOWED_HOSTS || "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean));
    if (!allowed.has(url.hostname.toLowerCase())) throw new HttpError("The source hostname is not authorized in MONITOR_ALLOWED_HOSTS; no source request was sent", 424);
  }
  return url.href;
}
export function validateParams(kind, value, env) {
  const p = plain(value); if (!p || JSON.stringify(p).length > 5000) throw new HttpError("Monitor params must be a bounded JSON object");
  if (kind === "cve") {
    const keyword = text(p.keyword, "CVE ID or product keyword", 200, true);
    const cpe = text(p.cpe, "Exact CPE 2.3 software/version identifier", 300, true);
    if ((!keyword && !cpe) || (cpe && !/^cpe:2\.3:[aho]:[^\s]+$/.test(cpe))) throw new HttpError("Supply a CVE/product keyword or an exact CPE 2.3 identifier");
    return { ...(keyword ? { keyword } : {}), ...(cpe ? { cpe } : {}) };
  }
  if (kind === "threat_feed") {
    if (!["cisa_kev", "feodo"].includes(p.feed)) throw new HttpError("Select threat feed cisa_kev or feodo");
    return { feed: p.feed, keyword: text(p.keyword, "feed keyword", 100, true) };
  }
  if (kind === "telegram") {
    const url = publicUrl(p.url, env, false);
    const parsed = new URL(url);
    if (parsed.hostname !== "t.me" || !/^\/s\/[A-Za-z][A-Za-z0-9_]{3,31}\/?$/.test(parsed.pathname) || parsed.search) throw new HttpError("Use an explicit public channel preview URL such as https://t.me/s/channelname");
    return { url };
  }
  if (kind === "page" || kind === "rss") return { url: publicUrl(p.url, env) };
  if (kind === "social_account") {
    const platform = text(p.platform, "social platform", 30).toLowerCase();
    if (![...PUBLIC_SOCIAL, ...BRIDGE_SOCIAL].includes(platform)) throw new HttpError("No monitor poller is configured for that platform", 422, { coverageState: "unsupported" });
    if (PUBLIC_SOCIAL.includes(platform)) {
      const username = text(p.username, "exact public username", 50);
      if (!/^[A-Za-z0-9_-]{1,50}$/.test(username)) throw new HttpError("Public username contains unsupported characters");
      return { platform, username };
    }
    const url = publicUrl(p.url, env, false);
    const host = new URL(url).hostname.replace(/^www\./, "");
    const expected = { linkedin: "linkedin.com", instagram: "instagram.com", tiktok: "tiktok.com", reddit: "reddit.com", x: "x.com" }[platform];
    if (host !== expected) throw new HttpError("Profile URL does not match the selected platform");
    return { platform, url };
  }
  if (kind === "adsb") return { latitude: number(p.latitude, "latitude", -90, 90), longitude: number(p.longitude, "longitude", -180, 180), radius_nm: number(p.radius_nm, "ADSB radius_nm", 1, 250, 25) };
  if (kind === "dark_web") {
    const domain = text(p.domain, "authorized organizational domain", 253).toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new HttpError("Dark-web monitoring requires an organizational domain; private-person or credential searches are not accepted");
    return { domain };
  }
  if (kind === "geofence") return { feed_id: text(p.feed_id, "position feed ID", 80), rule_id: text(p.rule_id, "geofence rule ID", 80) };
  throw new HttpError("Monitor kind is unsupported", 422, { coverageState: "unsupported" });
}
async function sourceJson(url, init, fetcher, allow404 = false) {
  const { response, body } = await sourceRequest(url, init, fetcher);
  if (allow404 && response.status === 404) return { absent: true };
  if (!response.ok) throw new HttpError(`${new URL(url).hostname} returned HTTP ${response.status}${response.status === 429 ? "; rate limited, scheduled backoff applied" : ""}`, 502, { sourceStatus: response.status });
  let data; try { data = JSON.parse(body); } catch { throw new HttpError("Public provider returned invalid JSON", 502); }
  return data;
}
function pick(record, names) { return Object.fromEntries(names.filter(key => record[key] !== undefined).map(key => [key, record[key]])); }
function snapshot(source, data, coverage) { return { source, fetched_at: new Date().toISOString(), coverage, data }; }
function xmlOne(xml, tag) { return decodeEntities(xml.match(new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, "i"))?.[1] || "").trim(); }
export function rssItems(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new HttpError("External/entity-bearing XML feeds are unsupported", 502, { coverageState: "unsupported" });
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new HttpError("Source is not a recognized RSS/Atom feed", 502);
  const entries = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)];
  if (entries.length > 500) throw new HttpError("RSS feed has more than 500 entries; use a bounded source feed", 413);
  return entries.map(match => {
    const raw = match[1];
    const link = xmlOne(raw, "link") || raw.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || "";
    const id = xmlOne(raw, "guid") || xmlOne(raw, "id") || link;
    const title = visibleText(xmlOne(raw, "title"));
    if (!id && !title) throw new HttpError("Feed entry contained no source identifier or title", 502);
    return { id, link: decodeEntities(link), title, published_at: xmlOne(raw, "pubDate") || xmlOne(raw, "published") || xmlOne(raw, "updated") || null, description: visibleText(xmlOne(raw, "description") || xmlOne(raw, "summary") || xmlOne(raw, "content")).slice(0, 12000) };
  });
}
export function telegramMessages(html) {
  const markers = [...html.matchAll(/\bdata-post=["']([^"']+)["']/g)];
  if (!markers.length && !/tgme_channel_info|tgme_widget_message/i.test(html)) throw new HttpError("Telegram returned no recognized public channel page; access was not established", 502);
  return markers.map((marker, index) => {
    const block = html.slice(marker.index, markers[index + 1]?.index ?? html.length);
    const body = block.match(/<div\b[^>]*class=["'][^"']*tgme_widget_message_text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
    return { id: decodeEntities(marker[1]), text: visibleText(body), published_at: block.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] || null, forwards_from: visibleText(block.match(/<a\b[^>]*class=["'][^"']*tgme_widget_message_forwarded_from[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || "") || null, source_url: `https://t.me/${marker[1]}` };
  });
}
export function pageContent(html) {
  return { title: visibleText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""), text: visibleText(html).slice(0, 150000), resource_urls: [...new Set([...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)].map(match => decodeEntities(match[1])))].sort() };
}
async function bridgePoll(job, params, env, fetcher) {
  const expected = `${String(env.SUPABASE_URL || "").replace(/\/$/, "")}/functions/v1/osint-tools`;
  if (!env.MONITOR_BRIDGE_URL || !env.MONITOR_BRIDGE_SECRET || env.MONITOR_BRIDGE_URL !== expected) throw new HttpError("Licensed monitor bridge is not configured. A stored user JWT is never used for cron polling", 424);
  const inputs = job.kind === "dark_web" ? { q: params.domain, size: "25" } : { platform: params.platform, url: params.url };
  const result = await sourceJson(expected, { method: "POST", headers: { "Content-Type": "application/json", "X-Monitor-Bridge-Key": env.MONITOR_BRIDGE_SECRET, apikey: env.SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify({ action: "monitor-poll", params: { job_id: job.id, owner_user_id: job.user_id, kind: job.kind, inputs, attempt_key: job.attempt_key, polling_authorized: true, paid_daily_budget: job.paid_daily_budget } }) }, fetcher);
  if (!plain(result) || result.error || typeof result.source !== "string") throw new HttpError("Licensed bridge returned no usable sourced result", 502);
  const data = result.data !== undefined ? result.data : Object.fromEntries(Object.entries(result).filter(([key]) => !["source", "retrieved_at", "observed_at", "coverage"].includes(key)));
  return snapshot(result.source, plain(data) || { records: data }, result.coverage || "Licensed organizational/public-profile source; account access and source coverage apply");
}
export async function pollSnapshot(job, env, fetcher = fetch) {
  const p = JSON.parse(job.params_json);
  if (needsBridge(job.kind, p)) return bridgePoll(job, p, env, fetcher);
  if (job.kind === "cve") {
    const query = new URLSearchParams({ resultsPerPage: "100" });
    if (p.cpe) { query.set("cpeName", p.cpe); query.set("isVulnerable", ""); }
    else if (/^CVE-\d{4}-\d{4,}$/i.test(p.keyword)) query.set("cveId", p.keyword.toUpperCase()); else query.set("keywordSearch", p.keyword);
    const source = `https://services.nvd.nist.gov/rest/json/cves/2.0?${query}`;
    const data = await sourceJson(source, {}, fetcher);
    if (!Array.isArray(data.vulnerabilities)) throw new HttpError("NVD did not return vulnerability records", 502);
    const ids = data.vulnerabilities.map(record => record.cve?.id).filter(id => typeof id === "string" && /^CVE-\d{4}-\d{4,}$/.test(id));
    const epssSource = `https://api.first.org/data/v1/epss?cve=${encodeURIComponent(ids.join(","))}`;
    const kevSource = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
    const [epss, kev] = await Promise.allSettled([ids.length ? sourceJson(epssSource, {}, fetcher) : Promise.resolve({ data: [] }), sourceJson(kevSource, {}, fetcher)]);
    const epssRows = epss.status === "fulfilled" && Array.isArray(epss.value?.data) ? epss.value.data : null;
    const kevRows = kev.status === "fulfilled" && Array.isArray(kev.value?.vulnerabilities) ? kev.value.vulnerabilities : null;
    const errors = [];
    if (!epssRows) errors.push({ source: "FIRST EPSS", error: epss.status === "rejected" && epss.reason instanceof HttpError ? epss.reason.message : "EPSS source returned invalid data" });
    if (!kevRows) errors.push({ source: "CISA KEV", error: kev.status === "rejected" && kev.reason instanceof HttpError ? kev.reason.message : "CISA source returned invalid data" });
    const epssIndex = new Map((epssRows || []).map(row => [row.cve, row]));
    const kevIndex = new Map((kevRows || []).map(row => [row.cveID, row]));
    const correlations = ids.map(id => ({ cve_id: id, epss: epssRows ? epssIndex.get(id) || null : null, epss_source_status: epssRows ? "checked" : "failed", is_in_cisa_kev: kevRows ? kevIndex.has(id) : null, cisa_kev: kevRows ? kevIndex.get(id) || null : null }));
    return snapshot(source, { total_results: data.totalResults, returned: data.vulnerabilities.length, vulnerabilities: data.vulnerabilities, correlations, source_errors: errors, source_urls: { nvd: source, epss: ids.length ? epssSource : null, cisa_kev: kevSource }, coverage_state: errors.length ? "partial" : "complete_for_returned_records" }, "Scheduled NVD records joined by CVE ID to actual FIRST EPSS scores and CISA known-exploited records. Exact CPE queries correlate the explicitly supplied software version; keyword matches do not establish asset exposure. At most the first 100 NVD records per check. CISA KEV is a known-exploitation catalog, not a complete exploit database; failed sources remain unknown.");
  }
  if (job.kind === "threat_feed") {
    const source = p.feed === "cisa_kev" ? "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json" : "https://feodotracker.abuse.ch/downloads/ipblocklist.json";
    const data = await sourceJson(source, {}, fetcher);
    const records = p.feed === "cisa_kev" ? data.vulnerabilities : data;
    if (!Array.isArray(records)) throw new HttpError("Threat feed returned an invalid record list", 502);
    const filtered = records.filter(record => !p.keyword || JSON.stringify(record).toLowerCase().includes(p.keyword.toLowerCase()));
    if (filtered.length > 1000) throw new HttpError("Threat feed selection exceeds 1000 records; narrow the keyword", 413);
    return snapshot(source, { feed: p.feed, records: filtered }, "Actual records from the selected CISA KEV or Feodo feed, checked automatically. This poller does not claim a 100-feed aggregation or independent threat confidence score.");
  }
  if (["telegram", "rss", "page"].includes(job.kind)) {
    const source = job.kind === "telegram" ? p.url : publicUrl(p.url, env);
    const { response, body } = await sourceRequest(source, {}, fetcher);
    if (!response.ok) throw new HttpError(`Public source returned HTTP ${response.status}; source visibility is not established`, 502, { sourceStatus: response.status });
    if (job.kind === "telegram") return snapshot(source, { messages: telegramMessages(body) }, "Public Telegram channel preview messages visible in the returned HTML. Hidden, deleted, older, group-member and private content are not indexed. History begins when this monitor is enabled.");
    if (job.kind === "rss") return snapshot(source, { items: rssItems(body) }, "Actual entries in the authorized RSS/Atom feed, with automatic change alerts; feed coverage and retention limit historical visibility.");
    return snapshot(source, pageContent(body), "Public server-rendered page text and resource URLs, automatically compared. JavaScript-rendered content is not executed; history begins at the first check.");
  }
  if (job.kind === "adsb") {
    const source = `https://api.adsb.lol/v2/point/${p.latitude}/${p.longitude}/${p.radius_nm}`;
    const data = await sourceJson(source, { headers: { "User-Agent": MONITOR_USER_AGENT } }, fetcher);
    if (!Array.isArray(data.ac) || data.ac.length > 500) throw new HttpError("ADSB source returned an invalid or oversized aircraft set; narrow the radius", 502);
    const aircraft = data.ac.map(record => pick(record, ["hex", "flight", "lat", "lon", "alt_baro", "alt_geom", "gs", "track", "r", "t", "squawk", "category", "nav_altitude_mcp", "nav_heading", "baro_rate", "geom_rate"]));
    return snapshot(source, { aircraft }, "Automatic ADSB.lol regional receiver observations (ODbL attribution). Stored source observations provide actual history from activation onward, not pre-existing global historical paths or independently verified ownership.");
  }
  if (job.kind === "social_account") {
    const name = encodeURIComponent(p.username); let source; let data;
    if (p.platform === "github") { source = `https://api.github.com/users/${name}`; const value = await sourceJson(source, { headers: { Accept: "application/vnd.github+json", "User-Agent": "InsightNexus-monitor" } }, fetcher, true); data = value.absent ? { exists: false } : { exists: true, profile: pick(value, ["id", "login", "html_url", "name", "company", "blog", "location", "email", "bio", "public_repos", "public_gists", "followers", "following", "created_at", "updated_at"]) }; }
    else if (p.platform === "gitlab") { source = `https://gitlab.com/api/v4/users?username=${name}`; const values = await sourceJson(source, {}, fetcher); if (!Array.isArray(values)) throw new HttpError("GitLab returned invalid public records", 502); data = { profiles: values.filter(value => value.username?.toLowerCase() === p.username.toLowerCase()).map(value => pick(value, ["id", "username", "name", "web_url", "state", "bio", "location", "public_email"])) }; }
    else if (p.platform === "devto") { source = `https://dev.to/api/users/by_username?url=${name}`; const value = await sourceJson(source, {}, fetcher, true); data = value.absent ? { exists: false } : { exists: true, profile: pick(value, ["id", "username", "name", "summary", "location", "website_url", "github_username", "twitter_username", "joined_at"]) }; }
    else if (p.platform === "hackernews") { source = `https://hacker-news.firebaseio.com/v0/user/${name}.json`; const value = await sourceJson(source, {}, fetcher); data = value === null ? { exists: false } : { exists: true, profile: pick(value, ["id", "created", "karma", "about", "submitted"]) }; }
    else { source = `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${name}`; const value = await sourceJson(source, {}, fetcher); if (value.status?.code !== 0 || !Array.isArray(value.them)) throw new HttpError("Keybase returned no valid public account response", 502); data = { profiles: value.them.map(profile => pick(profile, ["id", "basics", "profile", "proofs_summary"])) }; }
    return snapshot(source, data, "Automatic changes to exact public account records. Same handles or similar content do not establish common ownership; provider coverage is limited to the chosen platform.");
  }
  throw new HttpError("No polling handler exists for this monitor kind", 422, { coverageState: "unsupported" });
}
