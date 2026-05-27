const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function safeFetch(url: string, init?: RequestInit, timeoutMs = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: c.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

async function ipGeo(ip: string) {
  const r = await safeFetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=66846719`);
  const d = await r.json();
  if (d.status !== "success") throw new Error(d.message || "lookup failed");
  return {
    ip: d.query, country: d.country, country_code: d.countryCode,
    region: d.regionName, city: d.city, zip: d.zip,
    latitude: d.lat, longitude: d.lon, timezone: d.timezone,
    isp: d.isp, org: d.org, asn: d.as, reverse: d.reverse,
    proxy: !!d.proxy, hosting: !!d.hosting, mobile: !!d.mobile,
  };
}

async function dnsQuery(domain: string) {
  const types = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA"];
  const out: Record<string, string[]> = {};
  await Promise.all(types.map(async (t) => {
    const r = await safeFetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${t}`);
    const d = await r.json();
    out[t.toLowerCase()] = (d.Answer || []).map((a: { data: string }) => a.data);
  }));
  return { domain, ...out };
}

async function subdomainEnum(domain: string) {
  const r = await safeFetch(`https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`);
  if (!r.ok) throw new Error(`crt.sh ${r.status}`);
  const d: { name_value: string }[] = await r.json();
  const set = new Set<string>();
  for (const row of d) {
    for (const n of String(row.name_value || "").split("\n")) {
      const v = n.trim().toLowerCase();
      if (v && !v.startsWith("*") && v.endsWith(domain)) set.add(v);
    }
  }
  const subs = [...set].sort();
  return { domain, count: subs.length, subdomains: subs.slice(0, 500), source: "crt.sh certificate transparency" };
}

async function whois(domain: string) {
  const r = await safeFetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  if (!r.ok) throw new Error(`rdap ${r.status}`);
  const d = await r.json();
  const events: Record<string, string> = {};
  for (const e of d.events || []) events[e.eventAction] = e.eventDate;
  const ns = (d.nameservers || []).map((n: { ldhName: string }) => n.ldhName);
  const registrar = (d.entities || []).find((e: { roles?: string[] }) => e.roles?.includes("registrar"));
  return {
    domain: d.ldhName || domain,
    handle: d.handle,
    status: d.status,
    registrar: registrar?.vcardArray?.[1]?.find((x: unknown[]) => x[0] === "fn")?.[3] || registrar?.handle || null,
    registered: events.registration,
    expires: events.expiration,
    last_changed: events["last changed"],
    nameservers: ns,
    secure_dns: d.secureDNS,
  };
}

async function asnLookup(asn: string) {
  const num = asn.replace(/^AS/i, "");
  const r = await safeFetch(`https://rdap.org/autnum/${num}`);
  if (!r.ok) throw new Error(`rdap ${r.status}`);
  const d = await r.json();
  const events: Record<string, string> = {};
  for (const e of d.events || []) events[e.eventAction] = e.eventDate;
  const entity = (d.entities || [])[0];
  return {
    asn: `AS${num}`,
    name: d.name,
    handle: d.handle,
    type: d.type,
    country: d.country,
    status: d.status,
    registered: events.registration,
    last_changed: events["last changed"],
    organization: entity?.vcardArray?.[1]?.find((x: unknown[]) => x[0] === "fn")?.[3] || entity?.handle || null,
    description: d.name,
    source: "rdap.org",
  };
}

async function cveLookup(cve: string) {
  const r = await safeFetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cve.toUpperCase())}`);
  if (!r.ok) throw new Error(`NVD ${r.status}`);
  const d = await r.json();
  const item = d.vulnerabilities?.[0]?.cve;
  if (!item) throw new Error("CVE not found");
  const m = item.metrics?.cvssMetricV31?.[0]?.cvssData || item.metrics?.cvssMetricV30?.[0]?.cvssData || item.metrics?.cvssMetricV2?.[0]?.cvssData;
  return {
    cve: item.id,
    published: item.published,
    last_modified: item.lastModified,
    description: item.descriptions?.find((x: { lang: string }) => x.lang === "en")?.value,
    cvss_score: m?.baseScore,
    severity: m?.baseSeverity || (item.metrics?.cvssMetricV31?.[0]?.baseSeverity),
    vector: m?.vectorString,
    references: (item.references || []).slice(0, 10).map((x: { url: string }) => x.url),
    weaknesses: (item.weaknesses || []).flatMap((w: { description: { value: string }[] }) => w.description.map((x) => x.value)),
  };
}

async function githubRecon(user: string) {
  const u = await safeFetch(`https://api.github.com/users/${encodeURIComponent(user)}`);
  if (u.status === 404) throw new Error("User not found");
  if (!u.ok) throw new Error(`github ${u.status}`);
  const profile = await u.json();
  const reposRes = await safeFetch(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated`);
  const repos = reposRes.ok ? await reposRes.json() : [];
  const langs: Record<string, number> = {};
  for (const r of repos) if (r.language) langs[r.language] = (langs[r.language] || 0) + 1;
  const eventsRes = await safeFetch(`https://api.github.com/users/${encodeURIComponent(user)}/events/public?per_page=30`);
  const events = eventsRes.ok ? await eventsRes.json() : [];
  const emails = new Set<string>();
  for (const e of events) {
    const c = e?.payload?.commits || [];
    for (const x of c) if (x?.author?.email) emails.add(x.author.email);
  }
  return {
    username: profile.login, name: profile.name, bio: profile.bio,
    company: profile.company, blog: profile.blog, location: profile.location,
    public_email: profile.email, twitter: profile.twitter_username,
    public_repos: profile.public_repos, followers: profile.followers, following: profile.following,
    created_at: profile.created_at, avatar: profile.avatar_url,
    top_languages: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ language: k, repo_count: v })),
    recent_repos: repos.slice(0, 10).map((r: { name: string; description: string; stargazers_count: number; html_url: string; updated_at: string }) => ({
      name: r.name, description: r.description, stars: r.stargazers_count, url: r.html_url, updated: r.updated_at,
    })),
    commit_emails: [...emails],
  };
}

async function reverseGeo(lat: string, lng: string) {
  const r = await safeFetch(`https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json&addressdetails=1`, {
    headers: { "User-Agent": "lovable-osint/1.0" },
  });
  if (!r.ok) throw new Error(`nominatim ${r.status}`);
  const d = await r.json();
  return {
    lat, lng, display_name: d.display_name,
    address: d.address, osm_type: d.osm_type, place_id: d.place_id,
  };
}

async function urlUnshorten(url: string) {
  const chain: { url: string; status: number }[] = [];
  let current = url.startsWith("http") ? url : `https://${url}`;
  for (let i = 0; i < 10; i++) {
    const r = await safeFetch(current, { method: "HEAD", redirect: "manual" });
    chain.push({ url: current, status: r.status });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).toString();
    } else break;
  }
  return { input: url, hops: chain.length, chain, final: current };
}

async function btcWallet(addr: string) {
  const r = await safeFetch(`https://blockstream.info/api/address/${encodeURIComponent(addr)}`);
  if (!r.ok) throw new Error(`blockstream ${r.status}`);
  const d = await r.json();
  const txr = await safeFetch(`https://blockstream.info/api/address/${encodeURIComponent(addr)}/txs`);
  const txs = txr.ok ? await txr.json() : [];
  const funded = d.chain_stats.funded_txo_sum;
  const spent = d.chain_stats.spent_txo_sum;
  return {
    address: d.address, chain: "btc",
    balance_btc: ((funded - spent) / 1e8).toFixed(8),
    total_received_btc: (funded / 1e8).toFixed(8),
    total_sent_btc: (spent / 1e8).toFixed(8),
    tx_count: d.chain_stats.tx_count,
    recent_txs: txs.slice(0, 10).map((t: { txid: string; status: { block_time?: number }; fee: number }) => ({
      txid: t.txid, time: t.status.block_time ? new Date(t.status.block_time * 1000).toISOString() : null, fee: t.fee,
    })),
  };
}

async function ethWallet(addr: string) {
  const r = await safeFetch(`https://api.ethplorer.io/getAddressInfo/${encodeURIComponent(addr)}?apiKey=freekey`);
  if (!r.ok) throw new Error(`ethplorer ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return {
    address: d.address, chain: "eth",
    balance_eth: d.ETH?.balance, balance_usd: d.ETH?.totalIn,
    tx_count: d.countTxs,
    tokens: (d.tokens || []).slice(0, 25).map((t: { tokenInfo: { symbol: string; name: string; address: string }; balance: number }) => ({
      symbol: t.tokenInfo.symbol, name: t.tokenInfo.name, balance: t.balance, address: t.tokenInfo.address,
    })),
  };
}

async function urlReputation(url: string) {
  // urlhaus by abuse.ch (no key, free)
  const fd = new FormData();
  fd.append("url", url);
  const r = await safeFetch(`https://urlhaus-api.abuse.ch/v1/url/`, { method: "POST", body: fd });
  const d = await r.json();
  if (d.query_status === "no_results") {
    return { url, listed: false, sources_checked: ["URLhaus"], note: "No abuse listing found." };
  }
  if (d.query_status !== "ok") throw new Error(d.query_status);
  return {
    url: d.url, listed: true, threat: d.threat, status: d.url_status,
    tags: d.tags, date_added: d.date_added, host: d.host,
    payloads: (d.payloads || []).slice(0, 5).map((p: { filename: string; file_type: string; signature: string }) => ({
      filename: p.filename, type: p.file_type, signature: p.signature,
    })),
    sources_checked: ["URLhaus (abuse.ch)"],
  };
}

async function sslInspect(host: string) {
  // Use SSL-Labs free assess API (cached)
  const r = await safeFetch(`https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(host)}&fromCache=on&maxAge=24`);
  if (!r.ok) throw new Error(`ssllabs ${r.status}`);
  const d = await r.json();
  if (d.status === "ERROR") throw new Error(d.statusMessage || "ssllabs error");
  const ep = d.endpoints?.[0];
  const cert = ep?.details?.cert || ep?.details?.certs?.[0];
  return {
    host: d.host, status: d.status, grade: ep?.grade,
    ip: ep?.ipAddress,
    cert: cert ? {
      subject: cert.subject, issuer: cert.issuerSubject || cert.issuerLabel,
      not_before: cert.notBefore ? new Date(cert.notBefore).toISOString() : null,
      not_after: cert.notAfter ? new Date(cert.notAfter).toISOString() : null,
      sig_alg: cert.sigAlg, key: cert.keyAlg ? `${cert.keyAlg}-${cert.keySize}` : null,
      san: cert.altNames || cert.commonNames,
    } : null,
    note: d.status !== "READY" ? "Scan still in progress; retry in 30-60s for full data." : null,
  };
}

async function usernameSearch(username: string) {
  const checks: { platform: string; url: string; check: (r: Response) => Promise<boolean> }[] = [
    { platform: "GitHub", url: `https://api.github.com/users/${username}`, check: async (r) => r.status === 200 },
    { platform: "Reddit", url: `https://www.reddit.com/user/${username}/about.json`, check: async (r) => { const j = await r.json().catch(()=>null); return !!j?.data?.id; } },
    { platform: "GitLab", url: `https://gitlab.com/api/v4/users?username=${username}`, check: async (r) => { const j = await r.json().catch(()=>[]); return Array.isArray(j) && j.length > 0; } },
    { platform: "Medium", url: `https://medium.com/@${username}`, check: async (r) => r.status === 200 },
    { platform: "Dev.to", url: `https://dev.to/api/users/by_username?url=${username}`, check: async (r) => r.status === 200 },
    { platform: "Keybase", url: `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${username}`, check: async (r) => { const j = await r.json().catch(()=>null); return j?.them?.[0] != null; } },
    { platform: "HackerNews", url: `https://hacker-news.firebaseio.com/v0/user/${username}.json`, check: async (r) => { const t = await r.text(); return t !== "null" && t.length > 4; } },
    { platform: "Pinterest", url: `https://www.pinterest.com/${username}/`, check: async (r) => r.status === 200 },
    { platform: "Steam", url: `https://steamcommunity.com/id/${username}/`, check: async (r) => { const t = await r.text(); return r.status === 200 && !t.includes("The specified profile could not be found"); } },
    { platform: "Twitch", url: `https://www.twitch.tv/${username}`, check: async (r) => r.status === 200 },
    { platform: "Telegram", url: `https://t.me/${username}`, check: async (r) => { const t = await r.text(); return r.status === 200 && t.includes("tgme_page_title"); } },
    { platform: "Instagram", url: `https://www.instagram.com/${username}/`, check: async (r) => r.status === 200 },
    { platform: "TikTok", url: `https://www.tiktok.com/@${username}`, check: async (r) => { const t = await r.text(); return r.status === 200 && !t.includes("Couldn't find this account"); } },
    { platform: "Vimeo", url: `https://vimeo.com/${username}`, check: async (r) => r.status === 200 },
    { platform: "SoundCloud", url: `https://soundcloud.com/${username}`, check: async (r) => r.status === 200 },
  ];
  const results = await Promise.all(checks.map(async (c) => {
    try {
      const r = await safeFetch(c.url, { headers: { "User-Agent": "Mozilla/5.0 lovable-osint" } }, 8000);
      const found = await c.check(r);
      return { platform: c.platform, found, url: found ? c.url.replace(/api\.|\/api\/.*|\?.*|_\/.*|\.json$/g, "") : null };
    } catch { return { platform: c.platform, found: false, url: null }; }
  }));
  const found = results.filter((x) => x.found);
  return { username, total_checked: results.length, total_found: found.length, results };
}

async function pasteSearch(keyword: string) {
  // Public scrape paste indexes are gone; use Google site: search via DuckDuckGo HTML
  const q = encodeURIComponent(`"${keyword}" site:pastebin.com OR site:rentry.co OR site:ghostbin.com`);
  const r = await safeFetch(`https://html.duckduckgo.com/html/?q=${q}`, {
    headers: { "User-Agent": "Mozilla/5.0 lovable-osint" },
  });
  const html = await r.text();
  const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
  const results = matches.slice(0, 15).map((m) => {
    const u = decodeURIComponent(m[1].replace(/^.*uddg=/, "").split("&")[0] || m[1]);
    return { url: u, title: m[2].replace(/<[^>]+>/g, "") };
  });
  return { keyword, total: results.length, results, source: "DuckDuckGo (paste sites)" };
}

async function darkWebSearch(keyword: string) {
  // Surface-web index of indexed onion content via Ahmia
  const r = await safeFetch(`https://ahmia.fi/search/?q=${encodeURIComponent(keyword)}`, {
    headers: { "User-Agent": "Mozilla/5.0 lovable-osint" },
  });
  const html = await r.text();
  const items = [...html.matchAll(/<li class="result"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p>([\s\S]*?)<\/p>/g)];
  const results = items.slice(0, 15).map((m) => ({
    onion_url: decodeURIComponent(m[1].replace(/^.*redirect_url=/, "")),
    title: m[2].replace(/<[^>]+>/g, "").trim(),
    snippet: m[3].replace(/<[^>]+>/g, "").trim().slice(0, 240),
  }));
  return { keyword, total: results.length, results, source: "Ahmia (Tor index)" };
}

async function breachLookup(query: string) {
  // Use proxy.cc / breachdirectory free? We use the free leakcheck preview
  const r = await safeFetch(`https://leakcheck.io/api/public?check=${encodeURIComponent(query)}`);
  if (!r.ok) throw new Error(`leakcheck ${r.status}`);
  const d = await r.json();
  return {
    query,
    found: !!d.success && d.found > 0,
    total: d.found || 0,
    sources: (d.sources || []).map((s: { name: string; date?: string }) => ({ name: s.name, date: s.date })),
    fields: d.fields || [],
    source: "LeakCheck public",
  };
}

async function phoneLookup(phone: string) {
  // Use numverify-free fallback: parse via libphonenumber-style guess + ip-api country code; Free phone validation: numlookupapi requires key.
  // Fallback to country code lookup using telnyx-free? Use restcountries by callingCode.
  const cleaned = phone.replace(/[^\d+]/g, "");
  const m = cleaned.match(/^\+?(\d{1,3})/);
  const cc = m?.[1];
  let country = null;
  if (cc) {
    const r = await safeFetch(`https://restcountries.com/v3.1/all?fields=name,idd,cca2,timezones`);
    const list = r.ok ? await r.json() : [];
    for (const c of list) {
      const root = c.idd?.root?.replace("+", "");
      const sufs = c.idd?.suffixes || [""];
      for (const s of sufs) {
        if ((root + s) === cc || root === cc) { country = { name: c.name.common, code: c.cca2, timezones: c.timezones }; break; }
      }
      if (country) break;
    }
  }
  return {
    phone, normalized: cleaned, country_code: cc ? `+${cc}` : null,
    country: country?.name || null, country_iso: country?.code || null,
    timezones: country?.timezones || [],
    note: "Carrier/line type lookup requires a paid provider (Twilio Lookup, NumVerify). Country resolution uses public callingCode data.",
  };
}

// ============= People Data Labs =============
const PDL_BASE = "https://api.peopledatalabs.com/v5";
function pdlKey(): string {
  const k = Deno.env.get("PDL_API_KEY");
  if (!k) throw new Error("PDL_API_KEY not configured");
  return k;
}
async function pdlGet(path: string, query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  const r = await fetch(`${PDL_BASE}${path}?${qs}`, {
    headers: { "X-Api-Key": pdlKey(), "Accept": "application/json" },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PDL ${r.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
  return data;
}
async function pdlPersonEnrich(p: Record<string, string>) {
  const q: Record<string, string> = {};
  if (p.email) q.email = p.email;
  if (p.phone) q.phone = p.phone;
  if (p.profile) q.profile = p.profile;
  if (p.name) q.name = p.name;
  if (p.company) q.company = p.company;
  if (p.first_name) q.first_name = p.first_name;
  if (p.last_name) q.last_name = p.last_name;
  if (p.location) q.location = p.location;
  if (Object.keys(q).length === 0) throw new Error("Provide at least one of: email, phone, profile, or name+company");
  q.min_likelihood = p.min_likelihood || "6";
  const data = await pdlGet("/person/enrich", q);
  const d = data?.data || {};
  return {
    likelihood: data?.likelihood,
    full_name: d.full_name,
    job_title: d.job_title,
    job_company_name: d.job_company_name,
    job_company_website: d.job_company_website,
    location_name: d.location_name,
    linkedin_url: d.linkedin_url,
    twitter_url: d.twitter_url,
    facebook_url: d.facebook_url,
    github_url: d.github_url,
    work_email: d.work_email,
    personal_emails: d.personal_emails,
    mobile_phone: d.mobile_phone,
    phone_numbers: d.phone_numbers,
    industry: d.industry,
    skills: d.skills?.slice(0, 25),
    experience: (d.experience || []).slice(0, 10),
    education: (d.education || []).slice(0, 5),
    raw: d,
  };
}
async function pdlPersonSearch(p: Record<string, unknown>) {
  // Build an Elasticsearch bool query from simple form fields
  const must: Array<Record<string, unknown>> = [];
  const addTerm = (field: string, val: unknown) => {
    const v = String(val ?? "").trim().toLowerCase();
    if (v) must.push({ term: { [field]: v } });
  };
  const addMatch = (field: string, val: unknown) => {
    const v = String(val ?? "").trim();
    if (v) must.push({ match: { [field]: v } });
  };
  addMatch("full_name", p.name);
  addTerm("job_company_name", p.company);
  addMatch("job_title", p.job_title);
  addTerm("job_title_role", p.job_role);
  addTerm("location_country", p.country);
  addMatch("location_name", p.location);
  addTerm("industry", p.industry);
  addTerm("skills", p.skill);
  addTerm("school_name", p.school);

  if (must.length === 0) {
    throw new Error("Provide at least one filter (name, company, title, role, location, country, industry, skill, or school).");
  }

  const size = Math.min(Math.max(Number(p.size) || 5, 1), 25);
  const page = Math.max(Number(p.page) || 1, 1);
  const from = Math.min((page - 1) * size, 9975);
  const r = await fetch(`${PDL_BASE}/person/search`, {
    method: "POST",
    headers: { "X-Api-Key": pdlKey(), "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query: { bool: { must } }, size, from }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PDL ${r.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
  return {
    total: data?.total,
    returned: data?.data?.length || 0,
    page,
    size,
    from,
    total_pages: data?.total ? Math.ceil(data.total / size) : undefined,
    matches: (data?.data || []).map((d: Record<string, unknown>) => ({
      full_name: d.full_name, job_title: d.job_title, job_company_name: d.job_company_name,
      location_name: d.location_name, linkedin_url: d.linkedin_url, work_email: d.work_email,
      industry: d.industry,
    })),
  };
}
async function pdlCompanyEnrich(p: Record<string, string>) {
  const q: Record<string, string> = {};
  if (p.website) q.website = p.website;
  if (p.name) q.name = p.name;
  if (p.profile) q.profile = p.profile;
  if (p.ticker) q.ticker = p.ticker;
  if (Object.keys(q).length === 0) throw new Error("Provide one of: website, name, profile, or ticker");
  const data = await pdlGet("/company/enrich", q);
  return {
    name: data.name,
    display_name: data.display_name,
    size: data.size,
    employee_count: data.employee_count,
    industry: data.industry,
    founded: data.founded,
    location: data.location,
    linkedin_url: data.linkedin_url,
    twitter_url: data.twitter_url,
    facebook_url: data.facebook_url,
    website: data.website,
    summary: data.summary,
    tags: data.tags,
    raw: data,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { action, params } = await req.json();
    if (!action) return json({ error: "action required" }, 400);
    const p = params || {};
    switch (action) {
      case "ip-geo": return json(await ipGeo(p.ip));
      case "dns-query": return json(await dnsQuery(p.domain));
      case "subdomain-enum": return json(await subdomainEnum(p.domain));
      case "whois": return json(await whois(p.domain));
      case "asn-lookup": return json(await asnLookup(p.asn));
      case "cve-lookup": return json(await cveLookup(p.cve));
      case "github-recon": return json(await githubRecon(p.user));
      case "reverse-geo": return json(await reverseGeo(p.lat, p.lng));
      case "url-unshorten": return json(await urlUnshorten(p.url));
      case "btc-wallet": return json(await btcWallet(p.address));
      case "eth-wallet": return json(await ethWallet(p.address));
      case "url-reputation": return json(await urlReputation(p.url));
      case "ssl-inspect": return json(await sslInspect(p.host));
      case "username-search": return json(await usernameSearch(p.username));
      case "paste-search": return json(await pasteSearch(p.keyword));
      case "darkweb-search": return json(await darkWebSearch(p.keyword));
      case "breach-lookup": return json(await breachLookup(p.query));
      case "phone-lookup": return json(await phoneLookup(p.phone));
      case "pdl-person-enrich": return json(await pdlPersonEnrich(p));
      case "pdl-person-search": return json(await pdlPersonSearch(p));
      case "pdl-company-enrich": return json(await pdlCompanyEnrich(p));
      default: return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});