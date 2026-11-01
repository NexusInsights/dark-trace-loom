import type { PublicProfile } from "./publicProfiles";
import { pdlContacts } from "./pdlContacts";

export type ReviewDecision = "unreviewed" | "accepted" | "rejected";
export interface DossierRecord { id: string; tool_name: string; result_data: unknown; created_at: string; case_id?: string | null; }
export interface DossierIdentifier { id: string; identifier_type: string; identifier_value: string; source: string | null; created_at: string; }
export interface EvidenceItem { id: string; kind: string; title: string; sourceUrl: string; imageUrl?: string; occurredAt?: string; note?: string; retrievedAt: string; }
export interface DossierAccount extends PublicProfile { decision: ReviewDecision; recordId: string; }
export interface DossierContact { type: string; value: string; source: string; sourceUrl?: string; retrievedAt: string; }
export interface DossierEvent { id: string; title: string; occurredAt: string; retrievedAt: string; sourceUrl: string; kind: string; }
export const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
export function sourceUrl(value: unknown): string {
  try { const url = new URL(string(value)); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
function actualDate(value: unknown): string {
  const date = string(value);
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(date) && Number.isFinite(Date.parse(date)) && (date.includes("T") || new Date(date).toISOString().slice(0,10)===date) ? date : "";
}
export function buildPersonDossier(identifiers: DossierIdentifier[], records: DossierRecord[]) {
  const contacts = new Map<string, DossierContact>();
  const accounts = new Map<string, DossierAccount>();
  const reviews = new Map<string, ReviewDecision>();
  const evidence: EvidenceItem[] = [];
  const events = new Map<string, DossierEvent>();
  const ordered = [...records].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const addContact = (type: string, value: string, source: string, retrievedAt: string, url = "") => {
    if (!value || value.length > 2000) return;
    const key = `${type}:${value.toLowerCase()}:${source}`;
    contacts.set(key, { type, value, source, retrievedAt, sourceUrl: sourceUrl(url) || undefined });
  };
  for (const identifier of identifiers) {
    if (identifier.source !== "input" && identifier.source !== "auto_expansion" && !identifier.source?.startsWith("live:")) continue;
    if (["email", "phone", "domain"].includes(identifier.identifier_type)) addContact(identifier.identifier_type, identifier.identifier_value, identifier.source?.startsWith("live:") ? "Retrieved identifier" : "Provided input; ownership unverified", identifier.created_at);
    if (identifier.identifier_type === "social_profile" && sourceUrl(identifier.identifier_value)) {
      const url = sourceUrl(identifier.identifier_value);
      accounts.set(url, { platform: new URL(url).hostname, username: new URL(url).pathname.split("/").filter(Boolean).at(-1) || "Profile", profileUrl: url, sourceUrl: url, retrievedAt: identifier.created_at, decision: "unreviewed", recordId: identifier.id });
    }
  }
  for (const row of ordered) {
    const data = asRecord(row.result_data);
    if (row.tool_name === "person-investigation-review") {
      const url = sourceUrl(data.profile_url);
      if (url && ["unreviewed", "accepted", "rejected"].includes(string(data.decision))) reviews.set(url, data.decision as ReviewDecision);
      continue;
    }
    if (row.tool_name === "person-investigation-evidence") {
      const item = asRecord(data.item);
      const url = sourceUrl(item.sourceUrl);
      if (!url || !string(item.title)) continue;
      const entry: EvidenceItem = { id: row.id, kind: string(item.kind) || "note", title: string(item.title), sourceUrl: url, imageUrl: sourceUrl(item.imageUrl) || undefined, occurredAt: actualDate(item.occurredAt) || undefined, note: string(item.note), retrievedAt: row.created_at };
      evidence.push(entry);
      if (entry.occurredAt) events.set(`evidence:${row.id}`, { id: row.id, title: entry.title, occurredAt: entry.occurredAt, retrievedAt: row.created_at, sourceUrl: url, kind: entry.kind });
      continue;
    }
    const details = asRecord(data.details);
    const lookup = Array.isArray(data.profiles) ? data : details;
    if (Array.isArray(lookup.profiles)) for (const raw of lookup.profiles) {
      const profile = asRecord(raw);
      const url = sourceUrl(profile.profileUrl);
      if (!url || !string(profile.username)) continue;
      const normalized: DossierAccount = {
        platform: string(profile.platform) || new URL(url).hostname, username: string(profile.username), profileUrl: url,
        sourceUrl: sourceUrl(profile.sourceUrl) || url, retrievedAt: string(profile.retrievedAt) || row.created_at,
        displayName: string(profile.displayName) || undefined, bio: string(profile.bio) || undefined, location: string(profile.location) || undefined,
        email: string(profile.email) || undefined, phone: string(profile.phone) || undefined,
        avatarUrl: sourceUrl(profile.avatarUrl) || undefined, accountCreatedAt: actualDate(profile.accountCreatedAt) || undefined,
        decision: "unreviewed", recordId: row.id,
      };
      accounts.set(url, normalized);
    }
    // Search result candidates are not merged into the person's contacts.
    const enrichment = row.tool_name === "pdl-person-enrich" ? details : asRecord(data.enrichment);
    if (Object.keys(enrichment).length && !enrichment.error && !Array.isArray(enrichment.matches)) {
      const found = pdlContacts(enrichment);
      for (const value of found.emails) addContact("email", value, "People Data Labs match; ownership unverified", row.created_at, "https://api.peopledatalabs.com/v5/person/enrich");
      for (const value of found.phones) addContact("phone", value, "People Data Labs match; ownership unverified", row.created_at, "https://api.peopledatalabs.com/v5/person/enrich");
      for (const value of found.addresses) addContact("address", value, "People Data Labs match; ownership unverified", row.created_at, "https://api.peopledatalabs.com/v5/person/enrich");
      const personFields={...asRecord(enrichment.raw),...enrichment};
      for(const network of ['linkedin','github','twitter','facebook'] as const){
        const supplied=string(personFields[`${network}_url`]);
        const url=sourceUrl(supplied&&!/^https?:/i.test(supplied)?`https://${supplied}`:supplied);
        if(url&&!accounts.has(url))accounts.set(url,{platform:network,username:string(personFields[`${network}_username`])||new URL(url).pathname.split('/').filter(Boolean).at(-1)||'Profile',profileUrl:url,sourceUrl:'https://api.peopledatalabs.com/v5/person/enrich',retrievedAt:row.created_at,evidenceKind:'provider_match',decision:'unreviewed',recordId:row.id});
      }
    }
    // Only known timestamped post collections become events; never use saved_at.
    for (const key of ["posts", "tweets"]) if (Array.isArray(details[key])) for (const raw of details[key]) {
      const post = asRecord(raw);
      const date = actualDate(post.created_at || post.published_at || post.timestamp);
      const url = sourceUrl(post.url || post.permalink || post.source_url) || (row.tool_name==='twitter-deep-search'&&/^\d+$/.test(string(post.id))?`https://x.com/i/web/status/${post.id}`:"");
      const title = string(post.text || post.title || post.content);
      if (date && url && title) events.set(`post:${url}`, { id: `${row.id}:${url}`, title: title.slice(0,600), occurredAt: date, retrievedAt: row.created_at, sourceUrl: url, kind: "post" });
    }
    if(row.tool_name==='public-records'&&Array.isArray(details.results))for(const raw of details.results){
      const court=asRecord(raw);const date=actualDate(court.dateFiled||court.date_filed);const title=string(court.title||court.caseName||court.case_name);
      const path=string(court.source_url||court.docket_absolute_url||court.absolute_url);const url=sourceUrl(path.startsWith('/')?`https://www.courtlistener.com${path}`:path);
      const label=court.kind==='court_opinion'||(!court.kind&&!court.docket_absolute_url)?'Court opinion filed':'Court case filed';
      if(date&&url&&title)events.set(`filing:${url}`,{id:`${row.id}:${url}`,title:`${label}: ${title} (person match requires review)`,occurredAt:date,retrievedAt:row.created_at,sourceUrl:url,kind:'court_filing'});
    }
  }
  for (const account of accounts.values()) {
    account.decision = reviews.get(account.profileUrl) || "unreviewed";
    if (account.decision === "rejected") continue;
    if (account.email) addContact("email", account.email, `${account.platform} account; ${account.decision}`, account.retrievedAt, account.sourceUrl);
    if (account.phone) addContact("phone", account.phone, `${account.platform} account; ${account.decision}`, account.retrievedAt, account.sourceUrl);
    if (account.accountCreatedAt) events.set(`account:${account.profileUrl}`, { id: `account:${account.profileUrl}`, title: `${account.platform} account @${account.username} created (${account.decision === "accepted" ? "accepted match" : "candidate account"})`, occurredAt: account.accountCreatedAt, retrievedAt: account.retrievedAt, sourceUrl: account.sourceUrl, kind: "account_created" });
  }
  return { knownIdentifiers: identifiers.filter(i=>i.source==='input'||i.source==='auto_expansion'||i.source?.startsWith('live:')), accounts: [...accounts.values()], contacts: [...contacts.values()], evidence, events: [...events.values()].sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)), sourceRecords: records.filter(row => !row.tool_name.startsWith("person-investigation-review")) };
}
export type PersonDossier = ReturnType<typeof buildPersonDossier>;

export function dossierMarkdown(name: string, dossier: PersonDossier): string {
  const plain = (text: string) => text.replace(/[\r\n]/g, " ").replace(/[\\`*_{}<>#|]/g, "\\$&").split("[").join("\\[").split("]").join("\\]");
  const lines = [`# Investigation: ${plain(name)}`, `Exported: ${new Date().toISOString()}`, "", "Inputs, retrieved evidence and reviewed associations are distinct. This report is not a comprehensive background check.", "", "## Known identifiers"];
  for(const identifier of dossier.knownIdentifiers)lines.push(`- ${identifier.identifier_type}: ${plain(identifier.identifier_value)}; source: ${plain(identifier.source||'unknown')}; recorded: ${identifier.created_at}`);
  lines.push("", "## Accounts");
  for (const account of dossier.accounts) lines.push(`- ${plain(account.platform)} @${plain(account.username)} — ${account.decision}. Profile: ${account.profileUrl}; source: ${account.sourceUrl}; retrieved: ${account.retrievedAt}`);
  lines.push("", "## Contacts");
  for (const contact of dossier.contacts) lines.push(`- ${contact.type}: ${plain(contact.value)} — ${plain(contact.source)}. Source: ${contact.sourceUrl || "Provided identifier"}; recorded/retrieved: ${contact.retrievedAt}`);
  lines.push("", "## Dated events");
  for (const event of dossier.events) lines.push(`- ${event.occurredAt}: ${plain(event.title)}. Source: ${event.sourceUrl}; retrieved: ${event.retrievedAt}`);
  lines.push("", "## Evidence");
  for (const item of dossier.evidence) lines.push(`- ${plain(item.kind)}: ${plain(item.title)}${item.occurredAt ? ` (${item.occurredAt})` : " (event date unknown)"}. Source: ${item.sourceUrl}${item.note ? `; note: ${plain(item.note)}` : ""}`);
  lines.push("", "## Source photos");
  for(const account of dossier.accounts)if(account.decision!=='rejected'&&account.avatarUrl)lines.push(`- ${plain(account.platform)} @${plain(account.username)} (${account.decision}): ${account.avatarUrl}; original profile: ${account.profileUrl}`);
  for(const item of dossier.evidence)if(item.kind==='photo'&&item.imageUrl)lines.push(`- ${plain(item.title)}: ${item.imageUrl}; original source: ${item.sourceUrl}`);
  lines.push("", "## Source records");
  for (const row of dossier.sourceRecords) {
    const data=asRecord(row.result_data);const details=asRecord(data.details);const vehicle=asRecord(details.vehicle);
    lines.push(`- ${plain(row.tool_name)}; record ${row.id}; retrieved/saved ${row.created_at}${string(data.summary)?`; ${plain(string(data.summary))}`:''}`);
    if(sourceUrl(details.source))lines.push(`  Source: ${sourceUrl(details.source)}`);
    if(row.tool_name==='vin-decoder')for(const key of ['VIN','Make','Model','ModelYear','BodyClass','VehicleType','FuelTypePrimary'])if(string(vehicle[key]))lines.push(`  ${key}: ${plain(string(vehicle[key]))}`);
    if(['public-records','property-records','vehicle-lookup'].includes(row.tool_name)&&string(details.coverage))lines.push(`  Coverage: ${plain(string(details.coverage))}`);
    if(row.tool_name==='public-records'&&Array.isArray(details.results))for(const raw of details.results){const court=asRecord(raw);const path=string(court.source_url||court.docket_absolute_url||court.absolute_url);const url=sourceUrl(path.startsWith('/')?`https://www.courtlistener.com${path}`:path);lines.push(`  Court candidate: ${plain(string(court.title||court.caseName||court.case_name)||'Unnamed record')}; docket: ${plain(string(court.docketNumber||court.docket_number)||'not supplied')}; court: ${plain(string(court.court))}; filed: ${plain(string(court.dateFiled||court.date_filed)||'not supplied')}; terminated: ${plain(string(court.dateTerminated)||'not supplied')}; disposition: ${plain(string(court.disposition)||'not supplied')}; source: ${url||'not supplied'}; identity and disposition require source review.`);}
    if(row.tool_name==='property-records'&&Array.isArray(details.results))for(const raw of details.results){const property=asRecord(raw);lines.push(`  Property candidate: ${plain(string(property.title))}; recorded owner: ${plain(string(property.owner))}; additional owner: ${plain(string(property.additional_owner))}; property ID: ${plain(string(property.property_id))}; county: ${plain(string(property.county))}; assessed value: ${typeof property.assessed_value==='number'?property.assessed_value:'not supplied'}; market value reported by source: ${typeof property.market_value==='number'?property.market_value:'not supplied'}; recorded deed date: ${plain(string(property.deed_date)||'not supplied')}; source update: ${plain(string(property.source_updated_at)||'not supplied')}; source: ${sourceUrl(property.source_url)||'not supplied'}; person association unverified.`);}
    if(row.tool_name==='vehicle-lookup')for(const key of ['VIN','vin','Make','make','Model','model','ModelYear','year','plate','state','country'])if(string(vehicle[key]))lines.push(`  ${key}: ${plain(string(vehicle[key]))}`);
  }
  lines.push("", "## Coverage", "Criminal/court and asset findings require review of the original records. No result does not establish a clean history or absence of assets. Vehicle specifications do not establish ownership. Only dated source observations appear in the event timeline.");
  return lines.join("\n");
}
