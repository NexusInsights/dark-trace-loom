import { supabase } from '@/integrations/supabase/client';
import { checkedDatabase } from '@/lib/checkedDatabase';
import type { Json } from '@/integrations/supabase/types';
import { normalizeEventTime, verifyLedger } from './evidence-core.mjs';
import type { EvidenceLedger } from './EvidenceWorkbenchPanel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const maximum = 100000;

export function researchContext(personaId: string | null) {
  if (personaId !== null && !UUID.test(personaId)) throw new Error('Select a valid investigation.');
  return personaId ? `persona:${personaId}` : 'research-default';
}

async function bounded<T>(operation: (signal: AbortSignal) => PromiseLike<T>, milliseconds = 20000): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
  const timed = new Promise<never>((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('The research record request timed out. No mutation retry was made.')); }, milliseconds); });
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timed]); }
  catch (error) { if (controller.signal.aborted) throw new Error('The research record request timed out. No mutation retry was made.'); throw error; }
  finally { clearTimeout(timer!); }
}

async function expectedSession(userId: string) {
  if (!UUID.test(userId)) throw new Error('Sign in before opening research records.');
  const current = await bounded(() => supabase.auth.getSession(), 12000);
  if (current.error || current.data.session?.user.id !== userId || current.data.session.user.is_anonymous || !current.data.session.access_token) throw new Error('This account session changed. Reopen the research workspace.');
  return current.data.session;
}

async function ownContext(userId: string, personaId: string | null) {
  const context = researchContext(personaId); await expectedSession(userId);
  if (personaId) {
    const response = await bounded(signal => checkedDatabase(supabase.from('personas').select('id').eq('id', personaId).eq('user_id', userId).abortSignal(signal).maybeSingle()));
    if (!response.data?.id) throw new Error('This investigation is unavailable to the current account.');
  }
  return context;
}

export async function loadResearchLedger(userId: string, personaId: string | null) {
  const context = await ownContext(userId, personaId);
  const result = await bounded(signal => checkedDatabase(supabase.from('tool_results').select('result_data').eq('user_id', userId).eq('tool_name', 'research-evidence-ledger').contains('result_data', { workspace_id: context }).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).abortSignal(signal)));
  if (!result.data?.length) return null;
  const data = record(result.data[0].result_data);
  const ledger = data.ledger;
  if (data.kind !== 'research-evidence-ledger' || data.workspace_id !== context || record(ledger).caseId !== context) throw new Error('The saved ledger does not match this workspace.');
  const head = typeof data.audit_head === 'string' ? data.audit_head : null;
  const integrity = await verifyLedger(ledger, { expectedHead: head });
  if (!integrity.ok) throw new Error('Saved evidence integrity could not be verified. The record was not loaded.');
  return ledger;
}

export async function saveResearchLedger(userId: string, personaId: string | null, ledger: EvidenceLedger, { purpose, authorized }: { purpose: string; authorized: boolean }) {
  if (!authorized || !purpose.trim() || purpose.length > 500) throw new Error('Record the investigation purpose and confirm source authorization before saving.');
  const context = await ownContext(userId, personaId);
  if (ledger.caseId !== context || !(await verifyLedger(ledger)).ok) throw new Error('The evidence ledger does not belong to this workspace or failed integrity verification.');
  const payload = { kind: 'research-evidence-ledger', workspace_id: context, ...(personaId ? { persona_id: personaId } : {}), purpose: purpose.trim(), source_authorization_confirmed: true, audit_head: ledger.audit.at(-1)?.digest ?? null, ledger };
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > maximum) throw new Error('This snapshot exceeds the existing 100 KB saved-record limit. Keep a smaller workspace or use an allowed local export.');
  await bounded(signal => checkedDatabase(supabase.from('tool_results').insert({ user_id: userId, tool_name: 'research-evidence-ledger', status: 'success', result_data: payload as unknown as Json }).abortSignal(signal)));
}

function publicSource(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const secretKey = /^(?:api[_-]?key|access[_-]?token|id[_-]?token|refresh[_-]?token|token|authorization|password|secret|session|signature|code)$/i;
    if (Array.from(url.searchParams.keys()).some(key => secretKey.test(key))) return null;
    if (url.hash && Array.from(new URLSearchParams(url.hash.slice(1)).keys()).some(key => secretKey.test(key))) return null;
    return url.href;
  } catch { return null; }
}

export function normalizeSavedEvidence(rows: Array<{ id: string; result_data: unknown; created_at: string }>, personaId: string, label: string) {
  if (!UUID.test(personaId) || rows.length > 25) throw new Error('Saved evidence scope exceeds its limit.');
  const entityId = `saved-person:${personaId}`;
  return rows.flatMap(row => {
    const data = record(row.result_data); const item = record(data.item); const url = publicSource(item.sourceUrl);
    if (data.persona_id !== personaId || !url) return [];
    const title = typeof item.title === 'string' ? item.title.slice(0, 300) : 'Saved source assertion';
    const note = typeof item.note === 'string' ? item.note.slice(0, 5000) : '';
    const rawDate = typeof item.occurredAt === 'string' ? item.occurredAt : '';
    let eventTime = null; try { const normalized = normalizeEventTime(rawDate || null); eventTime = normalized?.precision === 'day' ? normalized.value.slice(0, 10) : normalized?.value ?? null; } catch { /* Invalid source dates remain undated. */ }
    return [{
      source: { id: `saved-source:${row.id}`, label: 'Investigator-supplied source record', url, provider: 'Existing case evidence', independence: 'unknown' },
      entities: [{ id: entityId, type: 'Person', label: label.slice(0, 500), identifiers: [] }],
      observations: [{ id: `saved-observation:${row.id}`, entityId, property: 'source_assertion', value: [title, note].filter(Boolean).join('\n'), eventTime, capturedAt: row.created_at }], claims: [],
    }];
  });
}

export async function importInvestigationEvidence(userId: string, personaId: string, label: string) {
  await ownContext(userId, personaId);
  const result = await bounded(signal => checkedDatabase(supabase.from('tool_results').select('id,result_data,created_at').eq('user_id', userId).eq('tool_name', 'person-investigation-evidence').contains('result_data', { persona_id: personaId }).order('created_at', { ascending: false }).limit(25).abortSignal(signal)));
  return normalizeSavedEvidence(result.data || [], personaId, label);
}

export async function lookupOrganizationEvidence(userId: string, lei: string) {
  const session = await expectedSession(userId);
  return bounded(async signal => {
    const response = await fetch('/api/research-gleif', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal, headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lei }) });
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > 65536)) { void response.body?.cancel().catch(() => undefined); throw new Error('The registry response exceeded its display limit.'); }
    if (!response.body) throw new Error('The registry response was empty.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); }; signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) throw new Error('The registry request timed out.');
      for (;;) { const part = await reader.read(); if (signal.aborted) throw new Error('The registry request timed out.'); if (part.done) break; size += part.value.byteLength; if (size > 65536) throw new Error('The registry response exceeded its display limit.'); chunks.push(part.value); }
    } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
    finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes);
    let data; try { data = JSON.parse(text); } catch { throw new Error('The registry response could not be read.'); }
    if (!response.ok || data?.ok !== true) throw new Error(typeof data?.error?.message === 'string' && data.error.message.length <= 500 ? data.error.message : 'The registry lookup could not be completed.');
    if (data.data?.status === 'no_match') throw new Error('No record was found for this LEI in the GLEIF index; this does not establish that a business does not exist.');
    if (data.data?.status !== 'found' || !data.data.evidenceInput) throw new Error('The registry supplied no usable legal-entity observation.');
    return data.data.evidenceInput;
  }, 70000);
}
