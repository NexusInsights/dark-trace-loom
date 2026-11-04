import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { encodeReport } from "./reportFormats";
import { evidenceDate, isResolvedIdentityEntity, publicEvidenceUrl } from "./identityEvidence";

export type ReportType = "investigation-summary" | "evidence-list" | "timeline" | "subject-profile";
export type ReportFormat = "json" | "pdf" | "docx";

export type SavedRecordClassification = "supplied_input" | "generated_candidate" | "demo_output" | "failed_output" | "partial_output" | "rejected_association" | "excluded_record" | "unreviewed_record" | "sourced_observation" | "unvalidated_association_claim";
export interface SavedRecordAssessment {
  classification: SavedRecordClassification;
  label: string;
  outcome: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
  personAssociation: "not_established";
  reviewValidation: "not_performed";
}

export const SAVED_RECORD_NOTICE = "This export preserves saved case records, supplied inputs and tool output. A cited account or shared identifier does not establish a person association. Failed, partial, demo, generated and unreviewed records remain labeled; a snapshot hash verifies stored content, not factual accuracy.";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonempty = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
function reportSourceUrl(value: unknown): string | null {
  return publicEvidenceUrl(value) || null;
}

/** Classify the saved record without treating arbitrary text or a lookup input as a person fact. */
export function assessReportRecord(raw: unknown, artifactType = ""): SavedRecordAssessment {
  let value = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { value = {}; } }
  const data = record(value), details = record(data.details), metadata = record(data.metadata), identity = record(metadata.identity_evidence);
  const outcome = nonempty(data.status) || nonempty(details.status) || nonempty(metadata.status);
  const status = outcome?.toLowerCase();
  const sourceUrl = [identity.source_url, metadata.source_url, data.sourceUrl, data.source_url, details.sourceUrl, details.source_url, data.source, details.source].map(reportSourceUrl).find(Boolean) || null;
  const retrieved = nonempty(identity.retrieved_at) || nonempty(metadata.retrieved_at) || nonempty(data.retrievedAt) || nonempty(data.retrieved_at) || nonempty(details.retrievedAt) || nonempty(details.retrieved_at);
  const retrievedAt = evidenceDate(retrieved) ? retrieved : null;
  const source = nonempty(data.source) || nonempty(metadata.source) || "";
  const decision = (nonempty(data.decision) || nonempty(metadata.decision) || nonempty(identity.decision) || nonempty(record(data.review).decision))?.toLowerCase();
  let classification: SavedRecordClassification = "unreviewed_record";
  if (status === "demo" || data.demo === true || data.isDemo === true || data.mode === "demo" || details.demo === true || details.mode === "demo") classification = "demo_output";
  else if (["error", "failed", "failure", "not_configured", "unknown_tool", "not_found", "unavailable", "cancelled", "rate_limited"].includes(status || "") || data.success === false || !!data.error || !!details.error) classification = "failed_output";
  else if (decision === "rejected") classification = "rejected_association";
  else if (metadata.resolution_excluded === true || data.resolution_excluded === true) classification = "excluded_record";
  else if (status === "partial" || data.partial === true || details.partial === true) classification = "partial_output";
  else if (data.generated === true || data.candidate === true || ["candidates", "username_candidates", "email_candidates"].some(key => Array.isArray(data[key])) || /generat|permut|candidat|synthetic|guess|variation/i.test(source) || /generat|permut|candidat|synthetic|guess/i.test(String(identity.classification || "")) || /permut|candidate/i.test(artifactType)) classification = "generated_candidate";
  else if (["input", "auto_expansion", "supplied_input", "user_input"].includes(source) || ["input", "supplied_input", "user_input"].includes(String(identity.classification))) classification = "supplied_input";
  // Artifact data is arbitrary saved text. Even a structurally complete claim
  // cannot prove the referenced review exists or is still the latest decision.
  else if (isResolvedIdentityEntity({ metadata, entity_type: "social_profile", entity_value: identity.profile_url })) classification = "unvalidated_association_claim";
  else if (sourceUrl && retrievedAt && !["unreviewed", "rejected"].includes(decision || "")) classification = "sourced_observation";
  const labels: Record<SavedRecordClassification, string> = {
    supplied_input: "Provided input; ownership unverified",
    generated_candidate: "Generated candidate; not an observed identity",
    demo_output: "Demo output; not live evidence",
    failed_output: "Failed or unavailable output; no finding established",
    partial_output: "Partial output; incomplete observation",
    rejected_association: "Rejected person association",
    excluded_record: "Excluded from identity resolution",
    unreviewed_record: "Unreviewed saved record",
    sourced_observation: "Source-cited observation; person association unverified",
    unvalidated_association_claim: "Recorded association claim; supporting review not revalidated",
  };
  return { classification, label: labels[classification], outcome, sourceUrl, retrievedAt, personAssociation: "not_established", reviewValidation: "not_performed" };
}

export function summarizeReportRecords(assessments: SavedRecordAssessment[]) {
  const classifications = Object.fromEntries(assessments.map(item => item.classification).filter((value, index, all) => all.indexOf(value) === index).map(value => [value, assessments.filter(item => item.classification === value).length]));
  return { savedRecords: assessments.length, analystSupportedAssociations: 0, associationValidation: "not_performed", classifications };
}

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
    assessment?: SavedRecordAssessment;
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
      id: a.id, type: a.artifact_type, data: a.data, createdAt: a.created_at, assessment: assessReportRecord(a.data, a.artifact_type),
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
  return JSON.stringify({ ...data, reportType, interpretationNotice: SAVED_RECORD_NOTICE, recordSummary: summarizeReportRecords(data.artifacts.map(a => a.assessment || assessReportRecord(a.data, a.type))), subjects: data.subjects.map(subject => ({ ...subject, recordKind: "provided_subject_record" })), events: data.events.map(event => ({ ...event, recordKind: "saved_event_record" })) }, null, 2);
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
  lines.push(`\n${SAVED_RECORD_NOTICE}`);
  if (data.case.description) lines.push(`\n> ${data.case.description}`);
  lines.push("");

  switch (reportType) {
    case "investigation-summary":
      lines.push(`## Overview`);
      lines.push(`- **Provided subject records:** ${data.subjects.length}`);
      lines.push(`- **Saved artifact records:** ${data.artifacts.length}`);
      lines.push(`- **Recorded events:** ${data.events.length}`);
      lines.push(`- **Evidence Log Entries:** ${data.evidenceLogs.length}`);
      lines.push("");

      if (data.subjects.length > 0) {
        lines.push(`## Provided Subject Records`);
        data.subjects.forEach((s) => {
          lines.push(`### ${s.name} (${s.type})`);
          if (s.notes) lines.push(`> ${s.notes}`);
          lines.push("");
        });
      }

      if (data.artifacts.length > 0) {
        lines.push(`## Saved Artifact Records`);
        data.artifacts.forEach((a) => {
          const assessment = a.assessment || assessReportRecord(a.data, a.type);
          lines.push(`- **[${a.type}]** ${a.id.slice(0, 8)} - created ${dt(a.createdAt)} - ${assessment.label}${assessment.outcome ? ` (${assessment.outcome})` : ""}`);
          if (assessment.sourceUrl) lines.push(`  - Recorded source: ${assessment.sourceUrl}; retrieved: ${assessment.retrievedAt || "not supplied"}`);
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
      lines.push(`## Saved Artifact Records (${data.artifacts.length})`);
      lines.push("");
      lines.push(`| # | ID | Type | Created | Record assessment | Outcome | Integrity Hashes |`);
      lines.push(`|---|------|------|---------|-----------------|---------|-----------------|`);
      data.artifacts.forEach((a, i) => {
        const hashes = data.evidenceLogs
          .filter((l) => l.artifactId === a.id)
          .map((l) => `\`${l.hash.slice(0, 12)}\` (${l.action})`)
          .join(", ");
        const assessment = a.assessment || assessReportRecord(a.data, a.type);
        lines.push(`| ${i + 1} | ${a.id.slice(0, 8)} | ${a.type} | ${dt(a.createdAt)} | ${assessment.label} | ${assessment.outcome || "not recorded"} | ${hashes || "—"} |`);
        if (assessment.sourceUrl) lines.push(`Recorded source for ${a.id}: ${assessment.sourceUrl}; retrieved: ${assessment.retrievedAt || "not supplied"}`);
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
        const assessment = a.assessment || assessReportRecord(a.data, a.type);
        lines.push(`- ${dt(a.createdAt)} — [${a.type}] artifact \`${a.id.slice(0, 8)}\` — ${assessment.label}${assessment.outcome ? ` (${assessment.outcome})` : ""}`);
      }); }
      break;

    case "subject-profile":
      lines.push(`## Subject Profiles (${data.subjects.length})`);
      lines.push("Provided subject records. No subject association is inferred from names or text matches.");
      lines.push("");
      if (data.subjects.length === 0) {
        lines.push("_No subjects recorded._");
      } else {
        data.subjects.forEach((s) => {
          lines.push(`### ${s.name}`);
          lines.push(`- **Type:** ${s.type}`);
          lines.push(`- **ID:** \`${s.id.slice(0, 8)}\``);
          if (s.notes) lines.push(`- **Notes:** ${s.notes}`);

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
        recordSummary: summarizeReportRecords(data.artifacts.map(a => a.assessment || assessReportRecord(a.data, a.type))),
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
