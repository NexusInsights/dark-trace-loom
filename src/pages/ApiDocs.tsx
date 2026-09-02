import { useState } from "react";
import { GlassPanel, AnalysisPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { checkFeatureGate } from "@/lib/planGating";
import { UpgradePrompt } from "@/components/tools/UpgradePrompt";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Copy, Key, Plus, Trash2, Eye, EyeOff, Loader2, BarChart3,
} from "lucide-react";

const endpoints = [
  { method: "GET", path: "/v1/cases", desc: "List all your cases" },
  { method: "GET", path: "/v1/cases/:id", desc: "Retrieve a specific case" },
  { method: "POST", path: "/v1/subjects", desc: "Submit a subject for investigation" },
  { method: "POST", path: "/v1/tools/run", desc: "Run an OSINT tool" },
  { method: "GET", path: "/v1/reports", desc: "List investigation reports" },
  { method: "GET", path: "/v1/reports/:id", desc: "Retrieve a specific report" },
  { method: "GET", path: "/v1/artifacts?case_id=", desc: "Fetch case artifacts" },
  { method: "GET", path: "/v1/entities", desc: "List all resolved entities" },
  { method: "GET", path: "/v1/entities/:id", desc: "Get entity details" },
  { method: "GET", path: "/v1/relationships?entity_id=", desc: "Get entity relationship links" },
  { method: "GET", path: "/v1/graph?case_id=", desc: "Export full relationship graph (nodes + edges)" },
  { method: "GET", path: "/v1/scores?min_score=", desc: "Retrieve entity risk scores" },
  { method: "GET", path: "/v1/analysis?case_id=", desc: "Get AI analysis reports for a case" },
  { method: "GET", path: "/v1/breaches?entity_id=", desc: "Get breach intelligence records" },
];

const methodColor: Record<string, string> = {
  GET: "text-success",
  POST: "text-info",
  PUT: "text-warning",
  DELETE: "text-destructive",
};

// API keys are generated server-side with a CSPRNG in the `api-keys` edge function.


export default function ApiDocsPage() {
  const { user } = useAuth();
  const { plan } = useSubscription();
  const qc = useQueryClient();
  const gate = checkFeatureGate(plan, "hasApiAccess");

  const [newLabel, setNewLabel] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const { data: apiKeys = [], isLoading: keysLoading } = useQuery({
    queryKey: ["api-keys", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: usageStats = [] } = useQuery({
    queryKey: ["api-usage-stats", user?.id],
    enabled: !!user && apiKeys.length > 0,
    queryFn: async () => {
      const keyIds = apiKeys.map((k) => k.id);
      const { data, error } = await supabase
        .from("api_usage")
        .select("key_id, endpoint, timestamp")
        .in("key_id", keyIds)
        .order("timestamp", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const createKey = useMutation({
    mutationFn: async (label: string) => {
      const { data, error } = await supabase.functions.invoke("api-keys", {
        body: { label: label || "Default", plan },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.key as string;
    },

    onSuccess: (key) => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setNewLabel("");
      toast.success("API key created. Copy it now — it won't be shown again in full.");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const deleteKey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("api_keys").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key revoked.");
    },
  });

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const maskKey = (key: string) => key.slice(0, 10) + "•".repeat(20) + key.slice(-4);

  const todayUsage = usageStats.filter(
    (u) => new Date(u.timestamp).toDateString() === new Date().toDateString()
  ).length;

  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-gateway`;

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-6">
      <div>
        <span className="intel-tag intel-tag-blue mb-3 inline-block">v1.0</span>
        <h1 className="text-2xl font-display font-bold tracking-tight">API Access</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage API keys and integrate programmatic intelligence gathering
        </p>
      </div>

      {!gate.allowed && (
        <UpgradePrompt reason={gate.reason!} requiredPlan={gate.requiredPlan!} />
      )}

      <div className={!gate.allowed ? "opacity-50 pointer-events-none" : ""}>
        {/* API Keys Management */}
        <GlassPanel neonLine="top" className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold flex items-center gap-2">
              <Key className="h-4 w-4 text-primary" /> API Keys
            </h3>
            <span className="font-mono text-[10px] text-muted-foreground">
              {apiKeys.length} KEY{apiKeys.length !== 1 ? "S" : ""}
            </span>
          </div>

          {/* Create key */}
          <div className="flex gap-2">
            <Input
              placeholder="Key label (e.g. Production)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="text-xs h-8"
            />
            <Button
              variant="neon"
              size="sm"
              className="gap-1.5 shrink-0"
              disabled={createKey.isPending}
              onClick={() => createKey.mutate(newLabel)}
            >
              {createKey.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              CREATE KEY
            </Button>
          </div>

          {/* Key list */}
          {keysLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : apiKeys.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4 font-mono">
              No API keys yet. Create one to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center gap-3 bg-background/40 border border-border/50 rounded-md px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{k.label}</span>
                      <span className="intel-tag intel-tag-muted text-[8px]">{k.plan.toUpperCase()}</span>
                      {!k.active && (
                        <span className="intel-tag text-[8px] bg-destructive/20 text-destructive">REVOKED</span>
                      )}
                    </div>
                    <code className="text-[10px] font-mono text-muted-foreground block mt-0.5">
                      {revealedKeys.has(k.id) ? k.key : maskKey(k.key)}
                    </code>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => toggleReveal(k.id)}
                  >
                    {revealedKeys.has(k.id) ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(k.key);
                      toast.success("Copied to clipboard");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => deleteKey.mutate(k.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>

        {/* Usage Stats */}
        <AnalysisPanel title="Usage Today" badge="METRICS" className="mt-6">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="font-mono text-muted-foreground mb-1">REQUESTS TODAY</p>
              <p className="font-display text-lg font-bold">{todayUsage}</p>
            </div>
            <div>
              <p className="font-mono text-muted-foreground mb-1">TOTAL KEYS</p>
              <p className="font-display text-lg font-bold text-primary">{apiKeys.filter((k) => k.active).length}</p>
            </div>
            <div>
              <p className="font-mono text-muted-foreground mb-1">PLAN LIMIT</p>
              <p className="font-display text-lg font-bold text-accent">
                {plan === "enterprise" ? "Unlimited" : plan === "professional" || plan === "team" ? "10,000" : "100"}
              </p>
              <p className="text-muted-foreground">requests/day</p>
            </div>
          </div>
        </AnalysisPanel>

        {/* Auth docs */}
        <GlassPanel neonLine="top" className="p-5 mt-6">
          <h3 className="font-display text-sm font-semibold mb-3">Authentication</h3>
          <p className="text-xs text-muted-foreground mb-3">Include your API key in the request header:</p>
          <div className="bg-background/60 border border-border rounded-md p-3 font-mono text-xs space-y-2">
            <code className="block">x-api-key: {"<your-api-key>"}</code>
            <span className="text-muted-foreground text-[10px]">or</span>
            <code className="block">Authorization: Bearer {"<your-api-key>"}</code>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 font-mono">
            BASE URL: {baseUrl}
          </p>
        </GlassPanel>

        {/* Rate limits */}
        <AnalysisPanel title="Rate Limits" badge="IMPORTANT" className="mt-6">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="font-mono text-muted-foreground mb-1">FREE</p>
              <p className="font-display text-lg font-bold">100</p>
              <p className="text-muted-foreground">requests/day</p>
            </div>
            <div>
              <p className="font-mono text-muted-foreground mb-1">PROFESSIONAL</p>
              <p className="font-display text-lg font-bold text-primary">10,000</p>
              <p className="text-muted-foreground">requests/day</p>
            </div>
            <div>
              <p className="font-mono text-muted-foreground mb-1">ENTERPRISE</p>
              <p className="font-display text-lg font-bold text-accent">Unlimited</p>
              <p className="text-muted-foreground">requests/day</p>
            </div>
          </div>
        </AnalysisPanel>

        {/* Endpoints */}
        <GlassPanel className="overflow-hidden mt-6">
          <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold">Endpoints</h3>
            <span className="intel-tag intel-tag-muted">{endpoints.length} ROUTES</span>
          </div>
          {endpoints.map((ep, i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-4 py-3.5 border-b border-border/30 last:border-0 hover:bg-secondary/30 transition-colors"
            >
              <span className={`font-mono text-[10px] tracking-wider font-bold w-10 ${methodColor[ep.method]}`}>
                {ep.method}
              </span>
              <code className="font-mono text-xs text-foreground flex-1">{ep.path}</code>
              <span className="text-xs text-muted-foreground hidden md:block">{ep.desc}</span>
            </div>
          ))}
        </GlassPanel>

        {/* Example requests */}
        <GlassPanel neonLine="top" className="p-5 mt-6 space-y-4">
          <h3 className="font-display text-sm font-semibold">Example Requests</h3>

          <div>
            <p className="font-mono text-[10px] text-muted-foreground mb-1">LIST CASES</p>
            <pre className="bg-background/60 border border-border rounded-md p-3 font-mono text-[11px] overflow-x-auto">
{`curl -H "x-api-key: YOUR_KEY" \\
  ${baseUrl}/v1/cases`}
            </pre>
          </div>

          <div>
            <p className="font-mono text-[10px] text-muted-foreground mb-1">SUBMIT SUBJECT</p>
            <pre className="bg-background/60 border border-border rounded-md p-3 font-mono text-[11px] overflow-x-auto">
{`curl -X POST -H "x-api-key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"case_id":"...","name":"John Doe","type":"person"}' \\
  ${baseUrl}/v1/subjects`}
            </pre>
          </div>

          <div>
            <p className="font-mono text-[10px] text-muted-foreground mb-1">RUN OSINT TOOL</p>
            <pre className="bg-background/60 border border-border rounded-md p-3 font-mono text-[11px] overflow-x-auto">
{`curl -X POST -H "x-api-key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"tool_name":"domain_lookup","case_id":"...","input":{"domain":"example.com"}}' \\
  ${baseUrl}/v1/tools/run`}
            </pre>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
