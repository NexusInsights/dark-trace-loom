// Licensed providers stay on the server. Missing access is an error, never an empty finding.
declare const Deno: { env: { get(name: string): string | undefined } };
type Params = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;

export const MARKETPLACE_REQUIRED_SECRETS: Record<string, readonly string[]> = {
  "caller-id": ["TWILIO_API_KEY", "TWILIO_API_SECRET"],
  "sms-detector": ["TWILIO_API_KEY", "TWILIO_API_SECRET"],
  "lpr": ["CARSXE_API_KEY"],
  "vehicle-lookup": ["CARSXE_API_KEY"],
  "public-records": ["COURTLISTENER_API_TOKEN"],
  "streetview-compare": ["MAPILLARY_ACCESS_TOKEN"],
  "twitter-deep-search": ["X_API_BEARER_TOKEN"],
  "discord-intel": ["DISCORD_BOT_TOKEN"],
  "malware-sandbox": ["VIRUSTOTAL_API_KEY"],
  "dark-web-monitor": ["DARKOWL_PUBLIC_KEY", "DARKOWL_PRIVATE_KEY"],
  "vessel-tracker": ["AISSTREAM_API_KEY"],
};

function secrets(tool: string): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of MARKETPLACE_REQUIRED_SECRETS[tool] || []) {
    const value = Deno.env.get(key)?.trim();
    if (value) values[key] = value;
    else missing.push(key);
  }
  if (missing.length) throw new Error(`Configure server secrets ${missing.join(", ")} for ${tool}, using an authorized provider account. No provider request was sent.`);
  return values;
}

function input(p: Params, name: string, max = 500): string {
  if (typeof p[name] !== "string") throw new Error(`${name} is required.`);
  const value = (p[name] as string).trim();
  if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${name} must contain 1–${max} printable characters.`);
  return value;
}
function count(p: Params, min = 1, max = 25, fallback = 10): number {
  const value = p.size === undefined || p.size === "" ? fallback : Number(p.size);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`size must be an integer between ${min} and ${max}.`);
  return value;
}
function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provider returned an unexpected response structure.");
  return value as JsonRecord;
}
function rows(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error("Provider did not supply the expected result list.");
  return value.map(record);
}
function evidence(source: string, coverage: string, data: JsonRecord): JsonRecord {
  return { source, observed_at: new Date().toISOString(), coverage, ...data };
}

// Limit the whole body, not just a Content-Length header. The timer covers body consumption.
async function providerJson(provider: string, url: URL | string, init: RequestInit = {}, allow404 = false): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: controller.signal });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      const remedy = response.status === 401 || response.status === 403 ? " Check provider credentials, permissions, plan, and approved network access." : response.status === 429 ? " Provider quota or rate limit was reached; no automatic paid retry was made." : "";
      throw new Error(`${provider} returned HTTP ${response.status}.${remedy}`);
    }
    if (!response.body) throw new Error(`${provider} returned an empty response body.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 2_000_000) {
          await reader.cancel();
          throw new Error(`${provider} response exceeded the 2 MB limit; narrow the query.`);
        }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    try { return JSON.parse(body); }
    catch { throw new Error(`${provider} returned invalid JSON.`); }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${provider} timed out after 20 seconds. No automatic retry was made.`);
    if (error instanceof Error && error.message.startsWith(provider)) throw error;
    // Native fetch errors may contain credential-bearing URLs; never echo them.
    throw new Error(`${provider} request failed. Check network reachability and provider availability.`);
  } finally { clearTimeout(timer); }
}

function bbox(p: Params): [number, number, number, number] {
  const parts = input(p, "bbox", 100).split(",").map(x => Number(x.trim()));
  if (parts.length !== 4 || parts.some(x => !Number.isFinite(x))) throw new Error("bbox must be minLongitude,minLatitude,maxLongitude,maxLatitude.");
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) throw new Error("bbox coordinates must be valid ordered geographic bounds.");
  if (east - west > 0.1 || north - south > 0.1) throw new Error("bbox must be at most 0.1 degrees wide and high; narrow the requested area.");
  return [west, south, east, north];
}

function publicImage(p: Params): URL {
  const raw = input(p, "image_url", 2000);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("image_url must be a public HTTPS URL."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !host.includes(".") || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host) || host === "localhost" || /\.(local|localhost|internal|test|invalid)$/.test(host)) throw new Error("image_url must use a public HTTPS domain, without credentials or a custom port.");
  return url;
}

async function twilio(tool: string, p: Params, keys: Record<string, string>): Promise<JsonRecord> {
  const phone = input(p, "phone", 30).replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("phone must be a valid E.164 number beginning with +country code.");
  const fields = tool === "caller-id" ? "caller_name" : "line_type_intelligence";
  const url = new URL(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}`);
  url.searchParams.set("Fields", fields);
  const data = record(await providerJson("Twilio Lookup", url, { headers: { Authorization: `Basic ${btoa(`${keys.TWILIO_API_KEY}:${keys.TWILIO_API_SECRET}`)}`, Accept: "application/json" } }));
  const product = data[fields];
  if (product !== null && product !== undefined && record(product).error_code) throw new Error(`Twilio ${fields} returned a product error. Check coverage and account permissions.`);
  return evidence("https://www.twilio.com/docs/lookup/v2-api", tool === "caller-id" ? "US CNAM caller-name record; this may be absent or stale and does not prove current subscriber identity." : "Actual carrier and line-type data. VoIP is not proof that an SMS verification bypass occurred.", { phone: data.phone_number, valid: data.valid, country_code: data.country_code, [fields]: product ?? null });
}

async function cars(tool: string, p: Params, keys: Record<string, string>): Promise<JsonRecord> {
  let url: URL;
  let init: RequestInit;
  if (tool === "lpr") {
    const image = publicImage(p);
    url = new URL("https://api.carsxe.com/platerecognition");
    init = { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ image_url: image.href }) };
  } else {
    const plate = input(p, "plate", 20);
    const state = input(p, "state", 12).toUpperCase();
    const country = typeof p.country === "string" && p.country.trim() ? p.country.trim().toUpperCase() : "US";
    if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z0-9 -]+$/i.test(plate) || !/^[A-Z0-9-]+$/.test(state)) throw new Error("Use a valid plate, state/region code, and two-letter country code.");
    url = new URL("https://api.carsxe.com/v2/platedecoder");
    url.searchParams.set("plate", plate); url.searchParams.set("state", state); url.searchParams.set("country", country);
    init = { headers: { Accept: "application/json" } };
  }
  url.searchParams.set("key", keys.CARSXE_API_KEY);
  const data = record(await providerJson("CarsXE", url, init));
  if (data.success === false || data.error || data.errors) throw new Error("CarsXE returned a provider error. Check entitlement, quota, coverage, and supplied input.");
  return evidence(tool === "lpr" ? "https://api.carsxe.com/platerecognition" : "https://api.carsxe.com/v2/platedecoder", tool === "lpr" ? "Real plate OCR on the supplied image; includes only the provider response, not ownership or surveillance history." : "Licensed plate-to-vehicle specifications and VIN where supplied. Does not retrieve private owner identity or tracking history.", { result: data });
}

async function courtlistener(p: Params, keys: Record<string, string>): Promise<JsonRecord> {
  const q = input(p, "q", 500); const size = count(p);
  const url = new URL("https://www.courtlistener.com/api/rest/v4/search/");
  url.searchParams.set("q", q); url.searchParams.set("type", "o");
  const data = record(await providerJson("CourtListener", url, { headers: { Authorization: `Token ${keys.COURTLISTENER_API_TOKEN}`, Accept: "application/json" } }));
  const results = rows(data.results).slice(0, size);
  return evidence("https://www.courtlistener.com/api/rest/v4/search/", "Actual public opinion search records within CourtListener coverage; no universal background-check or criminal-disposition inference.", { query: q, total: data.count ?? data.total ?? null, returned: results.length, results, next: data.next ?? null });
}

async function mapillary(p: Params, keys: Record<string, string>): Promise<JsonRecord> {
  const bounds = bbox(p); const size = count(p);
  const url = new URL("https://graph.mapillary.com/images");
  url.searchParams.set("bbox", bounds.join(",")); url.searchParams.set("limit", String(size));
  url.searchParams.set("fields", "id,captured_at,geometry,thumb_1024_url,sequence");
  const data = record(await providerJson("Mapillary", url, { headers: { Authorization: `OAuth ${keys.MAPILLARY_ACCESS_TOKEN}`, Accept: "application/json" } }));
  if (data.error) throw new Error("Mapillary denied the query. Check token permissions and requested bounds.");
  const images = rows(data.data).slice(0, size);
  return evidence("https://graph.mapillary.com/images", "Actual dated street-level image records in the supplied area. Different camera positions and coverage mean this is not automatic historical change detection.", { bbox: bounds, returned: images.length, images });
}

async function xSearch(p: Params, keys: Record<string, string>): Promise<JsonRecord> {
  const q = input(p, "q", 500); const size = count(p, 10, 25, 10);
  const mode = p.mode === undefined || p.mode === "" ? "recent" : String(p.mode);
  if (mode !== "recent" && mode !== "all") throw new Error("mode must be recent or all. Archive mode requires provider entitlement.");
  const url = new URL(`https://api.x.com/2/tweets/search/${mode}`);
  url.searchParams.set("query", q); url.searchParams.set("max_results", String(size)); url.searchParams.set("tweet.fields", "created_at,author_id,public_metrics,lang");
  if (p.next_token) url.searchParams.set("next_token", input(p, "next_token", 1000));
  const data = record(await providerJson("X API", url, { headers: { Authorization: `Bearer ${keys.X_API_BEARER_TOKEN}`, Accept: "application/json" } }));
  if (data.errors) throw new Error("X API reported an incomplete or denied search. Check query syntax, endpoint entitlement, and credits.");
  const posts = data.data === undefined && record(data.meta ?? {}).result_count === 0 ? [] : rows(data.data).slice(0, size);
  return evidence(`https://api.x.com/2/tweets/search/${mode}`, mode === "recent" ? "Actual recent search only; no full archive claim. Provider time window and access limits apply." : "Actual full-archive endpoint request; results remain limited by the account’s entitlement and query.", { query: q, mode, returned: posts.length, posts, meta: data.meta ?? null });
}

async function discord(p: Params, keys: Record<string, string>): Promise<JsonRecord> {
  const channel = input(p, "channel_id", 25); const size = count(p);
  if (!/^\d{17,20}$/.test(channel)) throw new Error("channel_id must be a Discord channel snowflake (17–20 digits).");
  const url = new URL(`https://discord.com/api/v10/channels/${channel}/messages`); url.searchParams.set("limit", String(size));
  const messages = rows(await providerJson("Discord", url, { headers: { Authorization: `Bot ${keys.DISCORD_BOT_TOKEN}`, Accept: "application/json" } })).slice(0, size);
  return evidence(`https://discord.com/api/v10/channels/${channel}/messages`, "Messages visible to the authorized bot in this channel only. VIEW_CHANNEL, READ_MESSAGE_HISTORY and message-content permissions limit coverage.", { channel_id: channel, returned: messages.length, messages });
}

async function virusTotal(p: Params, keys: Record<string, string>): Promise<JsonRecord> {
  const hash = input(p, "hash", 64).toLowerCase();
  if (!/^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) throw new Error("hash must be an MD5, SHA-1, or SHA-256 hexadecimal file hash.");
  const url = `https://www.virustotal.com/api/v3/files/${hash}/behaviour_summary`;
  const report = await providerJson("VirusTotal", url, { headers: { "x-apikey": keys.VIRUSTOTAL_API_KEY, Accept: "application/json" } }, true);
  return evidence(url, "Retrieves an existing provider sandbox behavior summary. Does not upload or detonate a new artifact.", { hash, found: report !== null, report: report === null ? null : record(record(report).data), ...(report === null ? { notice: "VirusTotal has no behavior summary for this hash, or it is not available to this account." } : {}) });
}

async function darkOwl(p: Params, keys: Record<string, string>): Promise<JsonRecord> {
  const q = input(p, "q", 253).toLowerCase(); const size = count(p);
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(q)) throw new Error("q must be an organization’s domain. This integration excludes personal-record and leaked-credential searches.");
  const url = new URL("https://api.darkowl.com/api/v1/search"); url.searchParams.set("q", q);
  const date = new Date().toUTCString();
  // Provider authenticates the decoded path/query, not its URL-encoded form.
  const sign = `GET${decodeURIComponent(url.pathname + url.search)}${date}`;
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(keys.DARKOWL_PRIVATE_KEY), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(sign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const data = record(await providerJson("DarkOwl", url, { headers: { Date: date, Authorization: `OWL ${keys.DARKOWL_PUBLIC_KEY}:${signature}`, Accept: "application/json" } }));
  const candidates = data.results ?? data.documents ?? data.data;
  // Return metadata, never full leak content, passwords, or private personal records.
  const results = rows(candidates).slice(0, size).map(row => Object.fromEntries(["id", "document_id", "title", "url", "uri", "source", "collection", "date", "crawl_date", "timestamp"].filter(key => row[key] !== undefined).map(key => [key, row[key]])));
  return evidence("https://api.darkowl.com/api/v1/search", "Licensed organizational-domain exposure metadata snapshot. No leak bodies or credentials are returned, and continuous monitoring is not active.", { query: q, returned: results.length, total: data.total ?? data.count ?? null, results });
}

async function vessel(p: Params, keys: Record<string, string>): Promise<JsonRecord> {
  const mmsi = input(p, "mmsi", 9); const bounds = bbox(p);
  if (!/^\d{9}$/.test(mmsi)) throw new Error("mmsi must contain exactly nine digits.");
  if (typeof WebSocket === "undefined") throw new Error("AIS Stream requires a backend WebSocket client; this execution surface does not provide one.");
  const [west, south, east, north] = bounds;
  const events = await new Promise<JsonRecord[]>((resolve, reject) => {
    const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const received: JsonRecord[] = []; let done = false; let subscribed = false;
    const finish = (error?: Error) => {
      if (done) return; done = true; clearTimeout(timer);
      try { socket.close(); } catch { /* Cleanup cannot obscure the subscription result. */ }
      if (error) reject(error); else resolve(received);
    };
    const timer = setTimeout(() => finish(subscribed ? undefined : new Error("AIS Stream did not confirm the subscription within 12 seconds. No valid observation window was established.")), 12_000);
    socket.onopen = () => socket.send(JSON.stringify({ APIKey: keys.AISSTREAM_API_KEY, BoundingBoxes: [[[south, west], [north, east]]], FiltersShipMMSI: [mmsi], FilterMessageTypes: ["PositionReport", "ShipStaticData", "StandardClassBPositionReport"] }));
    socket.onerror = () => finish(new Error("AIS Stream connection failed. Check account key, network access, and WebSocket compatibility."));
    socket.onclose = () => { if (!done) finish(new Error("AIS Stream closed before the observation window completed.")); };
    socket.onmessage = async event => {
      if (done) return;
      try {
        const text = typeof event.data === "string" ? event.data : event.data instanceof Blob ? await event.data.text() : event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : "";
        if (done) return;
        if (!text || text.length > 100_000) throw new Error("AIS Stream returned an unsupported or oversized frame.");
        const data = record(JSON.parse(text));
        if (data.error || data.Error) throw new Error("AIS Stream rejected the subscription. Check key, filters, and limits.");
        if (data.MessageType === "SubscriptionConfirmation") { subscribed = true; return; }
        const metadata = record(data.MetaData ?? {});
        if (String(metadata.MMSI ?? "") !== mmsi) return;
        subscribed = true;
        received.push(data); if (received.length >= 10) finish();
      } catch { finish(new Error("AIS Stream returned an invalid message or rejected the subscription.")); }
    };
  });
  return evidence("wss://stream.aisstream.io/v0/stream", "Bounded live AIS observation window of up to 12 seconds. No messages means no matching transmission was observed; this is not proof the vessel is absent. Continuous tracking is not running.", { mmsi, bbox: bounds, returned: events.length, events });
}

export async function runMarketplaceLicensed(tool: string, p: Params): Promise<JsonRecord | undefined> {
  if (!Object.prototype.hasOwnProperty.call(MARKETPLACE_REQUIRED_SECRETS, tool)) return undefined;
  const keys = secrets(tool);
  switch (tool) {
    case "caller-id": case "sms-detector": return twilio(tool, p, keys);
    case "lpr": case "vehicle-lookup": return cars(tool, p, keys);
    case "public-records": return courtlistener(p, keys);
    case "streetview-compare": return mapillary(p, keys);
    case "twitter-deep-search": return xSearch(p, keys);
    case "discord-intel": return discord(p, keys);
    case "malware-sandbox": return virusTotal(p, keys);
    case "dark-web-monitor": return darkOwl(p, keys);
    case "vessel-tracker": return vessel(p, keys);
  }
}
