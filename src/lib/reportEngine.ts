import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { encodeReport } from "./reportFormats";

export type ReportType = "investigation-summary" | "evidence-list" | "timeline" | "subject-profile";
export type ReportFormat = "json" | "pdf" | "docx";

export interface ReportData {
  reportType: ReportType;
  generatedAt: string;
  case: {
    id: string;
    title: string;
    description: string | null;
    createdAt: string;
  };
  subjects: Array<{
    id: string;
    name: string;
    type: string;
    notes: string | null;
  }>;
  artifacts: Array<{
    id: string;
    type: string;
    data: string | null;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    type: string | null;
    description: string | null;
    timestamp: string | null;
  }>;
  evidenceLogs: Array<{
    artifactId: string;
    action: string;
    hash: string;
    timestamp: string;
  }>;
}

const REPORT_LABELS: Record<ReportType, string> = {
  "investigation-summary": "Investigation Summary",
  "evidence-list": "Evidence & Artifacts List",
  "timeline": "Timeline Report",
  "subject-profile": "Subject Intelligence Profile",
};

/** Fetch all case data needed for report generation */
async function fetchCaseData(caseId: string): Promise<ReportData> {
  const [caseRes, subjectsRes, artifactsRes, eventsRes] = await Promise.all([
    checkedDatabase(supabase.from("cases").select("*").eq("id", caseId).single()),
    checkedDatabase(supabase.from("subjects").select("*").eq("case_id", caseId).order("created_at")),
    checkedDatabase(supabase.from("artifacts").select("*").eq("case_id", caseId).order("created_at")),
    checkedDatabase(supabase.from("events").select("*").eq("case_id", caseId).order("timestamp", { ascending: true })),
  ]);

  if (caseRes.error) throw new Error(`Failed to load case: ${caseRes.error.message}`);
  for (const result of [subjectsRes, artifactsRes, eventsRes]) if (result.error) throw new Error(`Report data could not be loaded: ${result.error.message}`);
  const caseData = caseRes.data;

  // Fetch evidence logs for artifacts
  const artifactIds = (artifactsRes.data ?? []).map((a) => a.id);
  let evidenceLogs: Array<{ artifact_id: string; action: string; hash: string; timestamp: string }> = [];
  if (artifactIds.length > 0) {
    const { data, error } = await checkedDatabase(supabase
      .from("evidence_logs")
      .select("artifact_id, action, hash, timestamp")
      .in("artifact_id", artifactIds)
      .order("timestamp"));
    if (error) throw new Error(`Evidence logs could not be loaded: ${error.message}`);
    evidenceLogs = data ?? [];
  }

  return {
    reportType: "investigation-summary",
    generatedAt: new Date().toISOString(),
    case: {
      id: caseData.id,
      title: caseData.title,
      description: caseData.description,
      createdAt: caseData.created_at,
    },
    subjects: (subjectsRes.data ?? []).map((s) => ({
      id: s.id, name: s.name, type: s.type, notes: s.notes,
    })),
    artifacts: (artifactsRes.data ?? []).map((a) => ({
      id: a.id, type: a.artifact_type, data: a.data, createdAt: a.created_at,
    })),
    events: (eventsRes.data ?? []).map((e) => ({
      id: e.id, type: e.event_type, description: e.description, timestamp: e.timestamp,
    })),
    evidenceLogs: evidenceLogs.map((l) => ({
      artifactId: l.artifact_id, action: l.action, hash: l.hash, timestamp: l.timestamp,
    })),
  };
}

/** Generate JSON report */
function generateJsonReport(data: ReportData, reportType: ReportType): string {
  return JSON.stringify({ ...data, reportType }, null, 2);
}

/** Generate markdown content for a report type */
function generateMarkdown(data: ReportData, reportType: ReportType): string {
  const label = REPORT_LABELS[reportType];
  const dt = (iso: string) => new Date(iso).toLocaleString();
  const lines: string[] = [];

  lines.push(`# ${label}`);
  lines.push(`**Case:** ${data.case.title}`);
  lines.push(`**Generated:** ${dt(data.generatedAt)}`);
  lines.push(`**Case Created:** ${dt(data.case.createdAt)}`);
  if (data.case.description) lines.push(`\n> ${data.case.description}`);
  lines.push("");

  switch (reportType) {
    case "investigation-summary":
      lines.push(`## Overview`);
      lines.push(`- **Subjects:** ${data.subjects.length}`);
      lines.push(`- **Artifacts:** ${data.artifacts.length}`);
      lines.push(`- **Events:** ${data.events.length}`);
      lines.push(`- **Evidence Log Entries:** ${data.evidenceLogs.length}`);
      lines.push("");

      if (data.subjects.length > 0) {
        lines.push(`## Subjects`);
        data.subjects.forEach((s) => {
          lines.push(`### ${s.name} (${s.type})`);
          if (s.notes) lines.push(`> ${s.notes}`);
          lines.push("");
        });
      }

      if (data.artifacts.length > 0) {
        lines.push(`## Key Artifacts`);
        data.artifacts.forEach((a) => {
          lines.push(`- **[${a.type}]** ${a.id.slice(0, 8)} — created ${dt(a.createdAt)}`);
        });
        lines.push("");
      }

      if (data.events.length > 0) {
        lines.push(`## Timeline Summary`);
        data.events.forEach((e) => {
          lines.push(`- ${e.timestamp ? dt(e.timestamp) : "N/A"} — ${e.type ?? "event"}: ${e.description ?? "No description"}`);
        });
      }
      break;

    case "evidence-list":
      lines.push(`## Evidence Artifacts (${data.artifacts.length})`);
      lines.push("");
      lines.push(`| # | ID | Type | Created | Integrity Hashes |`);
      lines.push(`|---|------|------|---------|-----------------|`);
      data.artifacts.forEach((a, i) => {
        const hashes = data.evidenceLogs
          .filter((l) => l.artifactId === a.id)
          .map((l) => `\`${l.hash.slice(0, 12)}\` (${l.action})`)
          .join(", ");
        lines.push(`| ${i + 1} | ${a.id.slice(0, 8)} | ${a.type} | ${dt(a.createdAt)} | ${hashes || "—"} |`);
      });
      lines.push("");

      lines.push(`## Chain of Custody Log`);
      lines.push(`| Timestamp | Artifact | Action | Hash |`);
      lines.push(`|-----------|----------|--------|------|`);
      data.evidenceLogs.forEach((l) => {
        lines.push(`| ${dt(l.timestamp)} | ${l.artifactId.slice(0, 8)} | ${l.action} | \`${l.hash}\` |`);
      });
      break;

    case "timeline":
      lines.push(`## Event Timeline (${data.events.length} events)`);
      lines.push("");
      if (data.events.length === 0) {
        lines.push("_No events recorded._");
      } else {
        data.events.forEach((e, i) => {
          lines.push(`### ${i + 1}. ${e.type ?? "Event"}`);
          lines.push(`- **When:** ${e.timestamp ? dt(e.timestamp) : "Unknown"}`);
          lines.push(`- **Description:** ${e.description ?? "—"}`);
          lines.push("");
        });
      }

      lines.push(`## Artifact Timeline`);
      { const sorted = [...data.artifacts].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      sorted.forEach((a) => {
        lines.push(`- ${dt(a.createdAt)} — [${a.type}] artifact \`${a.id.slice(0, 8)}\``);
      }); }
      break;

    case "subject-profile":
      lines.push(`## Subject Profiles (${data.subjects.length})`);
      lines.push("");
      if (data.subjects.length === 0) {
        lines.push("_No subjects recorded._");
      } else {
        data.subjects.forEach((s) => {
          lines.push(`### ${s.name}`);
          lines.push(`- **Type:** ${s.type}`);
          lines.push(`- **ID:** \`${s.id.slice(0, 8)}\``);
          if (s.notes) lines.push(`- **Notes:** ${s.notes}`);

          // Related artifacts
          const related = data.artifacts.filter((a) =>
            a.data?.toLowerCase().includes(s.name.toLowerCase())
          );
          if (related.length > 0) {
            lines.push(`- **Related Artifacts:** ${related.length}`);
            related.forEach((a) => {
              lines.push(`  - [${a.type}] \`${a.id.slice(0, 8)}\``);
            });
          }
          lines.push("");
        });
      }
      break;
  }

  lines.push("");
  lines.push("---");
  lines.push(`_Report generated by OSINTHQ Intelligence Platform • ${dt(data.generatedAt)}_`);
  return lines.join("\n");
}

/** Convert markdown to a minimal HTML document for PDF rendering */
/** Main report generation function */
export async function generateReport(
  caseId: string,
  userId: string,
  reportType: ReportType,
  format: ReportFormat,
  onProgress?: (step: string) => void
): Promise<{ reportId: string; downloadUrl: string }> {
  onProgress?.("Fetching case data...");
  const data = await fetchCaseData(caseId);
  data.reportType = reportType;

  onProgress?.("Generating report content...");
  let content: string | Blob;
  let mimeType: string;
  let extension: string;

  switch (format) {
    case "json":
      content = generateJsonReport(data, reportType);
      mimeType = "application/json";
      extension = "json";
      break;
    case "pdf": {
      const md = generateMarkdown(data, reportType);
      content = await encodeReport(md, "pdf");
      mimeType = "application/pdf";
      extension = "pdf";
      break;
    }
    case "docx": {
      const md = generateMarkdown(data, reportType);
      content = await encodeReport(md, "docx");
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      extension = "docx";
      break;
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${reportType}_${timestamp}.${extension}`;
  const filePath = `${userId}/${caseId}/${fileName}`;

  onProgress?.("Uploading to storage...");
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const { error: uploadError } = await checkedDatabase(supabase.storage
    .from("reports")
    .upload(filePath, blob, { contentType: mimeType, upsert: true }));

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  onProgress?.("Saving report metadata...");
  const { data: report, error: insertError } = await checkedDatabase(supabase
    .from("reports")
    .insert({
      case_id: caseId,
      user_id: userId,
      report_type: reportType,
      format,
      file_path: filePath,
      file_size: blob.size,
      metadata: {
        subjectCount: data.subjects.length,
        artifactCount: data.artifacts.length,
        eventCount: data.events.length,
        evidenceLogCount: data.evidenceLogs.length,
      },
    })
    .select()
    .single());

  if (insertError) throw new Error(`Metadata save failed: ${insertError.message}`);

  // Generate signed download URL
  const { data: urlData, error: urlError } = await checkedDatabase(supabase.storage
    .from("reports")
    .createSignedUrl(filePath, 3600));
  if (urlError || !urlData?.signedUrl) throw new Error(`Report saved, but download could not be authorized: ${urlError?.message || "No URL returned"}`);

  onProgress?.("Complete!");
  return {
    reportId: report.id,
    downloadUrl: urlData?.signedUrl ?? "",
  };
}

/** Get download URL for an existing report */
export async function getReportDownloadUrl(filePath: string): Promise<string> {
  const { data, error } = await checkedDatabase(supabase.storage
    .from("reports")
    .createSignedUrl(filePath, 3600));
  if (error || !data?.signedUrl) throw new Error(error?.message || "No download URL returned");
  return data?.signedUrl ?? "";
}

export { REPORT_LABELS };
