import { useEffect, useRef, useState } from 'react';
import { captureFingerprint } from '../intelligence/browser-client.js';
import { capturePrivacySnapshot, checkPrivatePassword, comparePrivacySnapshots } from './privacy-password.mjs';

const button = 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400';
const secondary = 'rounded-md border border-slate-500 px-4 py-2 text-sm text-slate-100 disabled:opacity-50';
const panel = 'min-w-0 space-y-4 rounded-xl border border-slate-600/60 bg-slate-900/45 p-5 text-slate-100';
const input = 'w-full rounded-md border border-slate-500 bg-slate-950 px-3 py-2 text-slate-100';
type PrivacySnapshot = Awaited<ReturnType<typeof capturePrivacySnapshot>>;
type PasswordResult = Awaited<ReturnType<typeof checkPrivatePassword>>;
type LocalAction = 'research-privacy' | 'research-password';
export type LocalResearchExecutor = <T>(action: LocalAction, operation: (context: { signal: AbortSignal }) => Promise<T>, options?: { signal?: AbortSignal }) => Promise<T>;
type PanelPolicy = { execute: LocalResearchExecutor; disabled?: boolean; reason?: string };

function failure(error: unknown) { return error instanceof Error ? error.message : 'This operation could not be completed.'; }

export function BrowserPrivacyPanel({ execute, disabled = false, reason }: PanelPolicy) {
  const [consent, setConsent] = useState(false);
  const [includeFingerprint, setIncludeFingerprint] = useState(false);
  const [baseline, setBaseline] = useState<PrivacySnapshot | null>(null);
  const [current, setCurrent] = useState<PrivacySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true); const capturing = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function capture(asBaseline: boolean) {
    if (!consent || capturing.current || disabled) return;
    capturing.current = true; setBusy(true); setError('');
    try {
      const value = await execute('research-privacy', () => capturePrivacySnapshot({ ...(includeFingerprint ? { fingerprintCapture: captureFingerprint } : {}) }));
      if (!alive.current) return;
      if (asBaseline || !baseline) { setBaseline(value); setCurrent(null); } else setCurrent(value);
    } catch (error) { if (alive.current) setError(failure(error)); }
    finally { capturing.current = false; if (alive.current) setBusy(false); }
  }
  const comparison = baseline && current ? comparePrivacySnapshots(baseline, current) : null;
  const visible = current || baseline;
  return <section className={panel} aria-labelledby="privacy-lab-heading">
    <h2 id="privacy-lab-heading" className="text-xl font-semibold">Browser privacy lab</h2>
    <p className="text-sm text-slate-300">Inspect this app’s permission states, storage counts and visible resource origins. Permission inspection does not request access. Storage values and full resource URLs are excluded.</p>
    {reason && <p className="text-sm text-amber-200">{reason}</p>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} className="mt-1" />I agree to inspect this browser locally.</label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={includeFingerprint} onChange={e => setIncludeFingerprint(e.target.checked)} disabled={busy} className="mt-1" />Also capture a browser fingerprint for this comparison.</label>
    <div className="flex flex-wrap gap-2"><button className={button} onClick={() => void capture(true)} disabled={!consent || busy || disabled}>{busy ? 'Inspecting…' : 'Capture baseline'}</button><button className={secondary} onClick={() => void capture(false)} disabled={!consent || busy || disabled || !baseline}>Capture comparison</button><button className={secondary} disabled={busy || !baseline} onClick={() => { setBaseline(null); setCurrent(null); setError(''); }}>Clear local snapshots</button></div>
    <p className="text-xs text-slate-400">For a controlled test, capture a baseline, resize this browser window or change a browser privacy setting yourself, then capture a comparison. These snapshots are kept in page memory only.</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {comparison && <div role="status" className="space-y-2"><p>{comparison.changed ? `${comparison.changes.length} observed signal changes` : 'No observed signal changes'}</p>{comparison.changes.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Signal</th><th className="p-2">Baseline</th><th className="p-2">Comparison</th></tr></thead><tbody>{comparison.changes.map(change => <tr key={change.signal} className="border-t border-slate-700"><td className="break-all p-2">{change.signal}</td><td className="break-all p-2">{JSON.stringify(change.before)}</td><td className="break-all p-2">{JSON.stringify(change.after)}</td></tr>)}</tbody></table></div>}<p className="text-xs text-slate-400">{comparison.limitation}</p></div>}
    {visible && <div className="space-y-3">
      <p className="text-xs text-slate-400">Captured {visible.capturedAt}. HTTP-only cookies are not observable here. Performance entries do not constitute a complete network or tracker audit.</p>
      <div className="grid gap-3 sm:grid-cols-2"><div><h3 className="mb-1 text-sm font-semibold">Permission states</h3><dl className="text-sm">{Object.entries(visible.permissions).map(([name, state]) => <div key={name} className="flex flex-wrap justify-between gap-2 border-b border-slate-700 py-1"><dt>{name}</dt><dd>{String(state)}</dd></div>)}</dl></div><div><h3 className="mb-1 text-sm font-semibold">Storage metadata</h3><p className="text-sm">Readable cookies: {visible.storage.readableCookieCount ?? 'unavailable'}</p><p className="text-sm">Local storage keys: {visible.storage.localStorage.keyCount ?? 'unavailable'}</p><p className="text-sm">Session storage keys: {visible.storage.sessionStorage.keyCount ?? 'unavailable'}</p><p className="text-sm">Storage persistence: {visible.storage.persistence}</p><p className="text-sm">Viewport: {visible.signals.viewportWidth} × {visible.signals.viewportHeight}</p><p className="text-sm">Fingerprint: {visible.fingerprint.status}</p></div></div>
      <div><h3 className="text-sm font-semibold">Visible resource origins</h3><ul className="mt-1 space-y-1 text-xs">{visible.resources.map(item => <li key={item.origin} className="break-all">{item.origin} · {item.relationship.replaceAll('_', ' ')} · {item.observedCount} observed resources</li>)}</ul>{!visible.resources.length && <p className="text-sm text-slate-400">No resource origins were visible through this API.</p>}</div>
    </div>}
  </section>;
}

export function PrivatePasswordPanel({ execute, disabled = false, reason }: PanelPolicy) {
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PasswordResult | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  async function check(event: React.FormEvent) {
    event.preventDefault(); if (!consent || !password || controller.current || disabled) return;
    const value = password; setPassword(''); setError(''); setResult(null); setBusy(true);
    const active = new AbortController(); controller.current = active;
    try { const valueResult = await execute('research-password', ({ signal }) => checkPrivatePassword(value, { signal }), { signal: active.signal }); if (alive.current && controller.current === active) setResult(valueResult); }
    catch (error) { if (alive.current && controller.current === active) setError(failure(error)); }
    finally { if (controller.current === active) { controller.current = null; if (alive.current) setBusy(false); } }
  }
  return <section className={panel} aria-labelledby="private-password-heading">
    <h2 id="private-password-heading" className="text-xl font-semibold">Private password-exposure check</h2>
    <p className="text-sm text-slate-300">The browser hashes the submitted password locally and sends only the first five SHA-1 characters to HIBP’s free range API. Returned suffixes are compared locally. This tool does not save the password, its hash or the matching suffix.</p>
    {reason && <p className="text-sm text-amber-200">{reason}</p>}
    <form onSubmit={event => void check(event)} className="space-y-3" autoComplete="off">
      <label className="block text-sm">Password to check<input aria-label="Password to check" type="password" className={`${input} mt-1`} value={password} onChange={e => setPassword(e.target.value)} maxLength={4096} disabled={busy} autoComplete="off" spellCheck={false} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} className="mt-1" />I understand that HIBP receives a five-character hash prefix and my network request.</label>
      <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={busy || disabled || !consent || !password}>{busy ? 'Checking range…' : 'Check password exposure'}</button>{busy && <button type="button" className={secondary} onClick={() => controller.current?.abort()}>Cancel password check</button>}{!busy && (result || error) && <button type="button" className={secondary} onClick={() => { setResult(null); setError(''); }}>Clear result</button>}</div>
    </form>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {result && <div role="status" className="rounded-lg border border-slate-600 p-3 text-sm"><p className="font-semibold">{result.status === 'found' ? `Found in the password corpus (${result.exposureCount.toLocaleString()} observations)` : 'No matching password hash found in this response'}</p><p className="mt-2 text-slate-300">{result.limitation}</p><p className="mt-2 text-xs text-slate-400">Checked {result.checkedAt}. One submitted check; no incremental typing queries or automatic retries.</p></div>}
    <p className="text-xs text-slate-400">Password data: <a href="https://haveibeenpwned.com/Passwords" target="_blank" rel="noreferrer" className="underline">Have I Been Pwned</a>. Padded range responses are requested. A missing match is not a safety guarantee.</p>
  </section>;
}
