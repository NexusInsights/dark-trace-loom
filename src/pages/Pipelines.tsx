import { useState } from "react";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { usePipelines, usePipelineRuns, useCreatePipeline, useDeletePipeline, useTogglePipeline } from "@/hooks/usePipelines";
import { executePipeline, getPipelineTemplates } from "@/lib/pipelineEngine";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2, Plus, Play, Trash2, Clock, CheckCircle2, XCircle,
  AlertTriangle, Workflow, Zap, Database, Link2,
} from "lucide-react";
import { format } from "date-fns";

const SCHEDULE_OPTIONS = [
  { value: "manual", label: "Manual Only" },
  { value: "hourly", label: "Every Hour" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  completed: { icon: CheckCircle2, color: "text-green-400", label: "Completed" },
  running: { icon: Loader2, color: "text-primary", label: "Running" },
  failed: { icon: XCircle, color: "text-destructive", label: "Failed" },
  pending: { icon: Clock, color: "text-muted-foreground", label: "Pending" },
};

export default function PipelinesPage() {
  const { user } = useAuth();
  const { data: pipelines = [], isLoading } = usePipelines();
  const { data: allRuns = [] } = usePipelineRuns();
  const createPipeline = useCreatePipeline();
  const deletePipeline = useDeletePipeline();
  const togglePipeline = useTogglePipeline();
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [runningPipelineId, setRunningPipelineId] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState("");

  // Create form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState("manual");
  const [toolSequence, setToolSequence] = useState("");

  const templates = getPipelineTemplates();

  const handleCreate = () => {
    if (!name.trim()) return;
    const tools = toolSequence.split(",").map((t) => t.trim()).filter(Boolean);
    createPipeline.mutate(
      { name, description, schedule, tool_sequence: tools },
      {
        onSuccess: () => {
          setShowCreate(false);
          setName(""); setDescription(""); setSchedule("manual"); setToolSequence("");
        },
      }
    );
  };

  const handleCreateFromTemplate = (tpl: typeof templates[0]) => {
    createPipeline.mutate({
      name: tpl.name,
      description: tpl.description,
      schedule: tpl.schedule,
      tool_sequence: tpl.tool_sequence,
    });
  };

  const handleRun = async (pipelineId: string) => {
    if (!user) return;
    setRunningPipelineId(pipelineId);
    try {
      const result = await executePipeline(pipelineId, user.id, (step, idx, total) => {
        setRunProgress(`[${idx + 1}/${total}] Running ${step}...`);
      });
      qc.invalidateQueries({ queryKey: ["pipeline_runs"] });
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      qc.invalidateQueries({ queryKey: ["identity_entities"] });
      toast.success(
        `Pipeline complete: ${result.artifactsCreated} artifacts created, ${result.entitiesLinked} entities linked`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Pipeline failed");
    } finally {
      setRunningPipelineId(null);
      setRunProgress("");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Automation</span>
          <h1 className="text-2xl font-display font-bold tracking-tight mt-1">OSINT Pipelines</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated intelligence gathering workflows that discover and link entities across investigations.
          </p>
        </div>
        <Button variant="neon" size="sm" className="gap-2" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-3.5 w-3.5" />{showCreate ? "CANCEL" : "NEW PIPELINE"}
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <GlassPanel className="p-5 space-y-4" neonLine="top">
          <span className="font-mono text-[10px] tracking-[0.2em] text-primary uppercase">Create Pipeline</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input placeholder="Pipeline name" value={name} onChange={(e) => setName(e.target.value)} className="bg-secondary/50" />
            <Select value={schedule} onValueChange={setSchedule}>
              <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCHEDULE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="bg-secondary/50"
            rows={2}
          />
          <Input
            placeholder="Tool sequence (comma-separated): username_search, social_analyzer, breach_search"
            value={toolSequence}
            onChange={(e) => setToolSequence(e.target.value)}
            className="bg-secondary/50 font-mono text-xs"
          />
          <div className="flex justify-end">
            <Button variant="neon" size="sm" className="gap-2" onClick={handleCreate} disabled={!name.trim() || createPipeline.isPending}>
              {createPipeline.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Workflow className="h-3.5 w-3.5" />}
              CREATE
            </Button>
          </div>
        </GlassPanel>
      )}

      {/* Templates */}
      {pipelines.length === 0 && !isLoading && (
        <div className="space-y-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">Quick Start Templates</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map((tpl) => (
              <GlassPanel key={tpl.name} className="p-4 space-y-2 hover:ring-1 hover:ring-primary/30 transition-all">
                <div className="flex items-start justify-between">
                  <span className="font-display font-semibold text-sm text-foreground">{tpl.name}</span>
                  <Badge variant="outline" className="text-[9px] font-mono">{tpl.schedule}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{tpl.description}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {tpl.tool_sequence.map((t) => (
                    <span key={t} className="intel-tag text-[9px]">{t}</span>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2 mt-2" onClick={() => handleCreateFromTemplate(tpl)}>
                  <Zap className="h-3 w-3" />USE TEMPLATE
                </Button>
              </GlassPanel>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : pipelines.length > 0 && (
        <div className="space-y-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            Pipelines ({pipelines.length})
          </span>
          {(pipelines as any[]).map((p) => {
            const isRunning = runningPipelineId === p.id;
            const runs = (allRuns as any[]).filter((r) => r.pipeline_id === p.id);
            const lastRun = runs[0];

            return (
              <GlassPanel key={p.id} className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Workflow className="h-5 w-5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-semibold text-sm text-foreground truncate">{p.name}</span>
                      <Badge variant="outline" className="text-[9px] font-mono">{p.schedule}</Badge>
                      {!p.enabled && <Badge variant="secondary" className="text-[9px]">DISABLED</Badge>}
                    </div>
                    {p.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Switch
                      checked={p.enabled}
                      onCheckedChange={(checked) => togglePipeline.mutate({ id: p.id, enabled: checked })}
                    />
                    <Button
                      variant="neon" size="sm" className="gap-1.5"
                      disabled={isRunning}
                      onClick={() => handleRun(p.id)}
                    >
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      {isRunning ? "RUNNING" : "RUN"}
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => deletePipeline.mutate(p.id)}
                      disabled={deletePipeline.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* Tool sequence */}
                <div className="flex gap-1.5 flex-wrap">
                  {(p.tool_sequence as string[]).map((t, i) => (
                    <span key={i} className="intel-tag text-[9px] font-mono">{t}</span>
                  ))}
                </div>

                {isRunning && runProgress && (
                  <div className="flex items-center gap-2 text-[10px] font-mono text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />{runProgress}
                  </div>
                )}

                {/* Last run info */}
                {lastRun && (
                  <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground border-t border-border/30 pt-2">
                    {(() => {
                      const cfg = STATUS_CONFIG[lastRun.status] ?? STATUS_CONFIG.pending;
                      const Icon = cfg.icon;
                      return (
                        <span className={`flex items-center gap-1 ${cfg.color}`}>
                          <Icon className={`h-3 w-3 ${lastRun.status === "running" ? "animate-spin" : ""}`} />
                          {cfg.label}
                        </span>
                      );
                    })()}
                    {lastRun.completed_at && (
                      <span>{format(new Date(lastRun.completed_at), "MMM d, HH:mm")}</span>
                    )}
                    {lastRun.artifacts_created > 0 && (
                      <span className="flex items-center gap-1"><Database className="h-3 w-3" />{lastRun.artifacts_created} artifacts</span>
                    )}
                    {lastRun.entities_linked > 0 && (
                      <span className="flex items-center gap-1"><Link2 className="h-3 w-3" />{lastRun.entities_linked} entities</span>
                    )}
                  </div>
                )}
              </GlassPanel>
            );
          })}
        </div>
      )}

      {/* Recent runs */}
      {allRuns.length > 0 && (
        <div className="space-y-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            Recent Runs ({allRuns.length})
          </span>
          <div className="space-y-2">
            {(allRuns as any[]).slice(0, 20).map((run) => {
              const cfg = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;
              const Icon = cfg.icon;
              const pipeline = (pipelines as any[]).find((p) => p.id === run.pipeline_id);
              return (
                <GlassPanel key={run.id} className="p-3">
                  <div className="flex items-center gap-3 text-xs">
                    <Icon className={`h-3.5 w-3.5 ${cfg.color} ${run.status === "running" ? "animate-spin" : ""}`} />
                    <span className="font-mono font-semibold text-foreground">{pipeline?.name ?? "Unknown"}</span>
                    <span className={`font-mono text-[10px] ${cfg.color}`}>{cfg.label}</span>
                    {run.started_at && (
                      <span className="font-mono text-[10px] text-muted-foreground ml-auto">
                        {format(new Date(run.started_at), "MMM d, HH:mm:ss")}
                      </span>
                    )}
                    {run.artifacts_created > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {run.artifacts_created} artifacts
                      </span>
                    )}
                    {run.entities_linked > 0 && (
                      <span className="font-mono text-[10px] text-primary">
                        {run.entities_linked} entities
                      </span>
                    )}
                  </div>
                </GlassPanel>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
