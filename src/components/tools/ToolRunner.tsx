import { useEffect, useState } from "react";
import { executeTool } from "./executeTool";
import { assertToolResultOwnership } from "@/lib/ownedToolResults";
import { assertToolPermission } from "@/lib/toolPermission";
import { readVideoFrames } from './videoFrames';
import { StreetComparison } from './StreetComparison';
import { Link } from 'react-router-dom';
import { PdlContactResults } from "./PdlContactResults";
import { PublicRecordResults } from './PublicRecordResults';
import { VehicleResultFields } from './VehicleResultFields';
import { ToolDefinition, ToolField, ToolResult } from "./types";
import { getMarketplaceStatus, MarketplaceProviderStatus } from "./marketplaceRemoteTools";
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
  personId?: string;
  initialInputs?: Record<string, string>;
  onSaved?: () => void;
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function validateToolInputs(tool: ToolDefinition, inputs: Record<string, string>): Record<string, string> {
  const keys = Object.keys(inputs);
  if (keys.length > 20) throw new Error("Too many input fields");
  const ordinary = Object.fromEntries(Object.entries(inputs).filter(([key]) => !tool.fields.some(field => field.key === key && field.type === "file")));
  const validated = toolInputSchema.safeParse(ordinary);
  if (!validated.success) throw new Error(validated.error.errors[0]?.message || "Invalid input");
  for (const field of tool.fields.filter(field => field.type === "file")) {
    const maxBytes = Math.min(field.maxFileBytes || MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES);
    const maxChars = field.fileEncoding === "text" ? maxBytes : Math.ceil(maxBytes * 4 / 3) + 4;
    if (typeof inputs[field.key] !== "undefined" && (typeof inputs[field.key] !== "string" || inputs[field.key].length > maxChars)) {
      throw new Error(`${field.label} exceeds the ${Math.round(maxBytes / 1024 / 1024)} MiB upload limit`);
    }
  }
  return { ...inputs };
}

export function readToolUpload(file: File, field: ToolField): Promise<string> {
  if(field.fileEncoding==='video-frames') return readVideoFrames(file);
  const maxBytes = Math.min(field.maxFileBytes || MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES);
  if (!file.size || file.size > maxBytes) return Promise.reject(new Error(`${field.label}: select a nonempty file no larger than ${Math.round(maxBytes / 1024 / 1024)} MiB`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let finished = false;
    const timeout = setTimeout(() => { reader.abort(); finish(new Error("File read exceeded the 15-second timeout")); }, 15000);
    function finish(error?: Error, value?: string) {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      if (error) reject(error); else resolve(value || "");
    }
    reader.onerror = () => finish(new Error(reader.error?.message || "File could not be read"));
    reader.onabort = () => finish(new Error("File read was cancelled"));
    reader.onload = () => {
      if (typeof reader.result !== "string") { finish(new Error("File reader returned an unsupported result")); return; }
      const comma = reader.result.indexOf(",");
      if (comma < 0) { finish(new Error("File bytes could not be encoded")); return; }
      const encoded = reader.result.slice(comma + 1);
      if (field.fileEncoding === "text") {
        try { finish(undefined, new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded), value => value.charCodeAt(0)))); }
        catch { finish(new Error("The uploaded text file is not valid UTF-8")); }
      } else finish(undefined, encoded);
    };
    reader.readAsDataURL(file);
  });
}

export function ToolRunner({ tool, onBack, personId, initialInputs, onSaved }: Props) {
  const { user, loading: authLoading } = useAuth();
  const { plan, loading: subscriptionLoading, error: subscriptionError, refreshSubscription } = useSubscription();
  const { dailyTotal, loading: usageLoading, error: usageError, recordExecution, refresh: refreshUsage } = useUsageTracking();
  const { log: auditLog } = useAuditLog();
  const { data: cases = [] } = useCases();
  const [inputs, setInputs] = useState<Record<string, string>>(() => ({...Object.fromEntries(tool.fields.filter(field => field.type === "select" && field.options?.length).map(field => [field.key, field.options![0].value])),...initialInputs}));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [rateLimited, setRateLimited] = useState(false);
  const [gateBlock, setGateBlock] = useState<{ reason: string; requiredPlan: SubscriptionPlan } | null>(null);
  const [providerStatus, setProviderStatus] = useState<MarketplaceProviderStatus | null>(null);
  const [providerChecking, setProviderChecking] = useState(Boolean(tool.integration));
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerRefresh, setProviderRefresh] = useState(0);
  const [readingFiles, setReadingFiles] = useState<Record<string, boolean>>({});
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, string>>({});
  const changeInput = (key: string, value: string) => {
    setInputs(current => { const next = { ...current, [key]: value }; delete next.cursor; return next; });
    setResult(null); setSaved(false); setExecutionError(null);
  };

  useEffect(() => {
    if (!tool.integration) return;
    let active = true;
    setProviderChecking(true); setProviderStatus(null); setProviderError(null);
    getMarketplaceStatus(tool.id).then(status => { if (active) setProviderStatus(status); }).catch(error => {
      if (active) setProviderError(error instanceof Error ? error.message : "Provider configuration could not be verified");
    }).finally(() => { if (active) setProviderChecking(false); });
    return () => { active = false; };
  }, [tool.id, tool.integration, providerRefresh]);

  const uploadFile = async (field: ToolField, file: File | undefined) => {
    setInputs(values => ({ ...values, [field.key]: "" }));
    setUploadedFiles(values => ({ ...values, [field.key]: "" }));
    if (!file) return;
    setReadingFiles(values => ({ ...values, [field.key]: true }));
    try {
      const value = await readToolUpload(file, field);
      setInputs(values => ({ ...values, [field.key]: value, ...(field.filenameKey ? { [field.filenameKey]: file.name } : {}) }));
      setUploadedFiles(values => ({ ...values, [field.key]: `${file.name} (${file.size.toLocaleString()} bytes)` }));
      setExecutionError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "File could not be read";
      setExecutionError(message); toast.error(message);
    } finally { setReadingFiles(values => ({ ...values, [field.key]: false })); }
  };

  const accountChecking = authLoading || subscriptionLoading || usageLoading;
  const accountError = subscriptionError || usageError;
  const perms = subscriptionLoading ? null : getPlanPermissions(plan);
  const accountReady = !accountChecking && !accountError && Boolean(user) && Boolean(perms) && Number.isFinite(dailyTotal) && dailyTotal >= 0;
  const refreshAccountAccess = async () => {
    try { await Promise.all([refreshSubscription(), refreshUsage()]); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Account access could not be refreshed"); }
  };

  const handleRun = async (e: React.FormEvent, overrideInputs?: Record<string, string>) => {
    e.preventDefault();
    setGateBlock(null);
    if (!accountReady) {
      toast.error(accountChecking ? "Checking account access — wait for sign-in, plan and daily usage to finish loading" : accountError || (!user ? "Sign in to execute tools" : "Account access could not be verified"));
      return;
    }
    if (Object.values(readingFiles).some(Boolean)) { toast.error("Wait for the selected file to finish reading"); return; }
    if (tool.integration && (providerChecking || providerError || !providerStatus?.configured)) {
      toast.error(providerError || (providerChecking ? "Provider configuration is still being checked" : `Provider setup is required${providerStatus?.missing_secrets.length ? `: ${providerStatus.missing_secrets.join(", ")}` : ""}`));
      return;
    }

    // Admin tool-permission gate (deny if explicit row blocks this user)
    if (user) {
      try { await assertToolPermission(user.id, tool.id); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Tool permissions could not be checked"); return; }
    }

    // Plan gate check
    const gate = checkToolExecutionGate(plan, dailyTotal);
    if (!gate.allowed) {
      setGateBlock({ reason: gate.reason, requiredPlan: gate.requiredPlan });
      return;
    }

    // Validate inputs
    let validatedInputs: Record<string, string>;
    try { validatedInputs = validateToolInputs(tool, overrideInputs || inputs); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Invalid input"); return; }

    // Rate limit check
    const { allowed, retryAfterMs } = checkRateLimit(tool.id);
    if (!allowed) {
      setRateLimited(true);
      toast.error(`Rate limited. Try again in ${Math.ceil(retryAfterMs / 1000)}s`);
      setTimeout(() => setRateLimited(false), retryAfterMs);
      return;
    }

    setRunning(true);
    setExecutionError(null);
    setResult(null);
    setSaved(false);
    try {
      const res = await executeTool(tool, validatedInputs);
      await recordExecution(tool.id);
      await auditLog("tool_execution", "tool", tool.id, { tool_name: tool.name });
      setResult(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Tool execution failed";
      setExecutionError(message);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async () => {
    if (!result || !user) return;
    if (!accountReady) { toast.error(accountChecking ? "Checking account access — wait before saving" : "Account access could not be verified"); return; }

    // Check save permission
    const saveGate = checkFeatureGate(plan, "canSaveInvestigations");
    if (!saveGate.allowed) {
      setGateBlock({ reason: saveGate.reason, requiredPlan: saveGate.requiredPlan });
      return;
    }

    setSaving(true);
    try {
      if (personId) {
        const { data: owner, error: ownerError } = await supabase.from("personas").select("id").eq("id", personId).eq("user_id", user.id).abortSignal(AbortSignal.timeout(15000)).single();
        if (ownerError || !owner) throw new Error("The selected person could not be verified. Your result is still available below.");
      }
      await assertToolResultOwnership(user.id, selectedCaseId || null);
      const { error } = await supabase.from("tool_results").insert({
        tool_name: tool.id,
        status: result.status ?? "success",
        case_id: selectedCaseId || null,
        user_id: user.id,
        result_data: { inputs: Object.fromEntries(Object.entries(inputs).filter(([key]) => !tool.fields.some(field => field.key === key && field.type === "file") && !(tool.id === "network-forensics" && key === "har_json"))), uploaded_files: uploadedFiles, ...result, ...(personId ? { persona_id: personId } : {}) } as unknown as Json,
      });
      if (error) throw error;
      setSaved(true);
      toast.success(personId ? "Findings saved to this person" : "Result saved to investigation");
      onSaved?.();
    } catch (err: unknown) {
      const message = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "Failed to save";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} aria-label={personId ? "Back to dossier" : "Back to tools"} className="p-1.5 rounded hover:bg-secondary transition-colors">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <tool.icon className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h2 className="font-display text-lg font-bold tracking-tight">{tool.name}</h2>
          <p className="text-xs text-muted-foreground">{tool.description}</p>
        </div>
        {/* Usage indicator for limited plans */}
        {accountReady && perms && perms.maxToolRunsPerDay !== -1 && (
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
      {executionError && <div role="alert" className="border border-destructive p-3 text-sm text-destructive">Execution failed: {executionError}</div>}
      {!accountReady && <div className="space-y-2">
        <p role={accountError ? "alert" : "status"} className="text-sm text-muted-foreground">{accountChecking ? "Checking account access…" : accountError ? `Account access verification failed: ${accountError}` : !user ? "Sign in to execute tools." : "Account access could not be verified."}</p>
        {user && !accountChecking && <Button variant="outline" size="sm" onClick={() => void refreshAccountAccess()}>Refresh account access</Button>}
      </div>}
      {tool.integration && <GlassPanel className="p-4 space-y-2">
        <p className="text-sm font-medium">Data source: {tool.integration.provider}</p>
        <p className="text-xs text-muted-foreground">{tool.integration.scope}</p>
        {providerChecking ? <p role="status" className="text-xs">Checking provider configuration…</p> : providerError ? <p role="alert" className="text-xs text-destructive">{providerError}</p> : !providerStatus?.configured ? <p role="status" className="text-xs text-destructive">{providerStatus?.coverage || "Provider setup is required."}{providerStatus?.missing_secrets.length ? ` Missing setup: ${providerStatus.missing_secrets.join(", ")}.` : ""} No provider request has been made.</p> : <p role="status" className="text-xs">Provider configuration is present. Availability, entitlements and returned fields will be checked when you execute.</p>}
        {!providerChecking && <Button variant="outline" size="sm" onClick={() => setProviderRefresh(value => value + 1)}>Recheck configuration</Button>}
      </GlassPanel>}

      {/* Input form */}
      <GlassPanel className="p-5" neonLine="top">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground mb-3 block">INPUT PARAMETERS</span>
        <form onSubmit={handleRun} className="space-y-3">
          {tool.fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <label htmlFor={`tool-input-${f.key}`} className="font-mono text-[10px] tracking-widest text-muted-foreground">{f.label}</label>
              {f.type === "file" ? <>
                <input id={`tool-input-${f.key}`} type="file" required={f.required} accept={f.accept} disabled={Boolean(readingFiles[f.key]) || running} onChange={event => void uploadFile(f, event.target.files?.[0])} className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground" />
                <p role="status" className="text-xs text-muted-foreground">{readingFiles[f.key] ? "Reading file…" : uploadedFiles[f.key] || `Maximum ${Math.round((f.maxFileBytes || MAX_UPLOAD_BYTES) / 1024 / 1024)} MiB. Analysis uses the selected bytes.`}</p>
              </> : f.type === "textarea" ? (
                <textarea
                  id={`tool-input-${f.key}`}
                  required={f.required}
                  placeholder={f.placeholder}
                  value={inputs[f.key] ?? ""}
                  onChange={(e) => changeInput(f.key, e.target.value)}
                  rows={5}
                  maxLength={50000}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono"
                />
              ) : f.type === "select" ? (
                <select
                  id={`tool-input-${f.key}`}
                  value={inputs[f.key] ?? f.options?.[0]?.value ?? ""}
                  onChange={(e) => changeInput(f.key, e.target.value)}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={`tool-input-${f.key}`}
                  type="text"
                  required={f.required}
                  placeholder={f.placeholder}
                  value={inputs[f.key] ?? ""}
                  onChange={(e) => changeInput(f.key, e.target.value)}
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

          <Button type="submit" variant="neon" size="sm" disabled={!accountReady || running || rateLimited || Object.values(readingFiles).some(Boolean) || Boolean(tool.integration && (providerChecking || providerError || !providerStatus?.configured))} className="w-full">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
            {running ? "PROCESSING..." : "EXECUTE"}
          </Button>
        </form>
      </GlassPanel>

      {/* Results */}
      {['telegram-monitor','flight-tracking','cve-tracker','threat-feed','social-media-scanner','geofence-alert'].includes(tool.id) && <Button asChild variant="outline"><Link to={`/monitoring?kind=${({'telegram-monitor':'telegram','flight-tracking':'adsb','cve-tracker':'cve','threat-feed':'threat_feed','social-media-scanner':'social_account','geofence-alert':'geofence'} as Record<string,string>)[tool.id]}`}>{tool.id==='geofence-alert'?'Configure position feed and polygon rules':'Configure continuous monitoring'}</Link></Button>}
      {result && (
        <GlassPanel className="p-5 space-y-4" neonLine="left" glow="blue">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">RESULTS · {result.status?.toUpperCase() ?? "SUCCESS"}</span>
              <p className="text-sm font-medium mt-1">{result.summary}</p>
              <p className="text-xs font-mono mt-1">Status: {result.status ?? "success"}</p>
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

          {tool.id.startsWith("pdl-person-") && <PdlContactResults data={result.details} />}
          {['public-records','property-records'].includes(tool.id) && <PublicRecordResults details={result.details} />}
          {tool.id==='public-records' && typeof result.details.next==='string' && <Button variant="outline" disabled={running} onClick={e=>{const nextInputs={...inputs,cursor:String(result.details.next)};setInputs(nextInputs);void handleRun(e,nextInputs);}}>Next court results</Button>}
          {tool.id==='streetview-compare' && <StreetComparison details={result.details} />}
          {personId && ['vin-decoder','vehicle-lookup'].includes(tool.id) && <VehicleResultFields details={result.details} />}
          {personId ? <details className="rounded border border-border p-3"><summary className="text-sm cursor-pointer">Original source response</summary><pre className="text-xs whitespace-pre-wrap break-words overflow-auto max-h-[500px] mt-3">{JSON.stringify(result.details,null,2)}</pre></details> : <pre className="bg-background/60 border border-border rounded p-4 text-xs font-mono text-secondary-foreground whitespace-pre-wrap break-words max-h-[500px] overflow-auto">
            {JSON.stringify(result.details, null, 2)}
          </pre>}

          {/* Save to investigation */}
          <div className="border-t border-border/50 pt-4 space-y-3">
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{personId ? "SAVE TO THIS PERSON'S EVIDENCE" : "SAVE TO INVESTIGATION"}</span>
            <div className="flex items-center gap-2">
              {!personId && <select
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                className="flex-1 bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">No case (standalone)</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>}
              <Button
                variant="neon"
                size="sm"
                onClick={handleSave}
                disabled={!accountReady || saving || saved}
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
