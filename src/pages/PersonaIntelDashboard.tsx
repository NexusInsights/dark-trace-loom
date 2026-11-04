import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePersonas } from "@/hooks/usePersonas";
import { useIdentityEntities } from "@/hooks/useIdentityResolution";
import { associationEvidence } from "@/lib/reviewedIdentityGroups";
import { isResolvedIdentityEntity } from "@/lib/identityEvidence";
import { GlassPanel, StatDisplay } from "@/components/intel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Link2, FileCheck2, ExternalLink } from "lucide-react";

export default function PersonaIntelDashboard() {
  const navigate = useNavigate();
  const people = usePersonas(), accounts = useIdentityEntities();
  const groups = useMemo(() => (people.data ?? []).map(person => ({
    person,
    accounts: (accounts.data ?? []).filter(isResolvedIdentityEntity).filter(account => associationEvidence(account).persona_id === person.id),
  })), [people.data, accounts.data]);
  if (people.isLoading || accounts.isLoading) return <p role="status" className="p-6">Loading source-bound account associations...</p>;
  if (people.error || accounts.error) return <p role="alert" className="p-6 text-destructive">Account evidence could not be verified: {(people.error || accounts.error)?.message}</p>;
  const associatedCount = groups.reduce((total, group) => total + group.accounts.length, 0);
  return <main className="max-w-6xl mx-auto space-y-6 p-4 md:p-6">
    <header className="space-y-3">
      <h1 className="text-2xl font-semibold">Persona evidence overview</h1>
      <p className="text-sm text-muted-foreground">Saved leads and public account associations supported by an analyst's source review. These are reviewed claims, not independently verified identities or risk assessments.</p>
      <div className="flex flex-wrap gap-2"><Button onClick={() => navigate("/personas")}>Find and review public accounts</Button><Button variant="outline" onClick={() => navigate("/identity")}>Update reviewed associations</Button></div>
    </header>
    <div className="grid gap-3 sm:grid-cols-3">
      <GlassPanel className="p-4"><StatDisplay label="SAVED LEADS" value={groups.length} icon={Users} /></GlassPanel>
      <GlassPanel className="p-4"><StatDisplay label="SUPPORTED ACCOUNT ASSOCIATIONS" value={associatedCount} icon={Link2} /></GlassPanel>
      <GlassPanel className="p-4"><StatDisplay label="DOSSIERS WITH SUPPORT" value={groups.filter(group => group.accounts.length > 0).length} icon={FileCheck2} /></GlassPanel>
    </div>
    <GlassPanel className="p-4 space-y-2">
      <h2 className="font-semibold">What counts as evidence</h2>
      <p className="text-sm text-muted-foreground">An account must have a retrieved source record, a stable platform ID, and a current review citing why it belongs in this dossier. Rejected, conflicting, generated and unreviewed matches stay out of these associations.</p>
      <p className="text-sm text-muted-foreground">Shared names, usernames, employers, email domains, IP addresses, case membership and similar activity hours are insufficient. One source reused across several accounts is still one source.</p>
    </GlassPanel>
    {!groups.length && <p className="text-muted-foreground">No saved leads. Start with a known public profile or exact username in Persona Discovery.</p>}
    {groups.map(({ person, accounts: associated }) => <section key={person.id} className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{person.persona_label}</h2><p className="text-xs text-muted-foreground">Saved lead · {associated.length} supported account association{associated.length === 1 ? "" : "s"}</p></div><Button variant="outline" size="sm" onClick={() => navigate(`/persona-profile?id=${encodeURIComponent(person.id)}`)}>Review dossier</Button></div>
      {!associated.length && <p className="text-sm text-muted-foreground">No current source-bound association has been admitted. Retrieve public records, review their sources, then update reviewed associations.</p>}
      <div className="grid gap-3 md:grid-cols-2">{associated.map(account => {
        const evidence = associationEvidence(account);
        return <article key={account.id} className="rounded border border-border p-3 space-y-2 min-w-0">
          <Badge variant="outline">Analyst-supported association</Badge>
          <a href={String(evidence.profile_url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 break-all text-primary"><ExternalLink className="h-3 w-3 shrink-0" />{String(evidence.profile_url)}</a>
          <p className="text-xs break-all">Stable account: {String(evidence.account_id)}</p>
          <p className="text-xs text-muted-foreground">Observed {new Date(String(evidence.retrieved_at)).toLocaleString()} · Reviewed {new Date(String(evidence.reviewed_at)).toLocaleString()}</p>
          <div className="flex flex-wrap gap-3 text-xs"><a className="text-primary underline" href={String(evidence.source_url)} target="_blank" rel="noopener noreferrer">Retrieved source record</a><a className="text-primary underline" href={String(evidence.supporting_source_url)} target="_blank" rel="noopener noreferrer">Association support cited by analyst</a></div>
          <p className="text-xs text-muted-foreground">Review {String(evidence.review_id)}. Supporting claims and contradicting evidence still require human assessment.</p>
        </article>;
      })}</div>
    </section>)}
  </main>;
}
