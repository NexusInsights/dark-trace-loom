import { useState } from "react";
import { usePersonas, usePersonaIdentifiers, usePersonaDiscovery, useDeletePersona } from "@/hooks/usePersonas";
import { useUsernameCandidates, useRunUsernamePermutation } from "@/hooks/useUsernameCandidates";
import { useEmailCandidates, useRunEmailPermutation } from "@/hooks/useEmailCandidates";
import { PersonaInput } from "@/lib/personaDiscoveryEngine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  UserSearch, Plus, Trash2, Eye, Mail, Globe, Phone,
  User, AtSign, Link2, ChevronRight, Loader2, Fingerprint, Shuffle
} from "lucide-react";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  username: <AtSign className="h-3.5 w-3.5" />, email: <Mail className="h-3.5 w-3.5" />,
  domain: <Globe className="h-3.5 w-3.5" />, phone: <Phone className="h-3.5 w-3.5" />,
  social_profile: <Link2 className="h-3.5 w-3.5" />, name: <User className="h-3.5 w-3.5" />,
};

function confidenceColor(score: number) {
  if (score >= 0.8) return "text-green-400";
  if (score >= 0.5) return "text-yellow-400";
  return "text-muted-foreground";
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const acc: Record<string, T[]> = {};
  for (const item of items) {
    const k = keyFn(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
  }
  return acc;
}

export default function PersonaDiscovery() {
  const { data: personas, isLoading } = usePersonas();
  const { mutate: discover, isPending, progress } = usePersonaDiscovery();
  const deleteMut = useDeletePersona();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: identifiers } = usePersonaIdentifiers(selectedId);
  const { data: usernameCandidates } = useUsernameCandidates(selectedId);
  const { data: emailCandidates } = useEmailCandidates(selectedId);
  const { mutate: runPermutation, isPending: permPending, progress: permProgress } = useRunUsernamePermutation();
  const { mutate: runEmailPerm, isPending: emailPending, progress: emailProgress } = useRunEmailPermutation();

  const [form, setForm] = useState<PersonaInput>({ name: "", username: "", email: "", domain: "", phone: "" });
  const [permForm, setPermForm] = useState({ firstName: "", lastName: "", knownUsername: "" });
  const [emailForm, setEmailForm] = useState({ firstName: "", lastName: "", knownDomains: "", companyDomains: "" });

  const handleRun = () => {
    const hasInput = Object.values(form).some((v) => v && v.trim());
    if (!hasInput) { toast.error("Provide at least one identifier"); return; }
    discover(form, {
      onSuccess: (res) => {
        toast.success(`Persona created with ${res.identifiersGenerated} identifiers`);
        setSelectedId(res.personaId);
        setForm({ name: "", username: "", email: "", domain: "", phone: "" });
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const handlePermutation = () => {
    if (!selectedId) { toast.error("Select a persona first"); return; }
    const hasInput = Object.values(permForm).some((v) => v.trim());
    if (!hasInput) { toast.error("Provide at least one input"); return; }
    runPermutation({ personaId: selectedId, ...permForm }, {
      onSuccess: (res) => toast.success(`Generated ${res.candidatesGenerated} username candidates`),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleEmailPerm = () => {
    if (!selectedId) { toast.error("Select a persona first"); return; }
    if (!emailForm.firstName.trim() && !emailForm.lastName.trim()) { toast.error("Provide a name"); return; }
    const knownDomains = emailForm.knownDomains.split(/[,\s]+/).filter(Boolean);
    const companyDomains = emailForm.companyDomains.split(/[,\s]+/).filter(Boolean);
    runEmailPerm({ personaId: selectedId, firstName: emailForm.firstName, lastName: emailForm.lastName, knownDomains, companyDomains }, {
      onSuccess: (res) => toast.success(`Generated ${res.candidatesGenerated} email candidates`),
      onError: (e) => toast.error(e.message),
    });
  };

  const grouped = groupBy(identifiers ?? [], (i) => i.identifier_type);
  const methodGroups = groupBy(usernameCandidates ?? [], (c) => c.generation_method);
  const emailMethodGroups = groupBy(emailCandidates ?? [], (c) => c.generation_method);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Fingerprint className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Persona Discovery</h1>
          <p className="text-sm text-muted-foreground">Generate possible online identities belonging to the same individual</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Form */}
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><UserSearch className="h-4 w-4" /> Discovery Input</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {([
              { key: "name", label: "Full Name", ph: "John Doe" },
              { key: "username", label: "Username", ph: "johndoe" },
              { key: "email", label: "Email", ph: "john@example.com" },
              { key: "domain", label: "Domain", ph: "example.com" },
              { key: "phone", label: "Phone", ph: "+1234567890" },
            ] as const).map(({ key, label, ph }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <Input placeholder={ph} value={form[key] || ""} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className="h-8 text-sm" />
              </div>
            ))}
            <Button onClick={handleRun} disabled={isPending} className="w-full mt-2" size="sm">
              {isPending ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Discovering...</> : <><Plus className="h-3.5 w-3.5 mr-2" /> Run Discovery</>}
            </Button>
            {progress && <p className="text-xs text-muted-foreground animate-pulse">{progress}</p>}
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
                <p className="text-sm text-muted-foreground p-4">No personas discovered yet</p>
              ) : (
                personas.map((p) => (
                  <button key={p.id} onClick={() => setSelectedId(p.id)}
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

        {/* Results with tabs */}
        <Card>
          <Tabs defaultValue="identifiers">
            <CardHeader className="pb-2">
              <TabsList className="w-full">
                <TabsTrigger value="identifiers" className="flex-1 text-xs"><Eye className="h-3 w-3 mr-1" /> Identifiers</TabsTrigger>
                <TabsTrigger value="usernames" className="flex-1 text-xs"><Shuffle className="h-3 w-3 mr-1" /> Usernames</TabsTrigger>
                <TabsTrigger value="emails" className="flex-1 text-xs"><Mail className="h-3 w-3 mr-1" /> Emails</TabsTrigger>
              </TabsList>
            </CardHeader>

            {/* Identifiers Tab */}
            <TabsContent value="identifiers" className="m-0">
              <CardContent className="p-0">
                <ScrollArea className="h-[340px]">
                  {!selectedId ? (
                    <p className="text-sm text-muted-foreground p-4">Select a persona to view identifiers</p>
                  ) : !identifiers?.length ? (
                    <p className="text-sm text-muted-foreground p-4">No identifiers found</p>
                  ) : (
                    Object.entries(grouped).map(([type, items]) => (
                      <div key={type}>
                        <div className="px-4 py-1.5 bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          {TYPE_ICONS[type] ?? <Link2 className="h-3.5 w-3.5" />} {type.replace(/_/g, " ")} ({items.length})
                        </div>
                        {items.map((id) => (
                          <div key={id.id} className="px-4 py-1.5 flex items-center justify-between border-b border-border/30 text-sm">
                            <span className="truncate max-w-[200px] font-mono text-xs">{id.identifier_value}</span>
                            <div className="flex items-center gap-2">
                              <Progress value={id.confidence_score * 100} className="w-12 h-1.5" />
                              <span className={`text-[10px] font-bold ${confidenceColor(id.confidence_score)}`}>{Math.round(id.confidence_score * 100)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </ScrollArea>
              </CardContent>
            </TabsContent>

            {/* Usernames Tab */}
            <TabsContent value="usernames" className="m-0">
              <CardContent className="space-y-3 pb-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">First Name</Label>
                    <Input placeholder="John" value={permForm.firstName} onChange={(e) => setPermForm((f) => ({ ...f, firstName: e.target.value }))} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Last Name</Label>
                    <Input placeholder="Doe" value={permForm.lastName} onChange={(e) => setPermForm((f) => ({ ...f, lastName: e.target.value }))} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Known Handle</Label>
                    <Input placeholder="jdoe" value={permForm.knownUsername} onChange={(e) => setPermForm((f) => ({ ...f, knownUsername: e.target.value }))} className="h-7 text-xs" />
                  </div>
                </div>
                <Button onClick={handlePermutation} disabled={permPending || !selectedId} size="sm" variant="secondary" className="w-full">
                  {permPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Generating...</> : <><Shuffle className="h-3 w-3 mr-1" /> Generate Usernames</>}
                </Button>
                {permProgress && <p className="text-[10px] text-muted-foreground animate-pulse">{permProgress}</p>}
              </CardContent>
              <ScrollArea className="h-[230px]">
                {!usernameCandidates?.length ? (
                  <p className="text-sm text-muted-foreground p-4">{selectedId ? "No candidates yet" : "Select a persona first"}</p>
                ) : (
                  Object.entries(methodGroups).map(([method, items]) => (
                    <div key={method}>
                      <div className="px-4 py-1 bg-muted/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{method.replace(/_/g, " ")} ({items.length})</div>
                      {items.map((c) => (
                        <div key={c.id} className="px-4 py-1 flex items-center justify-between border-b border-border/30">
                          <span className="font-mono text-xs">{c.candidate_username}</span>
                          <span className={`text-[10px] font-bold ${confidenceColor(c.confidence_score)}`}>{Math.round(c.confidence_score * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </ScrollArea>
            </TabsContent>

            {/* Emails Tab */}
            <TabsContent value="emails" className="m-0">
              <CardContent className="space-y-3 pb-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">First Name</Label>
                    <Input placeholder="John" value={emailForm.firstName} onChange={(e) => setEmailForm((f) => ({ ...f, firstName: e.target.value }))} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Last Name</Label>
                    <Input placeholder="Doe" value={emailForm.lastName} onChange={(e) => setEmailForm((f) => ({ ...f, lastName: e.target.value }))} className="h-7 text-xs" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Known Domains (comma-separated)</Label>
                  <Input placeholder="example.com, test.org" value={emailForm.knownDomains} onChange={(e) => setEmailForm((f) => ({ ...f, knownDomains: e.target.value }))} className="h-7 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Company Domains (comma-separated)</Label>
                  <Input placeholder="acme.com, corp.io" value={emailForm.companyDomains} onChange={(e) => setEmailForm((f) => ({ ...f, companyDomains: e.target.value }))} className="h-7 text-xs" />
                </div>
                <Button onClick={handleEmailPerm} disabled={emailPending || !selectedId} size="sm" variant="secondary" className="w-full">
                  {emailPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Generating...</> : <><Mail className="h-3 w-3 mr-1" /> Generate Emails</>}
                </Button>
                {emailProgress && <p className="text-[10px] text-muted-foreground animate-pulse">{emailProgress}</p>}
              </CardContent>
              <ScrollArea className="h-[200px]">
                {!emailCandidates?.length ? (
                  <p className="text-sm text-muted-foreground p-4">{selectedId ? "No candidates yet" : "Select a persona first"}</p>
                ) : (
                  Object.entries(emailMethodGroups).map(([method, items]) => (
                    <div key={method}>
                      <div className="px-4 py-1 bg-muted/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{method.replace(/_/g, " ")} ({items.length})</div>
                      {items.map((c) => (
                        <div key={c.id} className="px-4 py-1 flex items-center justify-between border-b border-border/30">
                          <span className="font-mono text-xs truncate max-w-[180px]">{c.candidate_email}</span>
                          <span className={`text-[10px] font-bold ${confidenceColor(c.confidence_score)}`}>{Math.round(c.confidence_score * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
