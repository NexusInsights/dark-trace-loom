import { authenticatedUser } from '../_lib/auth.js';
import { lookupPublicRecords } from '../../src/lib/publicRecords';
import { lookupPlate } from '../_lib/carsxe.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Record-Lookup-Version': '2026-10-18.2' } });

async function readBody(request) {
  if (!request.body || Number(request.headers.get('content-length') || 0) > 4096) throw new Error('Provide a JSON request no larger than 4 KiB.');
  const reader = request.body.getReader(); const decoder = new TextDecoder(); let text = ''; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); throw new Error('Request exceeds 4 KiB.'); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const body = JSON.parse(text);
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['public-records', 'property-records', 'vehicle-lookup'].includes(body.tool)) throw new Error('Select a supported record source.');
  if (!body.inputs || typeof body.inputs !== 'object' || Array.isArray(body.inputs) || Object.keys(body.inputs).length > 8 || Object.values(body.inputs).some(value => typeof value !== 'string')) throw new Error('Provide a valid source input object.');
  return body;
}

export async function onRequestPost({ request, env }) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: 'Cross-origin requests are not permitted.' }, 403);
    const user = await authenticatedUser(request, env);
    if (!user) return json({ error: 'Sign in to search public records.' }, 401);
    let body;
    try { body = await readBody(request); } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid JSON request.' }, 400); }
    if (body.tool === 'vehicle-lookup' && (!env.CARSXE_ACCOUNT_USER_ID || user.id !== env.CARSXE_ACCOUNT_USER_ID)) return json({ error: 'The connected CarsXE allowance is restricted to its configured workspace account.' }, 403);
    // Keep existing administrator tool restrictions on the server boundary too.
    const permissions = new URL(`${env.SUPABASE_URL}/rest/v1/tool_permissions`);
    permissions.searchParams.set('select', 'allowed'); permissions.searchParams.set('user_id', `eq.${user.id}`); permissions.searchParams.set('tool_id', `eq.${body.tool}`);
    const response = await fetch(permissions, { headers: { Authorization: request.headers.get('authorization'), apikey: env.SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return json({ error: 'Tool permissions could not be verified. No source query was made.' }, 503);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.some(row => typeof row.allowed !== 'boolean')) return json({ error: 'Tool permission response was invalid. No source query was made.' }, 503);
    if (rows.some(row => row.allowed === false)) return json({ error: 'This source is disabled for your account.' }, 403);
    return json(body.tool === 'vehicle-lookup' ? await lookupPlate(body.inputs, env.CARSXE_API_KEY) : await lookupPublicRecords(body.tool, body.inputs));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Public-record lookup failed. No result was inferred.' }, 502);
  }
}
export async function onRequestGet({ request, env }) {
  try {
    const user = await authenticatedUser(request, env);
    if (!user) return json({ error: 'Sign in to check source access.' }, 401);
    const owner = Boolean(env.CARSXE_ACCOUNT_USER_ID && user.id === env.CARSXE_ACCOUNT_USER_ID);
    return json({ configured: Boolean(env.CARSXE_API_KEY && owner), missing_secrets: env.CARSXE_API_KEY ? [] : ['CARSXE_API_KEY'], source: 'CarsXE production secret', coverage: owner ? 'Uses the connected account credits for one explicit plate/state/country. No automatic retries, jurisdiction fan-out, or extra specifications call.' : 'The connected CarsXE allowance is restricted to its configured workspace account.' });
  } catch { return json({ error: 'Source access could not be verified.' }, 503); }
}
