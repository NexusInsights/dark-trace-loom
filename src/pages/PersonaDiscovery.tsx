import { useState, useEffect } from "react";
import { PublicProfileEvidence } from "@/components/persona/PublicProfileEvidence";
import { identifierSource } from "@/lib/profileLookup";
import { usePersonas, usePersonaIdentifiers, usePersonaDiscovery, useDeletePersona } from "@/hooks/usePersonas";
import { PersonaInput } from "@/lib/personaDiscoveryEngine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { UserSearch, Plus, Trash2, ChevronRight, Loader2, Fingerprint } from "lucide-react";

export default function PersonaDiscovery() {
  const { data: personas, isLoading } = usePersonas();
  const { mutate: discover, isPending, progress } = usePersonaDiscovery();
  const deleteMut = useDeletePersona();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: identifiers } = usePersonaIdentifiers(selectedId);

  const [form, setForm] = useState<PersonaInput>({ name: "", username: "", profileUrl: "", email: "", domain: "", phone: "" });
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId || !identifiers) return;
    const saved: PersonaInput = {name:"",username:"",profileUrl:"",email:"",domain:"",phone:""};
    for (const identifier of identifiers) {
      const field = identifier.identifier_type === "social_profile" ? "profileUrl" : identifier.identifier_type;
      if (identifier.source === "input" && ["name","username","profileUrl","email","domain","phone"].includes(field)) {
        saved[field as "name" | "username" | "profileUrl" | "email" | "domain" | "phone"] = identifier.identifier_value;
      }
    }
    if (saved.profileUrl) saved.username = "";
    setForm(saved);
  }, [selectedId,identifiers]);

  const handleRun = (existingPersonaId?: string) => {
    setDiscoveryError(null);
    const hasInput = Object.values(form).some((v) => typeof v === "string" && v.trim());
    if (!hasInput) { toast.error("Provide at least one identifier"); return; }
    discover({ ...form, enrich: false, personaId: existingPersonaId }, {
      onSuccess: (res) => {
        (res.lookup?.checks.some(c => c.status === "unavailable") ? toast.warning : toast.success)(res.lookup ? `${res.lookup.profiles.length} actual account records retrieved; ${res.lookup.checks.filter(c => c.status === "unavailable").length} providers unavailable` : "Inputs saved. No identity or contact ownership has been verified.");
        setSelectedId(res.personaId);
        setForm({ name: "", username: "", profileUrl: "", email: "", domain: "", phone: "" });
      },
      onError: (e) => { setDiscoveryError(e.message); toast.error(e.message); },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Fingerprint className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Account discovery and evidence</h1>
          <p className="text-sm text-muted-foreground">Start with a known public profile or exact handle, retrieve source records, then review the evidence connecting each account to the person.</p>
        </div>
      </div>

      <ol aria-label="Discovery workflow" className="grid gap-3 md:grid-cols-3 text-sm">
        <li className="border rounded p-3">1. Supply a known starting profile or exact username.</li>
        <li className="border rounded p-3">2. Inspect observed accounts, explicit account links and failed source checks.</li>
        <li className="border rounded p-3">3. Support or reject each association with a source and explanation.</li>
      </ol>
      <p className="text-sm text-muted-foreground">A name alone saves a lead; it does not discover accounts. Matching names or handles do not prove identity. This workflow does not generate username or email guesses.</p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Form */}
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><UserSearch className="h-4 w-4" /> Discovery Input</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {([
              { key: "name", label: "Full Name", ph: "John Doe" },
              { key: "profileUrl", label: "Known public profile URL", ph: "https://github.com/octocat" },
              { key: "username", label: "Or exact username", ph: "octocat" },
              { key: "email", label: "Email", ph: "john@example.com" },
              { key: "domain", label: "Domain", ph: "example.com" },
              { key: "phone", label: "Phone", ph: "+1234567890" },
            ] as const).map(({ key, label, ph }) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`discovery-${key}`} className="text-xs text-muted-foreground">{label}</Label>
                <Input id={`discovery-${key}`} placeholder={ph} value={form[key] || ""} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value, ...(key === "username" ? { profileUrl: "" } : key === "profileUrl" ? { username: "" } : {}) }))} className="h-8 text-sm" />
              </div>
            ))}
            <Button onClick={() => handleRun()} disabled={isPending} className="w-full mt-2" size="sm">
              {isPending ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Discovering...</> : <><Plus className="h-3.5 w-3.5 mr-2" /> {form.username || form.profileUrl ? "Search public accounts" : "Save supplied leads"}</>}
            </Button>
            {selectedId && <Button size="sm" variant="secondary" className="w-full" disabled={isPending} onClick={() => handleRun(selectedId)}>Retrieve evidence for selected persona</Button>}
            {progress && <p className="text-xs text-muted-foreground animate-pulse">{progress}</p>}
            {discoveryError && <p role="alert" className="text-xs text-destructive break-words">{discoveryError}</p>}
            <p className="text-xs text-muted-foreground">Live username coverage: GitHub, GitLab, DEV Community, Hacker News and Keybase. Email, phone and name inputs are saved as supplied; this lookup does not invent owners or contact details. Use the configured People Data Labs tools for provider enrichment.</p>
          </CardContent>
        </Card>

        {/* Persona List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Personas ({personas?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[360px]">
              {isLoading ? (
                <p className="text-sm text-muted-foreground p-4">Loading...</p>
              ) : !personas?.length ? (
                <p className="text-sm text-muted-foreground p-4">No research records saved yet</p>
              ) : (
                personas.map((p) => (
                  <button key={p.id} onClick={() => { setSelectedId(p.id); setDiscoveryError(null); }}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-accent/50 transition-colors border-b border-border/50 ${selectedId === p.id ? "bg-accent" : ""}`}>
                    <div>
                      <span className="text-sm font-medium">{p.persona_label}</span>
                      <span className="text-xs text-muted-foreground block">{new Date(p.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(p.id); if (selectedId === p.id) setSelectedId(null); }}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </button>
                ))
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Supplied leads and historical observations</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">These are leads, not confirmed person associations. Review source-backed accounts below.</p>
            {!selectedId ? <p>Select a research record.</p> : !identifiers?.length ? <p>No saved leads.</p> : identifiers.map(identifier => <div key={identifier.id} className="border-b pb-2 text-sm"><p className="break-all">{identifier.identifier_value}</p><p className="text-xs text-muted-foreground">{identifierSource(identifier.source)}</p></div>)}
          </CardContent>
        </Card>
      </div>
      <PublicProfileEvidence personaId={selectedId} />
      <p className="text-sm text-muted-foreground">After reviewing account associations, <a href="/identity" className="text-primary underline">open Identity Review</a> and refresh reviewed associations to update graphs and reports. Unsupported and rejected accounts remain excluded.</p>
    </div>
  );
}
