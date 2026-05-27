import { useState, useEffect } from "react";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { useCases } from "@/hooks/useInvestigationData";
import { useAgents, useRunAgent, useSeedAgents, useAgentRuns } from "@/hooks/useAgentData";
import { allTools } from "@/components/tools/toolDefinitions";
import { toast } from "sonner";
import {
  Bot, Play, Loader2, CheckCircle, XCircle, Clock, Tag, ArrowRight,
  Zap, ChevronDown, ChevronUp,
} from "lucide-react";

export default function AgentsPage() {
  const { data: agents = [], isLoading: agentsLoading } = useAgents();
  const { data: cases = [] } = useCases();
  const { data: runs = [] } = useAgentRuns();
  const { startRun, runState, clearRunState } = useRunAgent();
  const seedAgents = useSeedAgents();

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [caseId, setCaseId] = useState("");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  // Seed default agents on first visit
  useEffect(() => {
    if (!agentsLoading && agents.length === 0) {
      seedAgents.mutate();
    }
  }, [agentsLoading, agents.length]);

  const activeAgent = agents.find((a) => a.id === selectedAgent);

  const handleLaunch = async () => {
    if (!activeAgent || !subject.trim()) {
      toast.error("Enter a subject to investigate");
      return;
    }
    const seq = (activeAgent.tool_sequence as string[]) ?? [];
    if (seq.length === 0) {
      toast.error("Agent has no tools configured");
      return;
    }
    await startRun(activeAgent.id, seq, subject.trim(), caseId || null);
  };

  const isRunning = runState?.status === "running";

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />;
      case "failed": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "running": return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
      default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in space-y-8">
      {/* Header */}
      <div>
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Automation</span>
        <h1 className="text-2xl font-display font-bold tracking-tight mt-1">Investigation Agents</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automated OSINT pipelines that run tools in sequence and save findings to your cases.
        </p>
      </div>

      {/* Agent Selection */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {agentsLoading ? (
          <div className="col-span-3 flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          agents.map((agent) => {
            const seq = (agent.tool_sequence as string[]) ?? [];
            const isSelected = selectedAgent === agent.id;
            return (
              <GlassPanel
                key={agent.id}
                className={`p-4 cursor-pointer transition-all duration-200 ${
                  isSelected ? "ring-2 ring-primary glow-blue" : "hover:border-primary/20"
                }`}
                neonLine={isSelected ? "top" : undefined}
              >
                <button
                  onClick={() => {
                    setSelectedAgent(isSelected ? null : agent.id);
                    clearRunState();
                  }}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Bot className="h-4 w-4 text-primary" />
                    <span className="font-display text-sm font-semibold">{agent.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{agent.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {seq.map((toolId) => {
                      const t = allTools.find((x) => x.id === toolId);
                      return (
                        <span key={toolId} className="intel-tag intel-tag-blue text-[9px]">
                          {t?.name ?? toolId}
                        </span>
                      );
                    })}
                  </div>
                </button>
              </GlassPanel>
            );
          })
        )}
      </div>

      {/* Run Configuration */}
      {activeAgent && (
        <GlassPanel className="p-6 space-y-4" neonLine="left" glow="blue">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="h-4 w-4 text-primary" />
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
              CONFIGURE RUN — {activeAgent.name.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">SUBJECT</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. john_doe_42, example.com, or paste email headers"
                maxLength={2000}
                className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">LINK TO CASE (optional)</label>
              <select
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
                className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">No case (standalone run)</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
          </div>

          <Button
            variant="neon"
            size="sm"
            className="w-full gap-2"
            onClick={handleLaunch}
            disabled={isRunning || !subject.trim()}
          >
            {isRunning ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />AGENT RUNNING...</>
            ) : (
              <><Play className="h-3.5 w-3.5" />LAUNCH AGENT</>
            )}
          </Button>
        </GlassPanel>
      )}

      {/* Live Run Progress */}
      {runState && (
        <GlassPanel className="p-5 space-y-4" neonLine="top">
          <div className="flex items-center gap-2">
            {statusIcon(runState.status)}
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
              LIVE EXECUTION — {runState.status.toUpperCase()}
            </span>
          </div>

          <div className="space-y-2">
            {runState.steps.map((step, i) => (
              <div
                key={step.toolId}
                className={`flex items-center gap-3 px-3 py-2 rounded border transition-all ${
                  step.status === "running"
                    ? "border-primary/40 bg-primary/5"
                    : step.status === "completed"
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : step.status === "failed"
                    ? "border-destructive/20 bg-destructive/5"
                    : "border-border bg-secondary/30"
                }`}
              >
                <span className="font-mono text-[10px] text-muted-foreground w-5">{i + 1}</span>
                {statusIcon(step.status)}
                <span className="text-xs font-medium flex-1">{step.toolName}</span>
                {step.status === "running" && (
                  <span className="font-mono text-[9px] text-primary animate-pulse">PROCESSING</span>
                )}
                {step.status === "completed" && step.result && (
                  <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                    {step.result.summary}
                  </span>
                )}
                {step.status === "failed" && step.error && (
                  <span className="text-[10px] text-destructive truncate max-w-[200px]">
                    {step.error}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Completed results */}
          {runState.status !== "running" && runState.steps.some((s) => s.result) && (
            <div className="border-t border-border/40 pt-4 space-y-3">
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">AGGREGATED FINDINGS</span>
              {runState.steps
                .filter((s) => s.result)
                .map((step) => (
                  <div key={step.toolId} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-3 w-3 text-primary" />
                      <span className="text-xs font-semibold">{step.toolName}</span>
                      {step.result?.tags?.map((t) => (
                        <span key={t} className="intel-tag intel-tag-blue flex items-center gap-0.5 text-[8px]">
                          <Tag className="h-2 w-2" />{t}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground ml-5">{step.result?.summary}</p>
                    <pre className="bg-background/60 border border-border rounded p-3 text-[10px] font-mono text-secondary-foreground whitespace-pre-wrap break-words max-h-[200px] overflow-auto ml-5">
                      {JSON.stringify(step.result?.details, null, 2)}
                    </pre>
                  </div>
                ))}
            </div>
          )}
        </GlassPanel>
      )}

      {/* Past Runs */}
      {runs.length > 0 && (
        <div className="space-y-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">Recent Runs</span>
          {runs.slice(0, 10).map((run) => {
            const isExpanded = expandedRun === run.id;
            const inputData = run.input_data as Record<string, unknown> | null;
            const results = run.results as Array<Record<string, unknown>> | null;
            return (
              <GlassPanel key={run.id} className="p-4">
                <button
                  onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                  className="w-full text-left flex items-center gap-3"
                >
                  {statusIcon(run.status)}
                  <span className="text-xs font-semibold flex-1 truncate">
                    {(inputData?.subject as string) ?? "Unknown subject"}
                  </span>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {new Date(run.created_at).toLocaleString()}
                  </span>
                  <span className={`intel-tag text-[9px] ${
                    run.status === "completed" ? "intel-tag-blue" : 
                    run.status === "failed" ? "intel-tag-purple" : "intel-tag-blue"
                  }`}>
                    {run.status.toUpperCase()}
                  </span>
                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
                {isExpanded && results && (
                  <div className="mt-3 border-t border-border/40 pt-3 space-y-2">
                    {results.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        {statusIcon(r.status as string)}
                        <span className="font-medium">{r.toolName as string}</span>
                        <span className="text-muted-foreground truncate flex-1">{r.summary as string}</span>
                      </div>
                    ))}
                  </div>
                )}
              </GlassPanel>
            );
          })}
        </div>
      )}
    </div>
  );
}
