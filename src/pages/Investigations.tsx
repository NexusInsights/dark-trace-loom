import { useState } from "react";
import { GlassPanel, IntelCard, InvestigationTimeline, AnalysisPanel } from "@/components/intel";
import { CaseCollaborators } from "@/components/collaboration/CaseCollaborators";
import { CaseAnalysis } from "@/components/analysis/CaseAnalysis";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCases, useCreateCase,
  useSubjects, useCreateSubject,
  useArtifacts, useCreateArtifact,
  useEvents, useCreateEvent,
} from "@/hooks/useInvestigationData";
import { useCrossCaseLinks, useCrossCaseStats } from "@/hooks/useCrossCaseLinks";
import { useSuggestions } from "@/hooks/useSuggestions";
import { runCrossCaseDiscovery } from "@/lib/crossCaseEngine";
import { generateSuggestions } from "@/lib/recommendationEngine";
import { ArtifactUploader } from "@/components/tools/ArtifactUploader";
import { RelationshipGraph } from "@/components/tools/RelationshipGraph";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Plus, FolderOpen, Users, FileText, Clock,
  ChevronRight, Loader2, X, Send, Upload, Download, FileImage, File,
  Shield, LayoutTemplate, AlertTriangle, Link2, Lightbulb, Sparkles, Check, XCircle,
} from "lucide-react";

// ─── Inline form component ───
function QuickForm({
  fields,
  onSubmit,
  submitting,
}: {
  fields: { key: string; label: string; type?: string; required?: boolean }[];
  onSubmit: (values: Record<string, string>) => void;
  submitting: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
    setValues({});
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-muted-foreground">{f.label}</label>
          {f.type === "textarea" ? (
            <textarea
              required={f.required}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="w-full bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              rows={2}
            />
          ) : (
            <input
              type={f.type ?? "text"}
              required={f.required}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="w-full bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}
        </div>
      ))}
      <Button type="submit" variant="neon" size="sm" className="w-full" disabled={submitting}>
        {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="h-3 w-3 mr-1.5" />SUBMIT</>}
      </Button>
    </form>
  );
}

// ─── Evidence Log Viewer ───
function EvidenceLogViewer({ artifactId }: { artifactId: string }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["evidence_logs", artifactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("evidence_logs")
        .select("*")
        .eq("artifact_id", artifactId)
        .order("timestamp", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="border-t border-border/50 pt-3 mt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Shield className="h-3 w-3 text-primary/70" />
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground">INTEGRITY LOG</span>
      </div>
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mx-auto" />
      ) : logs.length === 0 ? (
        <p className="text-[10px] text-muted-foreground font-mono">No log entries</p>
      ) : (
        <div className="space-y-1.5 max-h-[200px] overflow-auto">
          {logs.map((log: any) => (
            <div key={log.id} className="bg-background/40 border border-border/30 rounded px-2.5 py-1.5">
              <div className="flex items-center justify-between">
                <span className={`font-mono text-[10px] font-medium ${
                  log.action === "created" ? "text-primary" : "text-warning"
                }`}>
                  {log.action.toUpperCase()}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="font-mono text-[9px] text-muted-foreground/70 mt-0.5 truncate" title={log.hash}>
                SHA: {log.hash}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Template-aware case creation ───
function NewCaseWithTemplates({
  onSubmit,
  submitting,
}: {
  onSubmit: (v: { title: string; description: string }) => void;
  submitting: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ["investigation-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("investigation_templates")
        .select("*")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const applyTemplate = (tpl: any) => {
    setSelectedTemplate(tpl.id);
    setValues((v) => ({
      ...v,
      title: tpl.name,
      description: tpl.description ?? "",
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ title: values.title ?? "", description: values.description ?? "" });
    setValues({});
    setSelectedTemplate(null);
  };

  const CATEGORY_COLORS: Record<string, string> = {
    people: "intel-tag-blue",
    financial: "intel-tag-amber",
    cyber: "intel-tag-red",
    corporate: "intel-tag-green",
    security: "intel-tag-red",
    general: "intel-tag-muted",
  };

  return (
    <div className="p-3 border-b border-border space-y-3">
      {/* Templates */}
      {templates.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <LayoutTemplate className="h-3 w-3 text-primary" />
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">TEMPLATES</span>
          </div>
          <div className="space-y-1 max-h-[160px] overflow-auto">
            {templates.map((tpl: any) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl)}
                className={`w-full text-left px-2.5 py-2 rounded text-[11px] border transition-colors ${
                  selectedTemplate === tpl.id
                    ? "border-primary bg-primary/10"
                    : "border-border/30 hover:bg-secondary/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{tpl.name}</span>
                  <span className={`intel-tag ${CATEGORY_COLORS[tpl.category] ?? "intel-tag-muted"} text-[8px]`}>
                    {tpl.category?.toUpperCase()}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{tpl.description}</p>
                {tpl.tool_sequence?.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {tpl.tool_sequence.map((t: string) => (
                      <span key={t} className="font-mono text-[8px] text-muted-foreground/70 bg-background/60 px-1 py-0.5 rounded">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-muted-foreground">TITLE</label>
          <input
            required
            value={values.title ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
            className="w-full bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-muted-foreground">DESCRIPTION</label>
          <textarea
            value={values.description ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            className="w-full bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            rows={2}
          />
        </div>
        <Button type="submit" variant="neon" size="sm" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="h-3 w-3 mr-1.5" />CREATE CASE</>}
        </Button>
      </form>
    </div>
  );
}

// ─── Main workspace ───
export default function InvestigationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [showNewCase, setShowNewCase] = useState(false);
  const [addPanel, setAddPanel] = useState<"subject" | "artifact" | "event" | "upload" | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Queries
  const { data: cases = [], isLoading: casesLoading } = useCases();
  const selectedCase = cases.find((c) => c.id === selectedCaseId);
  const { data: subjects = [] } = useSubjects(selectedCaseId);
  const { data: artifacts = [] } = useArtifacts(selectedCaseId);
  const { data: events = [] } = useEvents(selectedCaseId);
  const { data: crossCaseLinks = [] } = useCrossCaseLinks(selectedCaseId);
  const { data: crossCaseStats } = useCrossCaseStats();
  const { data: suggestions = [] } = useSuggestions(selectedCaseId);

  // Mutations
  const createCase = useCreateCase();
  const createSubject = useCreateSubject();
  const createArtifact = useCreateArtifact();
  const createEvent = useCreateEvent();

  const selectedArtifact = artifacts.find((a) => a.id === selectedArtifactId);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);

  const handleCrossCaseScan = async () => {
    if (!user) return;
    setScanning(true);
    try {
      const result = await runCrossCaseDiscovery(user.id);
      qc.invalidateQueries({ queryKey: ["cross_case_links"] });
      qc.invalidateQueries({ queryKey: ["cross_case_stats"] });
      toast.success(`Found ${result.linksFound} cross-case links across ${result.casesScanned} cases`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cross-case scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleAcknowledgeLink = async (linkId: string) => {
    await supabase.from("cross_case_links").update({ acknowledged: true } as any).eq("id", linkId);
    qc.invalidateQueries({ queryKey: ["cross_case_links"] });
    qc.invalidateQueries({ queryKey: ["cross_case_stats"] });
  };

  const handleGenerateSuggestions = async () => {
    if (!user || !selectedCaseId) return;
    setGeneratingSuggestions(true);
    try {
      const count = await generateSuggestions(user.id, selectedCaseId);
      qc.invalidateQueries({ queryKey: ["investigation_suggestions"] });
      toast.success(`Generated ${count} tool recommendations`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate suggestions");
    } finally {
      setGeneratingSuggestions(false);
    }
  };

  const handleDismissSuggestion = async (id: string) => {
    await supabase.from("investigation_suggestions").update({ dismissed: true } as any).eq("id", id);
    qc.invalidateQueries({ queryKey: ["investigation_suggestions"] });
  };

  const timelineEvents = events.map((e) => ({
    id: e.id,
    time: e.timestamp ? new Date(e.timestamp).toLocaleString() : "—",
    title: e.event_type ?? "Event",
    description: e.description ?? undefined,
    type: "info" as const,
  }));

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden animate-fade-in">
      {/* ══════ LEFT SIDEBAR ══════ */}
      <div className="w-72 shrink-0 border-r border-border bg-card/50 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">CASES</span>
            {crossCaseStats && crossCaseStats.total > 0 && (
              <span className="flex items-center gap-1 font-mono text-[9px] text-destructive">
                <AlertTriangle className="h-3 w-3" />{crossCaseStats.total}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCrossCaseScan}
              disabled={scanning}
              className="p-1 rounded hover:bg-secondary transition-colors"
              title="Scan for cross-case links"
            >
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <Link2 className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            <button
              onClick={() => setShowNewCase(!showNewCase)}
              className="p-1 rounded hover:bg-secondary transition-colors"
            >
              {showNewCase ? <X className="h-3.5 w-3.5 text-muted-foreground" /> : <Plus className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          </div>
        </div>

        {showNewCase && (
          <NewCaseWithTemplates
            onSubmit={(v) => {
              createCase.mutate({ title: v.title, description: v.description }, {
                onSuccess: () => setShowNewCase(false),
              });
            }}
            submitting={createCase.isPending}
          />
        )}

        <div className="flex-1 overflow-auto">
          {casesLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : cases.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">No cases yet</p>
            </div>
          ) : (
            cases.map((c) => (
              <button
                key={c.id}
                onClick={() => { setSelectedCaseId(c.id); setSelectedArtifactId(null); setAddPanel(null); }}
                className={`w-full text-left px-4 py-3 border-b border-border/30 transition-colors text-xs ${
                  selectedCaseId === c.id
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-secondary/40"
                }`}
              >
                <p className="font-medium text-foreground truncate">{c.title}</p>
                <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                  {new Date(c.created_at).toLocaleDateString()}
                </p>
              </button>
            ))
          )}
        </div>

        {/* Case detail sidebar section */}
        {selectedCase && (
          <div className="border-t border-border px-4 py-3 space-y-3">
            <div>
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">SUBJECTS ({subjects.length})</span>
              <div className="mt-1 space-y-1">
                {subjects.map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5 text-xs text-secondary-foreground">
                    <Users className="h-3 w-3 text-primary/60" />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">{s.type}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(["subject", "artifact", "event", "upload"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setAddPanel(addPanel === type ? null : type)}
                  className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                    addPanel === type
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                  }`}
                >
                  {type === "upload" ? "⬆ UPLOAD" : `+ ${type.toUpperCase()}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══════ CENTER PANEL ══════ */}
      <div className="flex-1 overflow-auto p-6 space-y-5">
        {!selectedCase ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="font-mono text-sm text-muted-foreground">SELECT OR CREATE A CASE</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Use the sidebar to begin an investigation</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <span className="intel-tag intel-tag-blue mb-2 inline-block">ACTIVE INVESTIGATION</span>
                <h1 className="text-xl font-display font-bold tracking-tight">{selectedCase.title}</h1>
                {selectedCase.description && (
                  <p className="text-sm text-muted-foreground mt-1">{selectedCase.description}</p>
                )}
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{selectedCase.id.substring(0, 8)}</span>
            </div>

            {/* Cross-case warnings */}
            {crossCaseLinks.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="font-mono text-[10px] tracking-widest text-destructive font-bold">
                    CROSS-CASE ENTITIES DETECTED ({crossCaseLinks.length})
                  </span>
                </div>
                <div className="space-y-1.5 max-h-[150px] overflow-auto">
                  {(crossCaseLinks as any[]).map((link) => (
                    <div key={link.id} className="flex items-center gap-2 text-[10px] font-mono bg-background/50 rounded px-2.5 py-1.5">
                      <Link2 className="h-3 w-3 text-destructive shrink-0" />
                      <span className="text-foreground truncate flex-1">
                        <span className="font-semibold">{link.entity?.entity_value ?? "Entity"}</span>
                        <span className="text-muted-foreground"> ({link.entity?.entity_type}) → </span>
                        <span className="text-primary">{link.linked?.title ?? "Linked case"}</span>
                      </span>
                      <button
                        onClick={() => handleAcknowledgeLink(link.id)}
                        className="text-[9px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border/50 hover:border-border shrink-0"
                      >
                        DISMISS
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Investigation Suggestions */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  <span className="font-mono text-[10px] tracking-widest text-primary font-bold">
                    RECOMMENDED TOOLS {suggestions.length > 0 && `(${suggestions.length})`}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] gap-1"
                  disabled={generatingSuggestions || subjects.length === 0}
                  onClick={handleGenerateSuggestions}
                >
                  {generatingSuggestions ? (
                    <><Loader2 className="h-3 w-3 animate-spin" />ANALYZING...</>
                  ) : (
                    <><Sparkles className="h-3 w-3" />ANALYZE</>
                  )}
                </Button>
              </div>
              {suggestions.length === 0 ? (
                <p className="text-[10px] font-mono text-muted-foreground">
                  {subjects.length === 0 ? "Add subjects to get tool recommendations" : "Click ANALYZE to generate recommendations"}
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[200px] overflow-auto">
                  {(suggestions as any[]).map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-[10px] font-mono bg-background/50 rounded px-2.5 py-1.5">
                      <Sparkles className="h-3 w-3 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground">{s.recommended_tool.replace(/_/g, " ").toUpperCase()}</span>
                          <span className="text-muted-foreground/60">{Math.round(s.confidence_score * 100)}%</span>
                        </div>
                        <p className="text-muted-foreground truncate">{s.tool_description}</p>
                        <span className="intel-tag text-[8px] mt-0.5 inline-block">{s.trigger_value}</span>
                      </div>
                      <button
                        onClick={() => handleDismissSuggestion(s.id)}
                        className="p-0.5 rounded hover:bg-secondary shrink-0"
                        title="Dismiss"
                      >
                        <XCircle className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {addPanel && addPanel !== "upload" && (
              <GlassPanel className="p-4" neonLine="top">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    ADD {addPanel.toUpperCase()}
                  </span>
                  <button onClick={() => setAddPanel(null)}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                </div>
                {addPanel === "subject" && (
                  <QuickForm
                    fields={[
                      { key: "name", label: "NAME", required: true },
                      { key: "type", label: "TYPE (person, org, domain, ip...)", required: true },
                      { key: "notes", label: "NOTES", type: "textarea" },
                    ]}
                    submitting={createSubject.isPending}
                    onSubmit={(v) => createSubject.mutate({
                      case_id: selectedCaseId!,
                      name: v.name, type: v.type, notes: v.notes,
                    }, { onSuccess: () => setAddPanel(null) })}
                  />
                )}
                {addPanel === "artifact" && (
                  <QuickForm
                    fields={[
                      { key: "artifact_type", label: "TYPE (document, screenshot, log...)", required: true },
                      { key: "data", label: "DATA / CONTENT", type: "textarea" },
                    ]}
                    submitting={createArtifact.isPending}
                    onSubmit={(v) => createArtifact.mutate({
                      case_id: selectedCaseId!,
                      artifact_type: v.artifact_type, data: v.data,
                    }, { onSuccess: () => setAddPanel(null) })}
                  />
                )}
                {addPanel === "event" && (
                  <QuickForm
                    fields={[
                      { key: "event_type", label: "EVENT TYPE", required: true },
                      { key: "timestamp", label: "TIMESTAMP", type: "datetime-local" },
                      { key: "description", label: "DESCRIPTION", type: "textarea" },
                    ]}
                    submitting={createEvent.isPending}
                    onSubmit={(v) => createEvent.mutate({
                      case_id: selectedCaseId!,
                      event_type: v.event_type,
                      timestamp: v.timestamp || undefined,
                      description: v.description,
                    }, { onSuccess: () => setAddPanel(null) })}
                  />
                )}
              </GlassPanel>
            )}

            {addPanel === "upload" && selectedCaseId && (
              <ArtifactUploader caseId={selectedCaseId} onUploaded={() => setAddPanel(null)} />
            )}

            {/* Collaborators */}
            <CaseCollaborators caseId={selectedCaseId!} isOwner={selectedCase.owner_id === user?.id} />

            {/* AI Analysis */}
            <CaseAnalysis caseId={selectedCaseId!} />

            {/* Relationship Graph */}
            <RelationshipGraph caseId={selectedCaseId!} />

            {/* Timeline */}
            <IntelCard icon={Clock} title="Event Timeline" badge={`${events.length} EVENTS`}>
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground font-mono py-4 text-center">NO EVENTS RECORDED</p>
              ) : (
                <InvestigationTimeline events={timelineEvents} />
              )}
            </IntelCard>

            {/* Artifacts grid */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-primary" />
                <span className="font-display text-sm font-semibold">Artifacts</span>
                <span className="intel-tag intel-tag-blue">{artifacts.length}</span>
              </div>
              {artifacts.length === 0 ? (
                <GlassPanel className="p-6 text-center">
                  <p className="text-xs text-muted-foreground font-mono">NO ARTIFACTS ATTACHED</p>
                </GlassPanel>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {artifacts.map((a) => {
                    const isFile = (() => { try { const p = JSON.parse(a.data ?? ""); return !!p.storage_path; } catch { return false; } })();
                    const fileMeta = isFile ? JSON.parse(a.data!) : null;
                    const AIcon = isFile && fileMeta?.content_type?.startsWith("image/") ? FileImage : isFile ? File : FileText;
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelectedArtifactId(a.id)}
                        className={`glass-panel rounded-lg p-3 text-left transition-all ${
                          selectedArtifactId === a.id
                            ? "glow-blue border-primary/30"
                            : "hover:border-border/60"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <AIcon className="h-3.5 w-3.5 text-primary/70" />
                          <span className="intel-tag intel-tag-muted">{a.artifact_type}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-1">
                          {isFile ? fileMeta.original_name : (a.data?.substring(0, 60) || "—")}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground/60 mt-1.5">
                          {new Date(a.created_at).toLocaleString()}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ══════ RIGHT PANEL — Artifact Metadata ══════ */}
      <div className={`shrink-0 border-l border-border bg-card/50 overflow-auto transition-all duration-300 ${
        selectedArtifact ? "w-80" : "w-0"
      }`}>
        {selectedArtifact && (
          <div className="p-4 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">ARTIFACT DETAIL</span>
              <button onClick={() => setSelectedArtifactId(null)}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <span className="font-mono text-[10px] text-muted-foreground">TYPE</span>
                <p className="text-sm text-foreground mt-0.5">{selectedArtifact.artifact_type}</p>
              </div>
              <div>
                <span className="font-mono text-[10px] text-muted-foreground">CASE ID</span>
                <p className="text-xs font-mono text-foreground mt-0.5">{selectedArtifact.case_id.substring(0, 12)}...</p>
              </div>
              <div>
                <span className="font-mono text-[10px] text-muted-foreground">CREATED</span>
                <p className="text-xs text-foreground mt-0.5">{new Date(selectedArtifact.created_at).toLocaleString()}</p>
              </div>
              <div>
                <span className="font-mono text-[10px] text-muted-foreground">ID</span>
                <p className="text-xs font-mono text-foreground mt-0.5 break-all">{selectedArtifact.id}</p>
              </div>
            </div>

            {(() => {
              const isFile = (() => { try { const p = JSON.parse(selectedArtifact.data ?? ""); return !!p.storage_path; } catch { return false; } })();
              if (isFile) {
                const fileMeta = JSON.parse(selectedArtifact.data!);
                const handleDownload = async () => {
                  const { data } = await supabase.storage.from("artifacts").createSignedUrl(fileMeta.storage_path, 60);
                  if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                };
                return (
                  <div className="space-y-3">
                    <div>
                      <span className="font-mono text-[10px] text-muted-foreground">FILE NAME</span>
                      <p className="text-xs text-foreground mt-0.5">{fileMeta.original_name}</p>
                    </div>
                    <div>
                      <span className="font-mono text-[10px] text-muted-foreground">CONTENT TYPE</span>
                      <p className="text-xs text-foreground mt-0.5">{fileMeta.content_type}</p>
                    </div>
                    <div>
                      <span className="font-mono text-[10px] text-muted-foreground">SIZE</span>
                      <p className="text-xs text-foreground mt-0.5">{(fileMeta.size_bytes / 1024).toFixed(1)} KB</p>
                    </div>
                    <Button variant="neon" size="sm" className="w-full" onClick={handleDownload}>
                      <Download className="h-3.5 w-3.5 mr-2" />DOWNLOAD
                    </Button>
                  </div>
                );
              }
              return (
                <div>
                  <span className="font-mono text-[10px] text-muted-foreground">DATA</span>
                  <pre className="mt-1.5 bg-background/60 border border-border rounded p-3 text-xs font-mono text-secondary-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-auto">
                    {selectedArtifact.data || "— empty —"}
                  </pre>
                </div>
              );
            })()}

            {/* Evidence Integrity Log */}
            <EvidenceLogViewer artifactId={selectedArtifact.id} />
          </div>
        )}
      </div>
    </div>
  );
}
