type ObjectData=Record<string,unknown>;
const object=(v:unknown):ObjectData=>v&&typeof v==='object'&&!Array.isArray(v)?v as ObjectData:{};
const date=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?new Date(v*1000).toLocaleString():'Pending';

export function SchedulerEvidence({value}:{value:unknown}){
 const scheduler=object(value),tick=object(scheduler.last_tick);
 return <div role="status" className="space-y-1 text-sm"><p>Monitoring runtime connected. Scheduled checks continue when this page is closed.</p><p>Last scheduler completion: {date(tick.completed_at)} · Checks: {String(tick.checked??0)} · Failures: {String(tick.failed??0)} · Next scheduled check: {date(scheduler.next_alarm_at)}</p><details className="text-xs"><summary>Scheduler receipt</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(scheduler,null,2)}</pre></details></div>;
}

export function MonitorHistory({value}:{value:unknown}){
 const result=object(value),rows=Array.isArray(result.history)?result.history:[];
 return <div className="mt-4 space-y-3"><h3 className="font-semibold">Source check history</h3>{rows.length===0&&<p>No source checks recorded.</p>}{rows.map((value,i)=>{const row=object(value),snapshot=object(row.snapshot),data=object(snapshot.data),correlations=Array.isArray(data.correlations)?data.correlations:[];
 return <div key={String(row.id??i)} className="border border-border rounded p-3 space-y-1 text-sm"><p><strong>{String(row.state??'Unknown state')}</strong> · {date(row.observed_at)}</p>{typeof row.source==='string'&&<p className="break-all">Source: {row.source}</p>}{typeof row.error==='string'&&<p className="text-destructive">{row.error}</p>}{typeof data.message_count==='number'&&<p>Public messages observed: {data.message_count}</p>}{correlations.map((value,k)=>{const c=object(value),epss=object(c.epss);return <p key={k}>{String(c.cve_id)} · EPSS {String(epss.epss??'unknown')} ({String(epss.date??'source date unavailable')}) · CISA known exploited: {c.is_in_cisa_kev===true?'Yes':c.is_in_cisa_kev===false?'No':'Unknown'}</p>;})}<details><summary>Source evidence</summary><pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap break-all">{JSON.stringify(row,null,2)}</pre></details></div>;})}</div>;
}
