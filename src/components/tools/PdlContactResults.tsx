import { pdlContacts, pdlPersonRecords } from "@/lib/pdlContacts";

export function PdlContactResults({data}: {data: Record<string, unknown>}) {
  return <div className="space-y-3">{pdlPersonRecords(data).map((person, index) => {
    const contact = pdlContacts(person);
    const redacted = Object.keys(contact.flags).length > 0;
    return <section key={String(person.id || index)} className="border border-border rounded p-3 space-y-3" aria-label="PDL contact details">
      <h3 className="font-semibold text-sm">{typeof person.full_name === "string" ? person.full_name : `Record ${index + 1}`}</h3>
      {redacted && <p role="status" className="text-xs text-amber-400">PDL withheld field values. This response contains preview/redaction flags; full contacts require the corresponding access on the backend PDL API key.</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {([['Emails', contact.emails], ['Phone numbers', contact.phones], ['Street addresses', contact.addresses]] as const).map(([label, values]) => <div key={label} className="min-w-0">
          <h4 className="text-xs font-semibold mb-1">{label}</h4>
          {values.length ? <ul className="text-xs space-y-1">{values.map(value => <li key={value} className="break-words">{value}</li>)}</ul> : <p className="text-xs text-muted-foreground">No actual values supplied by PDL.</p>}
        </div>)}
      </div>
      {typeof person.location_name === "string" && <p className="text-xs text-muted-foreground">Reported location: {person.location_name}</p>}
      <p className="text-[10px] text-muted-foreground">Source: People Data Labs. Search candidates can share a name; verify identity and currentness before relying on a contact.</p>
    </section>;
  })}</div>;
}
