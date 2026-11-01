import { useEffect, useRef, useState } from "react";
import { Fingerprint, Cookie, Globe, ShieldCheck, UserSearch, Network, Brain, Loader2 } from "lucide-react";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useUsageTracking } from "@/hooks/useUsageTracking";
import { checkToolExecutionGate, getPlanPermissions } from "@/lib/planGating";
import { captureFingerprint, getVisitorTracking, enableVisitorTracking, disableVisitorTracking } from "@/features/intelligence/browser-client.js";
import { exampleDataset, trainClassifier } from "@/features/intelligence/classifier.js";
import { runIntelligenceAction, type IntelligenceAction } from "@/features/intelligence/api";

type ClassifierSession = Awaited<ReturnType<typeof trainClassifier>>;
type Outcome = { data?: unknown; error?: string };
const cookieNamespace = "insightnexus_visitor";

const remoteTools: { action: IntelligenceAction; title: string; icon: typeof Globe; label: string; placeholder: string; field: string; description: string }[] = [
  { action: "ipinfo", title: "IPinfo geolocation", icon: Globe, label: "Public IP address", placeholder: "8.8.8.8", field: "ip", description: "Look up an explicit IP address. IP location is approximate and describes a network address." },
  { action: "breach", title: "Have I Been Pwned", icon: ShieldCheck, label: "Email address", placeholder: "name@example.com", field: "email", description: "Check breach exposure through the configured server-side HIBP account. No matching records is distinct from an unavailable lookup." },
  { action: "profile", title: "X public profile", icon: UserSearch, label: "X username", placeholder: "username", field: "username", description: "Extract a public profile's name, biography and listed location using the configured browser worker." },
  { action: "onion", title: "Tor onion reader", icon: Network, label: "Onion page URL", placeholder: "http://…onion/", field: "url", description: "Read one onion page through the worker's configured Tor proxy. Content is displayed as text." },
];

function Result({ outcome }: { outcome?: Outcome }) {
  if (!outcome) return null;
  if (outcome.error) return <p role="alert" className="text-sm text-destructive break-words">{outcome.error}</p>;
  return <pre aria-label="Tool result" className="rounded border border-border bg-secondary/40 p-3 text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto">{JSON.stringify(outcome.data, null, 2)}</pre>;
}

export default function IntelligenceLab() {
  const { user } = useAuth();
  const { plan, loading: subscriptionLoading } = useSubscription();
  const { dailyTotal, loading: usageLoading, refresh } = useUsageTracking();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [fingerprintConsent, setFingerprintConsent] = useState(false);
  const [cookieConsent, setCookieConsent] = useState(false);
  const [tracking, setTracking] = useState<{ enabled: boolean; visitorId: string | null; error?: string }>(() => {
    try { return getVisitorTracking(cookieNamespace); }
    catch (error) { return { enabled: false, visitorId: null, error: error instanceof Error ? error.message : "Browser storage is unavailable." }; }
  });
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [datasetText, setDatasetText] = useState("");
  const [predictionText, setPredictionText] = useState("");
  const [progress, setProgress] = useState("");
  const [featureNames, setFeatureNames] = useState<string[]>([]);
  const classifier = useRef<ClassifierSession | null>(null);
  const training = useRef<AbortController | null>(null);
  const cookieIntent = useRef(0);
  const mounted = useRef(true);
  const locked = Boolean(busy) || subscriptionLoading || usageLoading;
  const maxRuns = getPlanPermissions(plan).maxToolRunsPerDay;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; training.current?.abort(); classifier.current?.dispose(); };
  }, []);

  const show = (id: string, outcome: Outcome) => { if (mounted.current) setOutcomes((current) => ({ ...current, [id]: outcome })); };

  async function authorize(id: string) {
    if (!user) throw new Error("Sign in to use intelligence tools.");
    const gate = checkToolExecutionGate(plan, dailyTotal);
    if (!gate.allowed) throw new Error(gate.reason);
    const { data, error } = await supabase.from("tool_permissions").select("allowed")
      .eq("user_id", user.id).in("tool_id", ["intelligence-lab", `intelligence-${id}`]);
    if (error) throw new Error("Tool permissions could not be verified.");
    if (data?.some((row) => row.allowed === false)) throw new Error("An administrator has disabled this tool for your account.");
  }

  async function recordLocal(id: string) {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tool = `intelligence-${id}`;
    const { data: existing, error: readError } = await supabase.from("usage_metrics").select("id, executions")
      .eq("user_id", user!.id).eq("tool_name", tool).eq("period_start", day.toISOString()).maybeSingle();
    if (readError) throw new Error("The local operation completed, but tool usage could not be read.");
    const result = existing
      ? await supabase.from("usage_metrics").update({ executions: (existing.executions || 0) + 1 }).eq("id", existing.id)
      : await supabase.from("usage_metrics").insert({ user_id: user!.id, tool_name: tool, executions: 1, period_start: day.toISOString(), period_end: new Date(day.getTime() + 86400000).toISOString() });
    if (result.error) throw new Error("The local operation completed, but tool usage could not be recorded.");
    await refresh();
  }

  async function execute(id: string, operation: () => Promise<unknown> | unknown, local = true) {
    if (locked) return;
    setBusy(id);
    show(id, {});
    try {
      await authorize(id);
      if (!mounted.current) return;
      const data = await operation();
      if (!mounted.current) return;
      if (local) await recordLocal(id); else await refresh();
      show(id, { data });
    } catch (error) { if (id === "classifier" && mounted.current) setProgress("Training stopped."); show(id, { error: error instanceof Error ? error.message : "This operation could not be completed." }); }
    finally { if (mounted.current) setBusy(null); }
  }

  function startTraining() {
    if (locked) return;
    // Create the controller before the asynchronous account check so Cancel is
    // effective as soon as its button appears.
    const controller = new AbortController();
    training.current = controller;
    void execute("classifier", async () => {
      if (controller.signal.aborted) throw new Error("Training was cancelled.");
      const data = JSON.parse(datasetText);
      if (mounted.current) setProgress("Training started…");
      const trained = await trainClassifier(data, {
        epochs: 10, batchSize: 32, signal: controller.signal,
        onEpoch: (epoch: number) => { if (mounted.current && !controller.signal.aborted) setProgress(`Epoch ${epoch} of 10`); },
      });
      // A completed fit may resolve after cancellation or navigation. Never
      // retain that model in a page that no longer owns it.
      if (controller.signal.aborted || !mounted.current) {
        trained.dispose();
        throw new Error("Training was cancelled.");
      }
      classifier.current?.dispose(); classifier.current = trained;
      setFeatureNames(trained.featureNames); setProgress("Training and held-out evaluation complete.");
      return { source: data.synthetic ? "synthetic example" : "uploaded labeled data", metrics: trained.metrics, featureNames: trained.featureNames };
    }).finally(() => { if (training.current === controller) training.current = null; });
  }

  function resetClassifier(text: string) {
    classifier.current?.dispose();
    classifier.current = null;
    setDatasetText(text);
    setFeatureNames([]);
    setProgress("");
    setOutcomes((current) => ({ ...current, classifier: {}, prediction: {} }));
  }

  async function uploadDataset(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Choose a JSON dataset smaller than 2 MB.");
      resetClassifier(await file.text());
    } catch (error) { show("classifier", { error: error instanceof Error ? error.message : "The dataset file could not be read." }); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <header className="space-y-2">
        <span className="intel-tag intel-tag-blue">7 INTEGRATED FEATURES</span>
        <h1 className="text-2xl font-display font-bold">Intelligence Lab</h1>
        <p className="text-sm text-muted-foreground">Run browser collection, sourced lookups and a labeled outcome classifier. Every operation starts with your action.</p>
        <p className="text-xs text-muted-foreground">Tool use today: {dailyTotal}{maxRuns === -1 ? "" : ` / ${maxRuns}`}. Provider tools use the authenticated backend and configured intelligence worker.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <GlassPanel className="p-5 space-y-4 min-w-0">
          <h2 className="font-display font-semibold flex items-center gap-2"><Fingerprint className="h-4 w-4 text-primary" />Browser fingerprint</h2>
          <p className="text-sm text-muted-foreground">Capture this browser's characteristics. The fingerprint is a browser identifier, not a verified person's identity.</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={fingerprintConsent} onChange={(event) => setFingerprintConsent(event.target.checked)} disabled={locked} className="mt-1" />I agree to capture a fingerprint of this browser.</label>
          <Button disabled={locked || !fingerprintConsent} onClick={() => execute("fingerprint", captureFingerprint)}>{busy === "fingerprint" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Capture fingerprint</Button>
          <Result outcome={outcomes.fingerprint} />
        </GlassPanel>

        <GlassPanel className="p-5 space-y-4 min-w-0">
          <h2 className="font-display font-semibold flex items-center gap-2"><Cookie className="h-4 w-4 text-primary" />Cookie tracking</h2>
          <p className="text-sm text-muted-foreground">Remember this browser with a unique first-party ID for up to one year. This does not identify visitors on unrelated websites.</p>
          <p className="text-sm" role="status">{tracking.error ? "Tracking status is unavailable." : tracking.enabled ? `Enabled: ${tracking.visitorId}` : "Tracking is disabled."}</p>
          {tracking.error && <p role="alert" className="text-sm text-destructive">{tracking.error}</p>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={cookieConsent} onChange={(event) => setCookieConsent(event.target.checked)} disabled={locked} className="mt-1" />I agree to remember this browser.</label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={locked || !cookieConsent} onClick={() => { const intent = ++cookieIntent.current; execute("cookie", () => { if (intent !== cookieIntent.current) throw new Error("Tracking permission was withdrawn; tracking was not enabled."); const next = enableVisitorTracking(cookieNamespace); setTracking(next); return next; }); }}>Enable tracking</Button>
            <Button variant="outline" onClick={() => { cookieIntent.current++; try { setTracking(disableVisitorTracking(cookieNamespace)); setCookieConsent(false); show("cookie", { data: { enabled: false } }); } catch (error) { show("cookie", { error: error instanceof Error ? error.message : "The cookie could not be removed." }); } }}>Remove tracking cookie</Button>
          </div>
          <Result outcome={outcomes.cookie} />
        </GlassPanel>

        {remoteTools.map((tool) => (
          <GlassPanel key={tool.action} className="p-5 space-y-4 min-w-0">
            <h2 className="font-display font-semibold flex items-center gap-2"><tool.icon className="h-4 w-4 text-primary" />{tool.title}</h2>
            <p className="text-sm text-muted-foreground">{tool.description}</p>
            {tool.action === "breach" && <p className="text-sm text-muted-foreground">Breach data supplied by <a className="underline" href="https://haveibeenpwned.com/" target="_blank" rel="noreferrer">Have I Been Pwned</a>.</p>}
            {tool.action === "ipinfo" && <p className="text-sm text-muted-foreground">IP address data supplied by <a className="underline" href="https://ipinfo.io/" target="_blank" rel="noreferrer">IPinfo</a>.</p>}
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); execute(tool.action, () => runIntelligenceAction(tool.action, { [tool.field]: inputs[tool.action]?.trim() || "" }), false); }}>
              <label htmlFor={`intelligence-${tool.action}`} className="block text-sm">{tool.label}</label>
              <input id={`intelligence-${tool.action}`} type={tool.action === "breach" ? "email" : "text"} required maxLength={2048} value={inputs[tool.action] || ""} disabled={locked} placeholder={tool.placeholder} onChange={(event) => setInputs((current) => ({ ...current, [tool.action]: event.target.value }))} className="w-full min-w-0 rounded border border-border bg-secondary px-3 py-2 text-sm" />
              <Button type="submit" disabled={locked}>{busy === tool.action && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Run {tool.title}</Button>
            </form>
            <Result outcome={outcomes[tool.action]} />
          </GlassPanel>
        ))}

        <GlassPanel className="p-5 space-y-4 min-w-0 md:col-span-2">
          <h2 className="font-display font-semibold flex items-center gap-2"><Brain className="h-4 w-4 text-primary" />TensorFlow outcome classifier</h2>
          <p className="text-sm text-muted-foreground">Train on your labeled data, evaluate on a separate held-out set, then predict an outcome. The model learns the supplied labels; it does not establish that a message causes persuasion. Training stays in this browser.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">Upload dataset JSON<input aria-label="Upload dataset JSON" type="file" accept="application/json,.json" disabled={locked} onChange={(event) => { void uploadDataset(event.target.files?.[0]); event.target.value = ""; }} className="block mt-1 text-xs max-w-full" /></label>
            <Button variant="outline" disabled={locked} onClick={() => resetClassifier(JSON.stringify(exampleDataset(), null, 2))}>Load synthetic example</Button>
          </div>
          <label htmlFor="classifier-dataset" className="block text-sm">Labeled dataset JSON</label>
          <p className="text-xs text-muted-foreground">Use featureNames and 20–5,000 samples, each with a numeric features array and a binary label (0 or 1). Both classes are required. The example is synthetic test data.</p>
          <textarea id="classifier-dataset" rows={9} maxLength={2_000_000} disabled={locked} value={datasetText} onChange={(event) => resetClassifier(event.target.value)} placeholder={'{"featureNames":["clarity","relevance"],"samples":[{"features":[0.2,0.8],"label":1}, …]}'} className="w-full min-w-0 rounded border border-border bg-secondary px-3 py-2 text-xs font-mono" />
          <div className="flex flex-wrap gap-2">
            <Button disabled={locked || !datasetText.trim()} onClick={startTraining}>{busy === "classifier" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Train and evaluate</Button>
            {busy === "classifier" && <Button variant="outline" onClick={() => training.current?.abort()}>Cancel training</Button>}
          </div>
          {progress && <p role="status" className="text-sm text-muted-foreground">{progress}</p>}
          <Result outcome={outcomes.classifier} />
          <form className="space-y-3 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); execute("prediction", async () => { if (!classifier.current) throw new Error("Train a model first."); const features = JSON.parse(predictionText); return { featureNames: classifier.current.featureNames, ...(await classifier.current.predict(features)) }; }); }}>
            <label htmlFor="classifier-features" className="block text-sm">Prediction features {featureNames.length > 0 && `(${featureNames.join(", ")})`}</label>
            <input id="classifier-features" required maxLength={4096} disabled={locked || !classifier.current} value={predictionText} onChange={(event) => setPredictionText(event.target.value)} placeholder="[0.2, 0.8]" className="w-full min-w-0 rounded border border-border bg-secondary px-3 py-2 text-sm font-mono" />
            <Button type="submit" disabled={locked || !classifier.current}>Predict outcome</Button>
          </form>
          <Result outcome={outcomes.prediction} />
        </GlassPanel>
      </div>
    </div>
  );
}
