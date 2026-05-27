import { useState } from "react";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useCases } from "@/hooks/useInvestigationData";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { checkFeatureGate } from "@/lib/planGating";
import { UpgradePrompt } from "@/components/tools/UpgradePrompt";
import { generateEvidenceBundle, type BundleFormat, type BundleManifest } from "@/lib/evidenceBundleEngine";
import { getReportDownloadUrl } from "@/lib/reportEngine";
import { toast } from "sonner";
import {
  Briefcase, Download, Loader2, FileText, Archive, ShieldCheck,
  Hash, Clock, Users, Package, Trash2, CheckCircle2,
} from "lucide-react";

const FORMAT_OPTIONS: { id: BundleFormat; label: string; description: string; icon: typeof Archive }[] = [
  { id: "zip", label: "Evidence Archive", description: "Text archive with all artifacts, metadata, chain-of-custody, and verification hashes", icon: Archive },
  { id: "legal-pdf", label: "Legal Evidence PDF", description: "Formatted document suitable for court proceedings with integrated integrity verification", icon: FileText },
];

export default function EvidenceExportPage() {
  const { user } = useAuth();
  const { plan } = useSubscription();
  const { data: cases = [], isLoading: casesLoading } = useCases();

  const [selectedCase, setSelectedCase] = useState("");
  const [selectedFormat, setSelectedFormat] = useState<BundleFormat>("legal-pdf");
  const [generating, setGenerating] = useState(false);
  const [progressStep, setProgressStep] = useState("");
  const [lastResult, setLastResult] = useState<{ url: string; manifest: BundleManifest } | null>(null);

  const exportGate = checkFeatureGate(plan, "canExportReports");

  // Past bundles
  const { data: pastBundles = [], refetch: refetchBundles } = useQuery({
    queryKey: ["evidence-bundles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("user_id", user!.id)
        .like("report_type", "evidence-bundle-%")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleGenerate = async () => {
    if (!user || !selectedCase) {
      toast.error("Select a case first");
      return;
    }
    if (!exportGate.allowed) return;

    setGenerating(true);
    setLastResult(null);
    try {
      const result = await generateEvidenceBundle(
        selectedCase, user.id, selectedFormat,
        (step) => setProgressStep(step)
      );
      setLastResult({ url: result.downloadUrl, manifest: result.manifest });
      refetchBundles();
      toast.success("Evidence bundle generated successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bundle generation failed");
    } finally {
      setGenerating(false);
      setProgressStep("");
    }
  };

  const handleDownload = async (filePath: string) => {
    try {
      const url = await getReportDownloadUrl(filePath);
      if (url) window.open(url, "_blank");
    } catch {
      toast.error("Failed to get download link");
    }
  };

  const handleDelete = async (reportId: string, filePath: string | null) => {
    try {
      if (filePath) await supabase.storage.from("reports").remove([filePath]);
      await supabase.from("reports").delete().eq("id", reportId);
      refetchBundles();
      toast.success("Bundle deleted");
    } catch {
      toast.error("Failed to delete bundle");
    }
  };

  const caseTitle = (caseId: string) =>
    cases.find((c) => c.id === caseId)?.title ?? caseId.slice(0, 8);

  const selectedCaseData = cases.find((c) => c.id === selectedCase);

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in space-y-8">
      {/* Header */}
      <div>
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Evidence</span>
        <h1 className="text-2xl font-display font-bold tracking-tight mt-1">Legal Evidence Export</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate court-ready evidence bundles with chain-of-custody documentation and integrity verification.
        </p>
      </div>

      {!exportGate.allowed && (
        <UpgradePrompt reason={exportGate.reason!} requiredPlan={exportGate.requiredPlan!} />
      )}

      <div className={!exportGate.allowed ? "opacity-50 pointer-events-none" : ""}>
        {/* Case Selector */}
        <GlassPanel className="p-5 space-y-4" neonLine="top">
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">1 — SELECT INVESTIGATION</span>
          {casesLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : cases.length === 0 ? (
            <p className="text-xs text-muted-foreground">No cases found. Create an investigation first.</p>
          ) : (
            <select
              value={selectedCase}
              onChange={(e) => { setSelectedCase(e.target.value); setLastResult(null); }}
              className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Choose a case...</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          )}
          {selectedCaseData && (
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground font-mono">
              <span>ID: {selectedCaseData.id.slice(0, 8)}</span>
              <span>Created: {new Date(selectedCaseData.created_at).toLocaleDateString()}</span>
            </div>
          )}
        </GlassPanel>

        {/* Format Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          {FORMAT_OPTIONS.map((f) => {
            const isSelected = selectedFormat === f.id;
            const Icon = f.icon;
            return (
              <GlassPanel
                key={f.id}
                className={`p-4 cursor-pointer transition-all ${
                  isSelected ? "ring-2 ring-primary glow-blue" : "hover:border-primary/20"
                }`}
              >
                <button onClick={() => setSelectedFormat(f.id)} className="w-full text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold">{f.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{f.description}</p>
                </button>
              </GlassPanel>
            );
          })}
        </div>

        {/* Bundle Contents Preview */}
        <GlassPanel className="p-5 mt-4" neonLine="left">
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground mb-3 block">BUNDLE CONTENTS</span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: Package, label: "Artifact Files", desc: "All evidence artifacts with metadata" },
              { icon: ShieldCheck, label: "Chain of Custody", desc: "Full custody log with hashes" },
              { icon: Clock, label: "Timeline Report", desc: "Chronological event timeline" },
              { icon: Users, label: "Subject Profiles", desc: "Intelligence on all subjects" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2 p-2 rounded bg-secondary/50">
                <item.icon className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div>
                  <span className="text-[10px] font-semibold block">{item.label}</span>
                  <span className="text-[9px] text-muted-foreground">{item.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3 p-2 rounded bg-primary/5 border border-primary/10">
            <Hash className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] text-muted-foreground">
              Each bundle includes a SHA-256 verification hash for tamper detection
            </span>
          </div>
        </GlassPanel>

        {/* Generate Button */}
        <GlassPanel className="p-5 mt-4 space-y-4" neonLine="left">
          {generating && progressStep && (
            <div className="flex items-center gap-2 text-xs text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="font-mono text-[10px]">{progressStep}</span>
            </div>
          )}

          <Button
            variant="neon"
            size="sm"
            className="w-full gap-2"
            disabled={generating || !selectedCase}
            onClick={handleGenerate}
          >
            {generating ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />GENERATING BUNDLE...</>
            ) : (
              <><Briefcase className="h-3.5 w-3.5" />GENERATE EVIDENCE BUNDLE</>
            )}
          </Button>

          {lastResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-primary">
                <CheckCircle2 className="h-4 w-4" />
                <span>Bundle generated successfully</span>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => window.open(lastResult.url, "_blank")}
              >
                <Download className="h-3.5 w-3.5" />
                DOWNLOAD BUNDLE
              </Button>

              {/* Verification Hash Display */}
              <div className="p-3 rounded bg-secondary/50 border border-border">
                <span className="font-mono text-[9px] tracking-widest text-muted-foreground block mb-1">
                  VERIFICATION HASH (SHA-256)
                </span>
                <code className="text-[10px] text-primary break-all font-mono">
                  {lastResult.manifest.verificationHash}
                </code>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground">
                <div>Bundle ID: {lastResult.manifest.bundleId.slice(0, 12)}</div>
                <div>Artifacts: {lastResult.manifest.contents.artifacts}</div>
                <div>Evidence Logs: {lastResult.manifest.contents.evidenceLogs}</div>
                <div>Events: {lastResult.manifest.contents.events}</div>
              </div>
            </div>
          )}
        </GlassPanel>
      </div>

      {/* Past Bundles */}
      {pastBundles.length > 0 && (
        <div className="space-y-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            Generated Bundles
          </span>
          {pastBundles.map((r) => {
            const meta = r.metadata as Record<string, unknown> | null;
            const isLegalPdf = r.report_type === "evidence-bundle-legal-pdf";
            return (
              <GlassPanel key={r.id} className="p-4">
                <div className="flex items-center gap-3">
                  {isLegalPdf ? (
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                  ) : (
                    <Archive className="h-4 w-4 text-primary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">
                        {isLegalPdf ? "Legal Evidence PDF" : "Evidence Archive"}
                      </span>
                      <span className="intel-tag intel-tag-blue text-[8px]">
                        {isLegalPdf ? "PDF" : "ARCHIVE"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                      <span>Case: {caseTitle(r.case_id)}</span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                      {r.file_size && <span>{(r.file_size / 1024).toFixed(1)} KB</span>}
                      {meta?.verificationHash && (
                        <span className="font-mono">
                          Hash: {String(meta.verificationHash).slice(0, 12)}…
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 font-mono text-[10px]"
                    onClick={() => r.file_path && handleDownload(r.file_path)}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 font-mono text-[10px] border-destructive/30 text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(r.id, r.file_path)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </GlassPanel>
            );
          })}
        </div>
      )}
    </div>
  );
}
