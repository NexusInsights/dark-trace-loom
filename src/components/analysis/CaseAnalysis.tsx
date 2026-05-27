import { useState } from "react";
import { GlassPanel, AnalysisPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import {
  Brain, Loader2, AlertTriangle, Link2, FileText,
  ChevronDown, ChevronUp, Sparkles, ShieldAlert, Eye,
} from "lucide-react";

const SEVERITY_COLORS: Record<string, string> = {
  low: "text-muted-foreground",
  medium: "text-warning",
  high: "text-orange-400",
  critical: "text-destructive",
};

const SEVERITY_BG: Record<string, string> = {
  low: "bg-muted/30",
  medium: "bg-warning/10",
  high: "bg-orange-500/10",
  critical: "bg-destructive/10",
};

export function CaseAnalysis({ caseId }: { caseId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [showNarrative, setShowNarrative] = useState<string | null>(null);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["analysis-reports", caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_reports")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-case", {
        body: { case_id: caseId, analysis_type: "full" },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      qc.invalidateQueries({ queryKey: ["analysis-reports", caseId] });
      toast.success("AI analysis complete");
      if (data?.data?.id) setExpandedReport(data.data.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="font-display text-sm font-semibold">AI Analysis</span>
          {reports.length > 0 && (
            <span className="intel-tag intel-tag-blue">{reports.length}</span>
          )}
        </div>
        <Button
          variant="neon"
          size="sm"
          className="gap-1.5"
          disabled={analyzing}
          onClick={runAnalysis}
        >
          {analyzing ? (
            <><Loader2 className="h-3 w-3 animate-spin" />ANALYZING...</>
          ) : (
            <><Sparkles className="h-3 w-3" />RUN AI ANALYSIS</>
          )}
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && reports.length === 0 && !analyzing && (
        <GlassPanel className="p-6 text-center">
          <Brain className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-xs text-muted-foreground font-mono">
            NO ANALYSIS REPORTS YET
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            Run AI analysis to generate insights from your investigation data
          </p>
        </GlassPanel>
      )}

      {analyzing && (
        <GlassPanel className="p-4" neonLine="top">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Brain className="h-5 w-5 text-primary animate-pulse" />
              <Sparkles className="h-3 w-3 text-accent absolute -top-1 -right-1" />
            </div>
            <div>
              <p className="text-xs font-semibold">Analyzing investigation data...</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Scanning subjects, artifacts, events, and relationships
              </p>
            </div>
          </div>
        </GlassPanel>
      )}

      {reports.map((report: any) => {
        const isExpanded = expandedReport === report.id;
        const findings = (report.key_findings as any[]) ?? [];
        const patterns = (report.suspicious_patterns as any[]) ?? [];
        const rels = (report.key_relationships as any[]) ?? [];

        return (
          <GlassPanel key={report.id} className="overflow-hidden">
            {/* Header */}
            <button
              onClick={() => setExpandedReport(isExpanded ? null : report.id)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/20 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Brain className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold">
                  {report.analysis_type === "full" ? "Full Analysis" : report.analysis_type}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(report.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {findings.length > 0 && (
                  <span className="intel-tag intel-tag-blue text-[8px]">{findings.length} FINDINGS</span>
                )}
                {patterns.length > 0 && (
                  <span className="intel-tag intel-tag-amber text-[8px]">{patterns.length} PATTERNS</span>
                )}
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </div>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 space-y-4 border-t border-border/30 pt-3 animate-fade-in">
                {/* Summary */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Eye className="h-3 w-3 text-primary/70" />
                    <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                      EXECUTIVE SUMMARY
                    </span>
                  </div>
                  <div className="text-xs text-secondary-foreground leading-relaxed prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown>{report.generated_summary}</ReactMarkdown>
                  </div>
                </div>

                {/* Key Findings */}
                {findings.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="h-3 w-3 text-warning" />
                      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                        KEY FINDINGS ({findings.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {findings.map((f: any, i: number) => (
                        <div key={i} className={`rounded-md px-3 py-2 ${SEVERITY_BG[f.severity] ?? "bg-muted/30"}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`font-mono text-[9px] font-bold tracking-wider ${SEVERITY_COLORS[f.severity] ?? ""}`}>
                              {f.severity?.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-foreground">{f.finding}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">Evidence: {f.evidence}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suspicious Patterns */}
                {patterns.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <ShieldAlert className="h-3 w-3 text-destructive" />
                      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                        SUSPICIOUS PATTERNS ({patterns.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {patterns.map((p: any, i: number) => (
                        <div key={i} className={`rounded-md px-3 py-2 ${SEVERITY_BG[p.risk_level] ?? "bg-muted/30"}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`font-mono text-[9px] font-bold tracking-wider ${SEVERITY_COLORS[p.risk_level] ?? ""}`}>
                              {p.risk_level?.toUpperCase()} RISK
                            </span>
                          </div>
                          <p className="text-xs font-medium text-foreground">{p.pattern}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">Indicators: {p.indicators}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Relationships */}
                {rels.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Link2 className="h-3 w-3 text-info" />
                      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                        KEY RELATIONSHIPS ({rels.length})
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {rels.map((r: any, i: number) => (
                        <div key={i} className="bg-muted/20 rounded-md px-3 py-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-semibold text-foreground">{r.from_entity}</span>
                            <span className="text-primary font-mono text-[10px]">→ {r.relationship} →</span>
                            <span className="font-semibold text-foreground">{r.to_entity}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{r.significance}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Narrative Draft */}
                {report.narrative_draft && (
                  <div>
                    <button
                      onClick={() => setShowNarrative(showNarrative === report.id ? null : report.id)}
                      className="flex items-center gap-1.5 mb-2 hover:opacity-80 transition-opacity"
                    >
                      <FileText className="h-3 w-3 text-accent" />
                      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                        NARRATIVE REPORT DRAFT
                      </span>
                      {showNarrative === report.id ? (
                        <ChevronUp className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                    {showNarrative === report.id && (
                      <div className="bg-background/60 border border-border rounded-md p-4 text-xs leading-relaxed prose prose-sm prose-invert max-w-none animate-fade-in">
                        <ReactMarkdown>{report.narrative_draft}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </GlassPanel>
        );
      })}
    </div>
  );
}
