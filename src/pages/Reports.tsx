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
import {
  generateReport, getReportDownloadUrl,
  type ReportType, type ReportFormat, REPORT_LABELS,
} from "@/lib/reportEngine";
import { toast } from "sonner";
import {
  FileText, Download, Loader2, FileJson, FileType, File,
  ClipboardList, Clock, User, ShieldCheck, Trash2,
} from "lucide-react";

const REPORT_TYPES: { id: ReportType; label: string; description: string; icon: typeof FileText }[] = [
  { id: "investigation-summary", label: "Investigation Summary", description: "Full case overview with subjects, artifacts, and timeline", icon: ClipboardList },
  { id: "evidence-list", label: "Evidence & Artifacts", description: "Detailed artifact inventory with integrity hash chain", icon: ShieldCheck },
  { id: "timeline", label: "Timeline Report", description: "Chronological event and artifact timeline", icon: Clock },
  { id: "subject-profile", label: "Subject Profile", description: "Intelligence profiles for all subjects of interest", icon: User },
];

const FORMAT_OPTIONS: { id: ReportFormat; label: string; icon: typeof FileText; ext: string }[] = [
  { id: "json", label: "JSON", icon: FileJson, ext: ".json" },
  { id: "pdf", label: "PDF (HTML)", icon: File, ext: ".html" },
  { id: "docx", label: "DOCX", icon: FileType, ext: ".doc" },
];

export default function ReportsPage() {
  const { user } = useAuth();
  const { plan } = useSubscription();
  const { data: cases = [], isLoading: casesLoading } = useCases();

  const [selectedCase, setSelectedCase] = useState("");
  const [selectedType, setSelectedType] = useState<ReportType>("investigation-summary");
  const [selectedFormat, setSelectedFormat] = useState<ReportFormat>("json");
  const [generating, setGenerating] = useState(false);
  const [progressStep, setProgressStep] = useState("");
  const [lastDownloadUrl, setLastDownloadUrl] = useState<string | null>(null);

  // Feature gate
  const exportGate = checkFeatureGate(plan, "canExportReports");

  // Past reports
  const { data: pastReports = [], refetch: refetchReports } = useQuery({
    queryKey: ["reports", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("user_id", user!.id)
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
    setLastDownloadUrl(null);
    try {
      const result = await generateReport(
        selectedCase, user.id, selectedType, selectedFormat,
        (step) => setProgressStep(step)
      );
      setLastDownloadUrl(result.downloadUrl);
      refetchReports();
      toast.success("Report generated successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Report generation failed");
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
      if (filePath) {
        await supabase.storage.from("reports").remove([filePath]);
      }
      await supabase.from("reports").delete().eq("id", reportId);
      refetchReports();
      toast.success("Report deleted");
    } catch {
      toast.error("Failed to delete report");
    }
  };

  const caseTitle = (caseId: string) =>
    cases.find((c) => c.id === caseId)?.title ?? caseId.slice(0, 8);

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in space-y-8">
      {/* Header */}
      <div>
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Reports</span>
        <h1 className="text-2xl font-display font-bold tracking-tight mt-1">Report Generator</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate forensic-grade reports from your investigations with integrity verification.
        </p>
      </div>

      {/* Feature gate */}
      {!exportGate.allowed && (
        <UpgradePrompt reason={exportGate.reason!} requiredPlan={exportGate.requiredPlan!} />
      )}

      {/* Report Configuration */}
      <div className={!exportGate.allowed ? "opacity-50 pointer-events-none" : ""}>
        {/* Case selector */}
        <GlassPanel className="p-5 space-y-4" neonLine="top">
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">1 — SELECT CASE</span>
          {casesLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : cases.length === 0 ? (
            <p className="text-xs text-muted-foreground">No cases found. Create an investigation first.</p>
          ) : (
            <select
              value={selectedCase}
              onChange={(e) => setSelectedCase(e.target.value)}
              className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Choose a case...</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          )}
        </GlassPanel>

        {/* Report type */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          {REPORT_TYPES.map((rt) => {
            const isSelected = selectedType === rt.id;
            const Icon = rt.icon;
            return (
              <GlassPanel
                key={rt.id}
                className={`p-4 cursor-pointer transition-all ${
                  isSelected ? "ring-2 ring-primary glow-blue" : "hover:border-primary/20"
                }`}
              >
                <button onClick={() => setSelectedType(rt.id)} className="w-full text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold">{rt.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{rt.description}</p>
                </button>
              </GlassPanel>
            );
          })}
        </div>

        {/* Format + Generate */}
        <GlassPanel className="p-5 mt-4 space-y-4" neonLine="left">
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">3 — FORMAT & GENERATE</span>
          <div className="flex gap-2">
            {FORMAT_OPTIONS.map((f) => {
              const isSelected = selectedFormat === f.id;
              const Icon = f.icon;
              return (
                <button
                  key={f.id}
                  onClick={() => setSelectedFormat(f.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-mono transition-all ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {f.label}
                </button>
              );
            })}
          </div>

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
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />GENERATING...</>
            ) : (
              <><FileText className="h-3.5 w-3.5" />GENERATE REPORT</>
            )}
          </Button>

          {lastDownloadUrl && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => window.open(lastDownloadUrl, "_blank")}
            >
              <Download className="h-3.5 w-3.5" />
              DOWNLOAD REPORT
            </Button>
          )}
        </GlassPanel>
      </div>

      {/* Past Reports */}
      {pastReports.length > 0 && (
        <div className="space-y-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">Generated Reports</span>
          {pastReports.map((r) => {
            const meta = r.metadata as Record<string, unknown> | null;
            return (
              <GlassPanel key={r.id} className="p-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">
                        {REPORT_LABELS[r.report_type as ReportType] ?? r.report_type}
                      </span>
                      <span className="intel-tag intel-tag-blue text-[8px]">{r.format.toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                      <span>Case: {caseTitle(r.case_id)}</span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                      {r.file_size && <span>{(r.file_size / 1024).toFixed(1)} KB</span>}
                      {meta && (
                        <span>
                          {(meta.artifactCount as number) ?? 0} artifacts · {(meta.eventCount as number) ?? 0} events
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
