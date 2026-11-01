import { useMemo, useState } from 'react';
import { researchCatalog } from './methods-catalog.mjs';

type Method = { id: number; priority: string; title: string; category: string; method: string; automation: string; acceptance: string; implementation: string; implementationNote: string };
const labels: Record<string, string> = { implemented: 'Implemented foundation', partial: 'Partially implemented', existing: 'Existing application tool', planned: 'Research candidate', approval_required: 'Access or agreement required', manual: 'Manual official-source workflow' };
const input = 'rounded-md border border-slate-500 bg-slate-950 px-3 py-2 text-sm text-slate-100';

function LinkedText({ text }: { text: string }) {
  const result: React.ReactNode[] = []; let offset = 0;
  const links = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of text.matchAll(links)) {
    result.push(text.slice(offset, match.index));
    let safe = false; try { const url = new URL(match[2]); safe = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { /* Render invalid URLs as text. */ }
    result.push(safe ? <a className="underline text-indigo-300" href={match[2]} target="_blank" rel="noreferrer" key={`${match.index}-${match[2]}`}>{match[1]}</a> : match[1]);
    offset = match.index! + match[0].length;
  }
  result.push(text.slice(offset)); return <>{result}</>;
}

export function MethodsCatalogPanel() {
  const [query, setQuery] = useState(''); const [priority, setPriority] = useState('all'); const [implementation, setImplementation] = useState('all');
  const methods = researchCatalog.methods as Method[];
  const filtered = useMemo(() => methods.filter(row => (priority === 'all' || row.priority === priority) && (implementation === 'all' || row.implementation === implementation) && `${row.title} ${row.method} ${row.automation} ${row.acceptance}`.toLowerCase().includes(query.trim().toLowerCase())), [methods, query, priority, implementation]);
  return <section className="space-y-4 text-slate-100" aria-labelledby="methods-library-title">
    <h2 id="methods-library-title" className="text-xl font-semibold">Identification and background methods library</h2>
    <p className="max-w-4xl text-sm text-slate-300">A reviewed inventory of 38 methods, with primary sources, automation limits and matching safeguards. Research as of {researchCatalog.asOf}. Implementation labels distinguish built foundations from unconnected datasets. None is a blanket background-clearance or eligibility decision.</p>
    <div className="flex flex-wrap gap-3"><a className="text-sm text-indigo-300 underline" href="/research-resources/person-methods.md" download>Download the full methods research</a><a className="text-sm text-indigo-300 underline" href="/research-resources/platforms.md" download>Download the platform comparison</a></div>
    <div className="grid gap-3 md:grid-cols-3"><label className="space-y-1 text-sm">Find a method<input className={`${input} w-full`} value={query} onChange={e => setQuery(e.target.value)} placeholder="licence, provenance, court, LEI…" /></label><label className="space-y-1 text-sm">Priority<select className={`${input} w-full`} value={priority} onChange={e => setPriority(e.target.value)}><option value="all">All priorities</option><option value="P0">P0 — foundations</option><option value="P1">P1 — first integrations</option><option value="P2">P2 — specialized/access dependent</option></select></label><label className="space-y-1 text-sm">Implementation<select className={`${input} w-full`} value={implementation} onChange={e => setImplementation(e.target.value)}><option value="all">All implementation states</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <p role="status" className="text-sm text-slate-400">Showing {filtered.length} of {methods.length} methods</p>
    <div className="space-y-3">{filtered.map(row => <details key={row.id} className="rounded-lg border border-slate-600 bg-slate-900/45 p-4"><summary className="cursor-pointer space-y-1"><span className="block font-semibold">{row.id}. {row.title}</span><span className="block text-xs text-slate-400">{row.priority} · {labels[row.implementation]}</span></summary><div className="mt-4 space-y-4 text-sm"><p className="rounded border border-slate-700 p-3">{row.implementationNote}</p><div><h3 className="mb-1 font-semibold">Method and primary sources</h3><p><LinkedText text={row.method} /></p></div><div><h3 className="mb-1 font-semibold">Automation, access and licence</h3><p><LinkedText text={row.automation} /></p></div><div><h3 className="mb-1 font-semibold">Evidence rule and acceptance check</h3><p><LinkedText text={row.acceptance} /></p></div></div></details>)}</div>
    {!filtered.length && <p className="text-sm text-slate-300">No methods match these filters. This is not a finding about any person.</p>}
    <div className="rounded-lg border border-slate-600 bg-slate-900/45 p-4 text-sm space-y-2"><h3 className="font-semibold">What the platform research contributed</h3><p>Palantir’s object/link/action approach informed the typed evidence ledger and review boundaries. i2 and OpenCTI informed source references and analyst review. Hunchly informed capture import and original-byte validation. Documented Maltego, FollowTheMoney, GEXF, PROV and appropriate STIX formats support portable exports.</p><p>File adapters are tested against documented formats and controlled fixtures. Licensed vendor-client acceptance, account coverage and paid API access remain separate checks. Proprietary implementation was not copied.</p><p><a className="underline text-indigo-300" href="https://www.palantir.com/docs/foundry/ontology" target="_blank" rel="noreferrer">Palantir ontology</a> · <a className="underline text-indigo-300" href="https://docs.i2group.com/analyze/4.4.6/implementing_source_references.html" target="_blank" rel="noreferrer">i2 source references</a> · <a className="underline text-indigo-300" href="https://support.hunch.ly/article/67-2-hunchly-data-forwarding" target="_blank" rel="noreferrer">Hunchly capture format</a> · <a className="underline text-indigo-300" href="https://docs.opencti.io/latest/usage/draftWorkspaces/" target="_blank" rel="noreferrer">OpenCTI review workspaces</a></p></div>
  </section>;
}
