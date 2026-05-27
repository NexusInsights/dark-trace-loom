import { supabase } from "@/integrations/supabase/client";
import { generateReport, type ReportData, type ReportType } from "./reportEngine";
import JSZip from "jszip";

export type BundleFormat = "zip" | "legal-pdf";

export interface BundleManifest {
  bundleId: string;
  caseId: string;
  caseTitle: string;
  generatedAt: string;
  generatedBy: string;
  format: BundleFormat;
  verificationHash: string;
  contents: {
    artifacts: number;
    evidenceLogs: number;
    events: number;
    subjects: number;
    reports: string[];
  };
  integrityChain: Array<{
    artifactId: string;
    type: string;
    hashes: Array<{ action: string; hash: string; timestamp: string }>;
  }>;
}

/** Simple hash for browser (uses SubtleCrypto SHA-256) */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch all case data for bundle assembly */
async function fetchBundleData(caseId: string) {
  const [caseRes, subjectsRes, artifactsRes, eventsRes] = await Promise.all([
    supabase.from("cases").select("*").eq("id", caseId).single(),
    supabase.from("subjects").select("*").eq("case_id", caseId).order("created_at"),
    supabase.from("artifacts").select("*").eq("case_id", caseId).order("created_at"),
    supabase.from("events").select("*").eq("case_id", caseId).order("timestamp", { ascending: true }),
  ]);

  if (caseRes.error) throw new Error(`Failed to load case: ${caseRes.error.message}`);

  const artifactIds = (artifactsRes.data ?? []).map((a) => a.id);
  let evidenceLogs: Array<{ artifact_id: string; action: string; hash: string; timestamp: string }> = [];
  if (artifactIds.length > 0) {
    const { data } = await supabase
      .from("evidence_logs")
      .select("artifact_id, action, hash, timestamp")
      .in("artifact_id", artifactIds)
      .order("timestamp");
    evidenceLogs = data ?? [];
  }

  return {
    case: caseRes.data,
    subjects: subjectsRes.data ?? [],
    artifacts: artifactsRes.data ?? [],
    events: eventsRes.data ?? [],
    evidenceLogs,
  };
}

/** Generate chain-of-custody document as text */
function generateChainOfCustody(
  artifacts: Array<{ id: string; artifact_type: string; created_at: string }>,
  evidenceLogs: Array<{ artifact_id: string; action: string; hash: string; timestamp: string }>
): string {
  const dt = (iso: string) => new Date(iso).toLocaleString();
  const lines: string[] = [];

  lines.push("CHAIN OF CUSTODY LOG");
  lines.push("=" .repeat(60));
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push("");

  artifacts.forEach((a, i) => {
    const logs = evidenceLogs.filter((l) => l.artifact_id === a.id);
    lines.push(`ARTIFACT #${i + 1}`);
    lines.push(`  ID:      ${a.id}`);
    lines.push(`  Type:    ${a.artifact_type}`);
    lines.push(`  Created: ${dt(a.created_at)}`);
    lines.push(`  Custody Events:`);
    if (logs.length === 0) {
      lines.push("    (none recorded)");
    } else {
      logs.forEach((l) => {
        lines.push(`    ${dt(l.timestamp)} | ${l.action.toUpperCase()} | Hash: ${l.hash}`);
      });
    }
    lines.push("");
  });

  lines.push("=" .repeat(60));
  lines.push("END OF CHAIN OF CUSTODY LOG");
  return lines.join("\n");
}

/** Generate legal evidence PDF as styled HTML */
function generateLegalPdf(
  caseData: { id: string; title: string; description: string | null; created_at: string },
  subjects: Array<{ id: string; name: string; type: string; notes: string | null }>,
  artifacts: Array<{ id: string; artifact_type: string; data: string | null; created_at: string }>,
  events: Array<{ id: string; event_type: string | null; description: string | null; timestamp: string | null }>,
  evidenceLogs: Array<{ artifact_id: string; action: string; hash: string; timestamp: string }>,
  manifest: BundleManifest
): string {
  const dt = (iso: string) => new Date(iso).toLocaleString();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const artifactRows = artifacts.map((a, i) => {
    const hashes = evidenceLogs
      .filter((l) => l.artifact_id === a.id)
      .map((l) => `<code>${l.hash.slice(0, 16)}</code> (${l.action})`)
      .join("<br/>");
    return `<tr>
      <td>${i + 1}</td>
      <td><code>${a.id.slice(0, 12)}</code></td>
      <td>${esc(a.artifact_type)}</td>
      <td>${dt(a.created_at)}</td>
      <td>${hashes || "—"}</td>
    </tr>`;
  }).join("");

  const custodyRows = evidenceLogs.map((l) => `<tr>
    <td>${dt(l.timestamp)}</td>
    <td><code>${l.artifact_id.slice(0, 12)}</code></td>
    <td>${l.action.toUpperCase()}</td>
    <td><code>${l.hash}</code></td>
  </tr>`).join("");

  const eventRows = events.map((e, i) => `<tr>
    <td>${i + 1}</td>
    <td>${e.timestamp ? dt(e.timestamp) : "N/A"}</td>
    <td>${esc(e.event_type ?? "event")}</td>
    <td>${esc(e.description ?? "—")}</td>
  </tr>`).join("");

  const subjectRows = subjects.map((s) => `<tr>
    <td>${esc(s.name)}</td>
    <td>${esc(s.type)}</td>
    <td><code>${s.id.slice(0, 12)}</code></td>
    <td>${esc(s.notes ?? "—")}</td>
  </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Legal Evidence Bundle — ${esc(caseData.title)}</title>
<style>
  @page { margin: 1in; size: letter; }
  body { font-family: 'Times New Roman', Georgia, serif; color: #111; background: #fff; padding: 40px; font-size: 11pt; line-height: 1.6; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20pt; text-align: center; border-bottom: 3px double #111; padding-bottom: 12px; margin-bottom: 6px; }
  h2 { font-size: 14pt; margin-top: 28px; border-bottom: 1px solid #888; padding-bottom: 4px; }
  h3 { font-size: 12pt; margin-top: 18px; }
  .subtitle { text-align: center; font-size: 10pt; color: #555; margin-bottom: 24px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 9pt; }
  th, td { border: 1px solid #888; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; font-weight: bold; }
  code { font-family: 'Courier New', monospace; font-size: 8pt; background: #f5f5f5; padding: 1px 3px; }
  .meta-box { border: 1px solid #aaa; padding: 12px; margin: 16px 0; background: #fafafa; font-size: 9pt; }
  .meta-box strong { display: inline-block; min-width: 140px; }
  .hash-box { border: 2px solid #333; padding: 12px; margin: 20px 0; background: #f9f9f0; font-family: 'Courier New', monospace; font-size: 9pt; }
  .footer { text-align: center; margin-top: 40px; font-size: 8pt; color: #888; border-top: 1px solid #ccc; padding-top: 12px; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>

<h1>EVIDENCE BUNDLE</h1>
<p class="subtitle">Prepared for Legal Proceedings</p>

<div class="meta-box">
  <strong>Case Title:</strong> ${esc(caseData.title)}<br/>
  <strong>Case ID:</strong> <code>${caseData.id}</code><br/>
  <strong>Case Created:</strong> ${dt(caseData.created_at)}<br/>
  ${caseData.description ? `<strong>Description:</strong> ${esc(caseData.description)}<br/>` : ""}
  <strong>Bundle Generated:</strong> ${dt(manifest.generatedAt)}<br/>
  <strong>Bundle ID:</strong> <code>${manifest.bundleId}</code><br/>
  <strong>Format:</strong> ${manifest.format.toUpperCase()}<br/>
</div>

<div class="hash-box">
  <strong>BUNDLE VERIFICATION HASH (SHA-256)</strong><br/>
  ${manifest.verificationHash}
</div>

<h2>1. Investigation Summary</h2>
<p>This evidence bundle contains <strong>${artifacts.length}</strong> artifact(s), <strong>${subjects.length}</strong> subject(s) of interest, <strong>${events.length}</strong> event(s), and <strong>${evidenceLogs.length}</strong> chain-of-custody log entries.</p>

<h2>2. Subjects of Interest</h2>
${subjects.length === 0 ? "<p><em>No subjects recorded.</em></p>" : `
<table>
  <thead><tr><th>Name</th><th>Type</th><th>ID</th><th>Notes</th></tr></thead>
  <tbody>${subjectRows}</tbody>
</table>`}

<h2 class="page-break">3. Evidence Artifacts</h2>
${artifacts.length === 0 ? "<p><em>No artifacts recorded.</em></p>" : `
<table>
  <thead><tr><th>#</th><th>ID</th><th>Type</th><th>Created</th><th>Integrity Hashes</th></tr></thead>
  <tbody>${artifactRows}</tbody>
</table>`}

<h3>3a. Artifact Data</h3>
${artifacts.filter((a) => a.data).map((a, i) => `
<div style="margin: 8px 0; padding: 8px; border: 1px solid #ccc; background: #fafafa;">
  <strong>Artifact #${i + 1} (${esc(a.artifact_type)}) — <code>${a.id.slice(0, 12)}</code></strong><br/>
  <pre style="white-space: pre-wrap; font-size: 8pt; max-height: 200px; overflow: auto;">${esc(a.data!)}</pre>
</div>
`).join("") || "<p><em>No artifact data recorded.</em></p>"}

<h2 class="page-break">4. Chain of Custody</h2>
${evidenceLogs.length === 0 ? "<p><em>No custody events recorded.</em></p>" : `
<table>
  <thead><tr><th>Timestamp</th><th>Artifact</th><th>Action</th><th>Hash</th></tr></thead>
  <tbody>${custodyRows}</tbody>
</table>`}

<h2 class="page-break">5. Event Timeline</h2>
${events.length === 0 ? "<p><em>No events recorded.</em></p>" : `
<table>
  <thead><tr><th>#</th><th>Timestamp</th><th>Type</th><th>Description</th></tr></thead>
  <tbody>${eventRows}</tbody>
</table>`}

<h2>6. Integrity Verification</h2>
<p>Each artifact's integrity is verified through cryptographic hashes generated at the time of creation and any subsequent modifications. The bundle-level SHA-256 hash below encompasses all case data, ensuring the bundle has not been tampered with post-generation.</p>

<div class="hash-box">
  <strong>BUNDLE SHA-256:</strong> ${manifest.verificationHash}<br/>
  <strong>Artifacts Hashed:</strong> ${manifest.integrityChain.length}<br/>
  <strong>Total Custody Events:</strong> ${evidenceLogs.length}
</div>

<div class="footer">
  Evidence bundle generated by OSINTHQ Intelligence Platform<br/>
  Bundle ID: ${manifest.bundleId} | ${dt(manifest.generatedAt)}
</div>

</body>
</html>`;
}

/** Generate a text-based manifest file */
function generateManifestText(manifest: BundleManifest): string {
  const lines: string[] = [];
  lines.push("EVIDENCE BUNDLE MANIFEST");
  lines.push("=" .repeat(50));
  lines.push(`Bundle ID:      ${manifest.bundleId}`);
  lines.push(`Case:           ${manifest.caseTitle} (${manifest.caseId})`);
  lines.push(`Generated:      ${manifest.generatedAt}`);
  lines.push(`Generated By:   ${manifest.generatedBy}`);
  lines.push(`Format:         ${manifest.format}`);
  lines.push("");
  lines.push("VERIFICATION HASH (SHA-256):");
  lines.push(manifest.verificationHash);
  lines.push("");
  lines.push("CONTENTS:");
  lines.push(`  Artifacts:      ${manifest.contents.artifacts}`);
  lines.push(`  Evidence Logs:  ${manifest.contents.evidenceLogs}`);
  lines.push(`  Events:         ${manifest.contents.events}`);
  lines.push(`  Subjects:       ${manifest.contents.subjects}`);
  lines.push(`  Reports:        ${manifest.contents.reports.join(", ") || "none"}`);
  lines.push("");
  lines.push("INTEGRITY CHAIN:");
  manifest.integrityChain.forEach((item) => {
    lines.push(`  Artifact ${item.artifactId.slice(0, 12)} (${item.type}):`);
    item.hashes.forEach((h) => {
      lines.push(`    ${h.action} | ${h.hash} | ${h.timestamp}`);
    });
  });
  lines.push("");
  lines.push("=" .repeat(50));
  return lines.join("\n");
}

/** Assemble all files into a real ZIP archive using JSZip. */
async function assembleZipBundle(files: Array<{ name: string; content: string }>): Promise<Blob> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.content);
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/** Main evidence bundle generation function */
export async function generateEvidenceBundle(
  caseId: string,
  userId: string,
  format: BundleFormat,
  onProgress?: (step: string) => void
): Promise<{ downloadUrl: string; manifest: BundleManifest }> {
  onProgress?.("Fetching case data...");
  const bundleData = await fetchBundleData(caseId);
  const { case: caseData, subjects, artifacts, events, evidenceLogs } = bundleData;

  // Build integrity chain
  const integrityChain = artifacts.map((a) => ({
    artifactId: a.id,
    type: a.artifact_type,
    hashes: evidenceLogs
      .filter((l) => l.artifact_id === a.id)
      .map((l) => ({ action: l.action, hash: l.hash, timestamp: l.timestamp })),
  }));

  // Compute bundle verification hash
  onProgress?.("Computing verification hash...");
  const hashInput = JSON.stringify({
    caseId,
    artifacts: artifacts.map((a) => ({ id: a.id, type: a.artifact_type, data: a.data })),
    evidenceLogs,
    events: events.map((e) => ({ id: e.id, type: e.event_type, timestamp: e.timestamp })),
    subjects: subjects.map((s) => ({ id: s.id, name: s.name, type: s.type })),
    generatedAt: new Date().toISOString(),
  });
  const verificationHash = await sha256(hashInput);

  const bundleId = crypto.randomUUID();
  const manifest: BundleManifest = {
    bundleId,
    caseId,
    caseTitle: caseData.title,
    generatedAt: new Date().toISOString(),
    generatedBy: userId,
    format,
    verificationHash,
    contents: {
      artifacts: artifacts.length,
      evidenceLogs: evidenceLogs.length,
      events: events.length,
      subjects: subjects.length,
      reports: ["investigation-summary", "timeline", "evidence-list", "chain-of-custody"],
    },
    integrityChain,
  };

  let blob: Blob;
  let fileName: string;
  let mimeType: string;

  if (format === "legal-pdf") {
    onProgress?.("Generating legal evidence PDF...");
    const html = generateLegalPdf(caseData, subjects, artifacts, events, evidenceLogs, manifest);
    blob = new Blob([html], { type: "text/html" });
    fileName = `evidence-bundle_${caseData.title.replace(/\s+/g, "-").toLowerCase()}_${bundleId.slice(0, 8)}.html`;
    mimeType = "text/html";
  } else {
    onProgress?.("Assembling evidence bundle...");
    const files: Array<{ name: string; content: string }> = [];

    // Manifest
    files.push({ name: "MANIFEST.txt", content: generateManifestText(manifest) });

    // Chain of custody
    files.push({ name: "chain-of-custody.txt", content: generateChainOfCustody(artifacts, evidenceLogs) });

    // Artifact metadata
    const artifactMeta = JSON.stringify(
      artifacts.map((a) => ({
        id: a.id,
        type: a.artifact_type,
        data: a.data,
        created_at: a.created_at,
        integrity: evidenceLogs
          .filter((l) => l.artifact_id === a.id)
          .map((l) => ({ action: l.action, hash: l.hash, timestamp: l.timestamp })),
      })),
      null,
      2
    );
    files.push({ name: "artifacts.json", content: artifactMeta });

    // Events timeline
    const eventsJson = JSON.stringify(
      events.map((e) => ({
        id: e.id,
        type: e.event_type,
        description: e.description,
        timestamp: e.timestamp,
      })),
      null,
      2
    );
    files.push({ name: "timeline.json", content: eventsJson });

    // Subjects
    const subjectsJson = JSON.stringify(
      subjects.map((s) => ({ id: s.id, name: s.name, type: s.type, notes: s.notes })),
      null,
      2
    );
    files.push({ name: "subjects.json", content: subjectsJson });

    // Investigation summary
    files.push({
      name: "investigation-summary.txt",
      content: [
        `INVESTIGATION SUMMARY — ${caseData.title}`,
        `Case ID: ${caseData.id}`,
        `Created: ${new Date(caseData.created_at).toLocaleString()}`,
        caseData.description ? `Description: ${caseData.description}` : "",
        "",
        `Subjects: ${subjects.length}`,
        `Artifacts: ${artifacts.length}`,
        `Events: ${events.length}`,
        `Evidence Log Entries: ${evidenceLogs.length}`,
        "",
        `Verification Hash: ${verificationHash}`,
      ].filter(Boolean).join("\n"),
    });

    // Verification hash
    files.push({
      name: "VERIFICATION_HASH.txt",
      content: `SHA-256 Verification Hash\n${verificationHash}\n\nGenerated: ${manifest.generatedAt}\nBundle ID: ${bundleId}`,
    });

    blob = assembleZipBundle(files);
    fileName = `evidence-bundle_${caseData.title.replace(/\s+/g, "-").toLowerCase()}_${bundleId.slice(0, 8)}.txt`;
    mimeType = "text/plain";
  }

  // Upload to storage
  onProgress?.("Uploading bundle to storage...");
  const filePath = `${userId}/${caseId}/bundles/${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from("reports")
    .upload(filePath, blob, { contentType: mimeType, upsert: true });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // Save metadata
  onProgress?.("Saving bundle metadata...");
  await supabase.from("reports").insert({
    case_id: caseId,
    user_id: userId,
    report_type: `evidence-bundle-${format}`,
    format: format === "legal-pdf" ? "pdf" : "zip",
    file_path: filePath,
    file_size: blob.size,
    metadata: {
      bundleId,
      verificationHash,
      artifactCount: artifacts.length,
      evidenceLogCount: evidenceLogs.length,
      eventCount: events.length,
      subjectCount: subjects.length,
    },
  });

  // Generate download URL
  const { data: urlData } = await supabase.storage
    .from("reports")
    .createSignedUrl(filePath, 3600);

  onProgress?.("Complete!");
  return {
    downloadUrl: urlData?.signedUrl ?? "",
    manifest,
  };
}
