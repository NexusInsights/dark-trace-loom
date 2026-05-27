import { useState } from "react";
import { ToolDefinition, ToolResult } from "./types";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useUsageTracking } from "@/hooks/useUsageTracking";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useCases } from "@/hooks/useInvestigationData";
import { checkRateLimit } from "@/lib/rateLimiter";
import { checkToolExecutionGate, checkFeatureGate, getPlanPermissions } from "@/lib/planGating";
import { toolInputSchema } from "@/lib/validations";
import { UpgradePrompt } from "./UpgradePrompt";
import { toast } from "sonner";
import {
  Loader2, Play, Save, ArrowLeft, Tag, CheckCircle, ShieldAlert, Activity,
} from "lucide-react";
import type { Json } from "@/integrations/supabase/types";
import type { SubscriptionPlan } from "@/hooks/useSubscription";

interface Props {
  tool: ToolDefinition;
  onBack: () => void;
}

export function ToolRunner({ tool, onBack }: Props) {
  const { user } = useAuth();
  const { plan } = useSubscription();
  const { dailyTotal, recordExecution } = useUsageTracking();
  const { log: auditLog } = useAuditLog();
  const { data: cases = [] } = useCases();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [rateLimited, setRateLimited] = useState(false);
  const [gateBlock, setGateBlock] = useState<{ reason: string; requiredPlan: SubscriptionPlan } | null>(null);

  const perms = getPlanPermissions(plan);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateBlock(null);

    // Admin tool-permission gate (deny if explicit row blocks this user)
    if (user) {
      const { data: permRow } = await supabase
        .from("tool_permissions")
        .select("allowed")
        .eq("user_id", user.id)
        .eq("tool_id", tool.id)
        .maybeSingle();
      if (permRow && permRow.allowed === false) {
        toast.error("This tool has been disabled for your account by an administrator.");
        return;
      }
    }

    // Plan gate check
    const gate = checkToolExecutionGate(plan, dailyTotal);
    if (!gate.allowed) {
      setGateBlock({ reason: gate.reason, requiredPlan: gate.requiredPlan });
      return;
    }

    // Validate inputs
    const validation = toolInputSchema.safeParse(inputs);
    if (!validation.success) {
      toast.error(validation.error.errors[0]?.message ?? "Invalid input");
      return;
    }

    // Rate limit check
    const { allowed, retryAfterMs } = checkRateLimit(tool.id);
    if (!allowed) {
      setRateLimited(true);
      toast.error(`Rate limited. Try again in ${Math.ceil(retryAfterMs / 1000)}s`);
      setTimeout(() => setRateLimited(false), retryAfterMs);
      return;
    }

    setRunning(true);
    setResult(null);
    setSaved(false);
    try {
      const res = await tool.process(validation.data);
      await recordExecution(tool.id);
      await auditLog("tool_execution", "tool", tool.id, { tool_name: tool.name });
      setResult(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Tool execution failed";
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async () => {
    if (!result || !user) return;

    // Check save permission
    const saveGate = checkFeatureGate(plan, "canSaveInvestigations");
    if (!saveGate.allowed) {
      setGateBlock({ reason: saveGate.reason, requiredPlan: saveGate.requiredPlan });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("tool_results").insert({
        tool_name: tool.id,
        case_id: selectedCaseId || null,
        user_id: user.id,
        result_data: { inputs, ...result } as unknown as Json,
      });
      if (error) throw error;
      setSaved(true);
      toast.success("Result saved to investigation");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded hover:bg-secondary transition-colors">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <tool.icon className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h2 className="font-display text-lg font-bold tracking-tight">{tool.name}</h2>
          <p className="text-xs text-muted-foreground">{tool.description}</p>
        </div>
        {/* Usage indicator for limited plans */}
        {perms.maxToolRunsPerDay !== -1 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-secondary/50">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <span className={`font-mono text-[11px] font-semibold ${dailyTotal >= perms.maxToolRunsPerDay ? "text-destructive" : "text-foreground"}`}>
              {dailyTotal}/{perms.maxToolRunsPerDay}
            </span>
            <span className="font-mono text-[9px] text-muted-foreground">TODAY</span>
          </div>
        )}
      </div>

      {/* Plan gate block */}
      {gateBlock && (
        <UpgradePrompt reason={gateBlock.reason} requiredPlan={gateBlock.requiredPlan} />
      )}

      {/* Input form */}
      <GlassPanel className="p-5" neonLine="top">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground mb-3 block">INPUT PARAMETERS</span>
        <form onSubmit={handleRun} className="space-y-3">
          {tool.fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">{f.label}</label>
              {f.type === "textarea" ? (
                <textarea
                  required={f.required}
                  placeholder={f.placeholder}
                  value={inputs[f.key] ?? ""}
                  onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))}
                  rows={5}
                  maxLength={50000}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono"
                />
              ) : f.type === "select" ? (
                <select
                  value={inputs[f.key] ?? f.options?.[0]?.value ?? ""}
                  onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required={f.required}
                  placeholder={f.placeholder}
                  value={inputs[f.key] ?? ""}
                  onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))}
                  maxLength={1000}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              )}
            </div>
          ))}

          {rateLimited && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span className="font-mono">RATE LIMITED — please wait</span>
            </div>
          )}

          <Button type="submit" variant="neon" size="sm" disabled={running || rateLimited} className="w-full">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
            {running ? "PROCESSING..." : "EXECUTE"}
          </Button>
        </form>
      </GlassPanel>

      {/* Results */}
      {result && (
        <GlassPanel className="p-5 space-y-4" neonLine="left" glow="blue">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">RESULTS</span>
              <p className="text-sm font-medium mt-1">{result.summary}</p>
            </div>
            {result.tags && (
              <div className="flex gap-1 flex-wrap justify-end">
                {result.tags.map((t) => (
                  <span key={t} className="intel-tag intel-tag-blue flex items-center gap-1">
                    <Tag className="h-2.5 w-2.5" />{t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <pre className="bg-background/60 border border-border rounded p-4 text-xs font-mono text-secondary-foreground whitespace-pre-wrap break-words max-h-[500px] overflow-auto">
            {JSON.stringify(result.details, null, 2)}
          </pre>

          {/* Save to investigation */}
          <div className="border-t border-border/50 pt-4 space-y-3">
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">SAVE TO INVESTIGATION</span>
            <div className="flex items-center gap-2">
              <select
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                className="flex-1 bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">No case (standalone)</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <Button
                variant="neon"
                size="sm"
                onClick={handleSave}
                disabled={saving || saved}
              >
                {saved ? (
                  <><CheckCircle className="h-3.5 w-3.5 mr-1.5" />SAVED</>
                ) : saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <><Save className="h-3.5 w-3.5 mr-1.5" />SAVE</>
                )}
              </Button>
            </div>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
