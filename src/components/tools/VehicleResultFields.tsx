import { asRecord } from '@/lib/personDossier';
const fields = ['Make','Model','ModelYear','BodyClass','VehicleType','FuelTypePrimary','EngineCylinders','vin','make','model','year','plate','state','country','description','body_style','fuel_type','color'];
export function VehicleResultFields({ details }: { details: Record<string, unknown> }) {
  const vehicle = asRecord(details.vehicle);
  const values = Object.entries(vehicle).filter(([key, value]) => fields.includes(key) && typeof value === 'string' && value);
  if (!values.length) return null;
  return <div className="space-y-3">
    {typeof details.coverage === 'string' && <p className="text-sm text-muted-foreground">{details.coverage}</p>}
    {typeof details.provider === 'string' && <p className="text-xs text-muted-foreground">{details.provider}{typeof details.retrieved_at === 'string' ? ` · Retrieved ${details.retrieved_at}` : ''}</p>}
    <dl className="grid sm:grid-cols-2 gap-3 text-sm">{values.map(([key,value])=><div key={key} className="rounded border border-border p-3 min-w-0"><dt className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g,' $1').replace(/_/g,' ').trim()}</dt><dd className="font-medium mt-1 break-words">{String(value)}</dd></div>)}</dl>
  </div>;
}
