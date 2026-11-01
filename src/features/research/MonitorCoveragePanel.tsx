import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { monitoringRequest } from "@/lib/monitoringClient";
import { Button } from "@/components/ui/button";
import { authorizedSource, coverageLabels, monitorDate, parseMonitorHistory, parseMonitorJobs, parseMonitorStatus, snapshotDiff, verifiedSnapshots, verifySnapshot, type MonitorHistory, type MonitorJob, type MonitorStatus, type VerifiedSnapshot } from "./monitoring-model";

const inputClass = "w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-sm";
const message = (error: unknown) => error instanceof Error ? error.message : "Monitoring could not complete this operation.";

function SnapshotEvidence({ kind, record, title }: { kind: string; record: VerifiedSnapshot; title: string }) {
  const [integrity, setIntegrity] = useState("Checking SHA-256…");
  useEffect(() => {
    let active = true; setIntegrity("Checking SHA-256…");
    verifySnapshot(kind, record).then(matches => { if (active) setIntegrity(matches ? "SHA-256 verified against stored receipt" : "SHA-256 mismatch: this snapshot does not match its receipt"); }).catch(error => { if (active) setIntegrity(message(error)); });
    return () => { active = false; };
  }, [kind, record]);
  return <div className="min-w-0 space-y-2 rounded border border-border p-3">
    <h4 className="font-semibold">{title}</h4>
    <p className="text-xs">Successful source check recorded: {monitorDate(record.observed_at)}</p>
    <p className="break-all text-xs">Source: {record.snapshot.source}</p>
    <p className="text-xs" role="status">{integrity}</p>
    <p className="break-all font-mono text-xs">{record.content_hash}</p>
    <p className="text-xs text-muted-foreground">{record.snapshot.coverage}</p>
    <details><summary className="cursor-pointer text-sm">Stored source snapshot</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(record.snapshot, null, 2)}</pre></details>
  </div>;
}

function HistoryView({ job, history }: { job: MonitorJob; history: MonitorHistory }) {
  const snapshots = verifiedSnapshots(history);
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const after = snapshots.find(row => row.id === afterId) || snapshots[0];
  const before = snapshots.find(row => row.id === beforeId) || snapshots.find(row => row.content_hash !== after?.content_hash);
  const differences = before && after ? snapshotDiff(job.kind, before.snapshot, after.snapshot) : [];
  return <section aria-label={`Source history for ${job.label}`} className="space-y-4 border-t border-border pt-4">
    <h3 className="font-semibold">Source history: {job.label}</h3>
    <p className="text-xs text-muted-foreground">{history.comparison_policy || "Snapshots compare normalized source data; polling times do not establish content changes."}</p>
    <p className="text-xs">Showing up to {history.history_limit || 100} recent check receipts. Unchanged checks share the prior content hash; older distinct snapshots may fall outside this window.</p>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm">Earlier snapshot<select aria-label="Earlier snapshot" className={inputClass} value={before?.id || ""} onChange={event => setBeforeId(event.target.value)} disabled={snapshots.length < 2}>{!before && <option value="">No earlier distinct snapshot</option>}{snapshots.map(row => <option key={row.id} value={row.id}>{monitorDate(row.observed_at)} · {row.content_hash.slice(0, 12)}</option>)}</select></label>
      <label className="text-sm">Later snapshot<select aria-label="Later snapshot" className={inputClass} value={after?.id || ""} onChange={event => setAfterId(event.target.value)} disabled={!snapshots.length}>{!after && <option value="">No verified snapshot</option>}{snapshots.map(row => <option key={row.id} value={row.id}>{monitorDate(row.observed_at)} · {row.content_hash.slice(0, 12)}</option>)}</select></label>
    </div>
    <div className="grid gap-3 md:grid-cols-2">{before && <SnapshotEvidence kind={job.kind} record={before} title="Earlier stored evidence" />}{after && <SnapshotEvidence kind={job.kind} record={after} title="Later stored evidence" />}</div>
    {!after && <p>No successful source observation has been recorded. Failed or blocked checks do not establish a negative finding.</p>}
    {before && after && <div className="space-y-3"><h4 className="font-semibold">Normalized field changes</h4>{differences.length === 0 ? <p>No content differences between these snapshots.</p> : <>{differences.map(change => <div key={change.field} className="rounded border border-border p-3"><p className="text-sm font-medium break-all">{change.field}</p><div className="grid gap-2 md:grid-cols-2"><div><p className="text-xs text-muted-foreground">Before</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{change.before}</pre></div><div><p className="text-xs text-muted-foreground">After</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{change.after}</pre></div></div></div>)}{differences.length === 64 && <p className="text-xs">Showing the first 64 changed fields. Open the stored snapshots to inspect the full evidence.</p>}</>}</div>}
    <details><summary className="cursor-pointer font-semibold">All returned check receipts ({history.history.length})</summary><div className="mt-3 space-y-2">{history.history.map(row => <div key={row.id} className="rounded border border-border p-3 text-xs space-y-1"><p>{monitorDate(row.observed_at)} · {row.state}{row.failure_receipt?.coverage_state ? ` · ${row.failure_receipt.coverage_state.replace(/_/g, " ")}` : ""}</p>{row.error && <p className="text-destructive">{row.error}</p>}{row.content_hash && <p className="break-all font-mono">{row.content_hash}</p>}</div>)}</div></details>
  </section>;
}

export function MonitorCoveragePanel({ className = "" }: { className?: string }) {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [jobs, setJobs] = useState<MonitorJob[]>([]);
  const [history, setHistory] = useState<{ job: MonitorJob; data: MonitorHistory } | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [kind, setKind] = useState("page"), [label, setLabel] = useState(""), [url, setUrl] = useState(""), [interval, setInterval] = useState("3600"), [authorized, setAuthorized] = useState(false);
  const sequence = useRef(0), currentUser = useRef(user?.id);
  currentUser.current = user?.id;

  const refresh = useCallback(async (owner = user?.id) => {
    const request = ++sequence.current;
    if (!owner || authLoading) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [runtime, response] = await Promise.all([monitoringRequest("/v1/status"), monitoringRequest("/v1/jobs")]);
      const nextStatus = parseMonitorStatus(runtime), nextJobs = parseMonitorJobs(response);
      if (request !== sequence.current || owner !== currentUser.current) return;
      setStatus(nextStatus); setJobs(nextJobs);
    } catch (failure) { if (request === sequence.current && owner === currentUser.current) setError(message(failure)); }
    finally { if (request === sequence.current && owner === currentUser.current) setLoading(false); }
  }, [user?.id, authLoading]);
  useEffect(() => {
    setStatus(null); setJobs([]); setHistory(null); setError(null); setNotice(""); setAuthorized(false); setBusy(false);
    void refresh(user?.id);
    const requestSequence = sequence;
    return () => { requestSequence.current++; };
  }, [user?.id, authLoading, refresh]);

  async function perform(operation: () => Promise<void>) {
    if (busy || loading || authLoading || !user) return;
    const owner = user.id; setBusy(true); setError(null); setNotice("");
    try { await operation(); if (owner === currentUser.current) await refresh(owner); }
    catch (failure) { if (owner === currentUser.current) setError(message(failure)); }
    finally { if (owner === currentUser.current) setBusy(false); }
  }
  const locked = busy || loading || authLoading || !user;
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (!authorized) { setError("Authorize recurring checks of this public source first."); return; }
    await perform(async () => {
      const approvedUrl = authorizedSource(url, status);
      await monitoringRequest("/v1/jobs", "POST", { kind, label: label.trim(), params: { url: approvedUrl }, interval_seconds: Number(interval), polling_authorized: true, paid_daily_budget: 0 });
      setNotice("Monitor created. The existing server scheduler owns recurring checks; the first successful check establishes a baseline."); setAuthorized(false);
    });
  }
  return <section className={`space-y-5 min-w-0 ${className}`} aria-label="Source snapshots and coverage">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Source snapshots and coverage</h2><p className="text-sm text-muted-foreground">User-scoped source history, meaningful changes and explicit coverage limits.</p></div><Button variant="outline" disabled={locked} onClick={() => void refresh()}>Refresh monitoring</Button></div>
    {loading && <p role="status">Loading monitoring receipts…</p>}{!user && !authLoading && <p>Sign in to inspect source history.</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
    {status && <div className="rounded border border-border p-3 text-sm space-y-1"><p>Last scheduler completion: {monitorDate(status.scheduler?.last_tick?.completed_at)} · Next alarm: {monitorDate(status.scheduler?.next_alarm_at)}</p><p className="text-xs text-muted-foreground">These are stored/runtime receipts. A configured scheduler is not proof that a source was checked or an alert delivered. This panel does not start another scheduler.</p></div>}
    <form onSubmit={create} className="rounded border border-border p-4 space-y-3">
      <h3 className="font-semibold">Authorize a public source monitor</h3>
      <p className="text-xs text-muted-foreground">Available hostnames: {status?.authorized_page_hosts.length ? status.authorized_page_hosts.join(", ") : "No page/feed hostnames are approved in the runtime."} This form does not add hostnames or allocate paid-provider calls. Hosting storage and polling still use resources.</p>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Source type<select className={inputClass} value={kind} onChange={event => setKind(event.target.value)} disabled={locked}><option value="page">Public page</option><option value="rss">RSS / Atom feed</option></select></label><label className="text-sm">Monitor label<input className={inputClass} value={label} onChange={event => setLabel(event.target.value)} maxLength={100} required disabled={locked} /></label></div>
      <label className="block text-sm">Public HTTPS source URL<input type="url" className={inputClass} value={url} onChange={event => setUrl(event.target.value)} maxLength={2000} required disabled={locked} placeholder="https://approved.example/source" /></label>
      <label className="block text-sm">Check interval<select className={inputClass} value={interval} onChange={event => setInterval(event.target.value)} disabled={locked}><option value="3600">Hourly</option><option value="86400">Daily</option><option value="604800">Weekly</option></select></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} disabled={locked} className="mt-1" />I authorize recurring checks of this public source and the associated hosting/storage use.</label>
      <Button type="submit" disabled={locked || !status?.authorized_page_hosts.length || !authorized}>Create authorized monitor</Button>
    </form>
    <div className="space-y-3"><h3 className="font-semibold">Coverage and freshness</h3>{!loading && status && jobs.length === 0 && <p className="text-sm">No monitor jobs are recorded for this account.</p>}{jobs.map(job => <article key={job.id} className="rounded border border-border p-4 space-y-2 min-w-0">
      <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold break-all">{job.label}</h4><span className="text-xs rounded border border-border px-2 py-1">{job.coverage && coverageLabels[job.coverage.state] || "Coverage unavailable: runtime update required"}{job.coverage?.partial ? " · partial source coverage" : ""}</span></div>
      <p className="text-xs">{job.kind} · {job.enabled ? "Scheduled" : "Paused"} · Last attempt: {monitorDate(job.coverage?.last_attempt ?? job.last_checked)} · Last successful source check: {monitorDate(job.coverage?.last_success)}</p>
      <p className="text-xs">Next due: {monitorDate(job.next_due)}{job.coverage?.stale ? " · Earlier verified evidence is stale." : ""}</p>
      {job.coverage?.reason && <p className="text-sm text-destructive">{job.coverage.reason}</p>}
      {job.coverage?.last_verified_state && <p className="text-xs text-muted-foreground">Retained observation: {job.coverage.last_verified_state === "no_match" ? "no match in the checked source" : "source data found"}. An unsuccessful later check does not replace this evidence.</p>}
      {job.budget && <p className="text-xs">Licensed-provider allowance ({job.budget.day} UTC): {job.budget.used} used / {job.budget.approved_daily_limit} approved; {job.budget.remaining} remaining.{!job.budget.requires_licensed_bridge ? " This source uses its public poller." : " A configured bridge and verified provider access are also required."} Hosting costs and provider-wide quotas are separate.</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={locked} onClick={() => void perform(async () => { const owner = user?.id; const data = parseMonitorHistory(await monitoringRequest(`/v1/jobs/${job.id}/history?limit=20`)); if (owner === currentUser.current) setHistory({ job: data.job || job, data }); })}>View snapshots: {job.label}</Button><Button variant="outline" disabled={locked || !job.enabled} onClick={() => void perform(async () => { const receipt = await monitoringRequest<Record<string, unknown>>(`/v1/jobs/${job.id}/check`, "POST"); setNotice(`Check receipt: ${String(receipt.coverage_state || receipt.state || "unknown")}${receipt.error ? `. ${String(receipt.error)}` : ""}.`); })}>Check source now</Button><Button variant="outline" disabled={locked} onClick={() => void perform(async () => { await monitoringRequest(`/v1/jobs/${job.id}`, "PATCH", { enabled: !job.enabled }); setNotice(job.enabled ? "Monitor paused; its evidence history is retained." : "Monitor resumed after server access checks."); })}>{job.enabled ? "Pause" : "Resume"}</Button></div>
    </article>)}</div>
    {history && <HistoryView key={history.job.id} job={history.job} history={history.data} />}
  </section>;
}
