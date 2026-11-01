import { asRecord, sourceUrl } from '@/lib/personDossier';

const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) : 'Not supplied';
export function PublicRecordResults({ details }: { details: Record<string, unknown> }) {
  if (!Array.isArray(details.results)) return null;
  return <div className="space-y-4">
    {typeof details.coverage === 'string' && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{details.coverage}</p>}
    <p className="text-xs text-muted-foreground break-words">{text(details.provider)} · Retrieved {text(details.retrieved_at)}</p>
    {!details.results.length && <p role="status" className="rounded border border-border p-4 text-sm">No matching records were returned by this source for this query. Try another name variation, record type or jurisdiction. This is not proof of a clean history or absence of assets.</p>}
    {details.results.map((value, index) => {
      const item = asRecord(value); const url = sourceUrl(item.source_url);
      const property = item.kind === 'property';
      const fields = property ? [['Recorded owner', text(item.owner) || 'Not supplied'], ['Additional owner', text(item.additional_owner)], ['Property ID', text(item.property_id)], ['County', text(item.county)], ['Assessed value', money(item.assessed_value)], ['Market value reported by source', typeof item.market_value === 'number' ? money(item.market_value) : ''], ['Source updated', text(item.source_updated_at)], ['Recorded deed date', text(item.deed_date)]] : [['Court', text(item.court)], ['Docket number', text(item.docketNumber)], ['Filed', text(item.dateFiled)], ['Terminated', text(item.dateTerminated)], ['Judge', text(item.judge)], ['Disposition', text(item.disposition) || 'Not supplied by this search']];
      return <article key={`${url}:${index}`} className="rounded-lg border border-border bg-background/30 p-4 space-y-3 min-w-0">
        <p className="text-xs uppercase tracking-widest text-primary">{text(item.kind).replace(/_/g, ' ')} · identity unverified</p>
        <h4 className="font-semibold break-words">{text(item.title)}</h4>
        <dl className="grid sm:grid-cols-2 gap-3 text-sm">{fields.filter(([, value]) => value).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words mt-1">{value}</dd></div>)}</dl>
        {text(item.legal_description) && <p className="text-xs break-words">{text(item.legal_description)}</p>}
        {text(item.snippet) && <p className="text-sm whitespace-pre-wrap break-words">{text(item.snippet)}</p>}
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block text-primary text-sm underline break-words">Open original {property ? 'county parcel' : 'court'} record</a>}
      </article>;
    })}
    {details.has_more === true && <p className="text-sm text-muted-foreground">More records are available. {details.provider === 'CourtListener public search' ? 'Use Next court results below to continue this search.' : 'Increase the result page above and execute again to retrieve the next 25 properties.'}</p>}
  </div>;
}
