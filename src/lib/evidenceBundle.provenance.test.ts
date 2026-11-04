import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import JSZip from "jszip";
import { generateEvidenceBundle } from "./evidenceBundleEngine";

const saved = vi.hoisted(() => ({ uploaded: null as Blob | null, pdf: "", inserts: [] as Record<string, unknown>[] }));
const artifacts = [
  { id: "demo", artifact_type: "fixture-tool", data: JSON.stringify({ status: "demo", username: "invented-for-demo" }), created_at: "2026-11-01T00:00:00Z" },
  { id: "input", artifact_type: "fixture-tool", data: JSON.stringify({ source: "input", email: "supplied@example.invalid" }), created_at: "2026-11-01T00:00:00Z" },
  { id: "failure", artifact_type: "fixture-tool", data: JSON.stringify({ status: "error", error: "Synthetic timeout" }), created_at: "2026-11-01T00:00:00Z" },
];
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const rows = table === "cases" ? { id: "case-1", title: "Synthetic case", description: "Provided case description", created_at: "2026-11-01T00:00:00Z" }
      : table === "subjects" ? [{ id: "subject-1", name: "Supplied Person", type: "person", notes: "An unreviewed supplied note" }]
      : table === "artifacts" ? artifacts
      : table === "events" ? [{ id: "event-1", event_type: "analyst-note", description: "Unreviewed recorded event", timestamp: "2026-11-01T00:00:00Z" }] : [];
    const query = { select: () => query, eq: () => query, order: () => query, in: () => query,
      insert: (value: Record<string, unknown>) => { saved.inserts.push(value); return query; },
      single: async () => ({ data: rows, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) };
    return query;
  },
  storage: { from: () => ({
    upload: async (_path: string, blob: Blob) => { saved.uploaded = blob; return { error: null }; },
    createSignedUrl: async () => ({ data: { signedUrl: "https://storage.invalid/synthetic-bundle" }, error: null }),
  }) },
} }));
vi.mock("./reportFormats", () => ({ encodeReport: async (text: string) => { saved.pdf = text; return new Blob([text], { type: "application/pdf" }); } }));

function bytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
}
beforeEach(() => { saved.uploaded = null; saved.pdf = ""; saved.inserts = []; vi.stubGlobal("crypto", webcrypto); });

describe("bundle record provenance", () => {
  it("keeps every raw record in ZIP while distinguishing unsupported records and provided subjects", async () => {
    const { manifest } = await generateEvidenceBundle("case-1", "user-1", "zip");
    const zip = await JSZip.loadAsync(await bytes(saved.uploaded!));
    const exported = JSON.parse(await zip.file("artifacts.json")!.async("string"));
    expect(exported.map((item: { data: string }) => item.data)).toEqual(artifacts.map(item => item.data));
    expect(exported.map((item: { assessment: { classification: string } }) => item.assessment.classification)).toEqual(["demo_output", "supplied_input", "failed_output"]);
    expect(manifest.recordSummary).toMatchObject({ savedRecords: 3, analystSupportedAssociations: 0 });
    expect(await zip.file("README.txt")!.async("string")).toContain("does not establish a person association");
    expect(await zip.file("MANIFEST.txt")!.async("string")).toContain("demo_output: 1");
    expect(JSON.parse(await zip.file("subjects.json")!.async("string"))[0]).toMatchObject({ name: "Supplied Person", notes: "An unreviewed supplied note", recordKind: "provided_subject_record" });
    expect(JSON.parse(await zip.file("timeline.json")!.async("string"))[0]).toMatchObject({ description: "Unreviewed recorded event", recordKind: "saved_event_record" });
    const hashInput = await zip.file("verification-input.json")!.async("string");
    const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
    expect(Buffer.from(digest).toString("hex")).toBe(manifest.verificationHash);
  });

  it("includes the same limitations, classifications and original data in PDF bundles", async () => {
    const { manifest } = await generateEvidenceBundle("case-1", "user-1", "legal-pdf");
    expect(saved.pdf).toContain("does not establish a person association");
    expect(saved.pdf).toContain('"classification": "demo_output"');
    expect(saved.pdf).toContain("invented-for-demo");
    expect(saved.pdf).toContain("provided_subject_record");
    expect(manifest.recordSummary.analystSupportedAssociations).toBe(0);
    expect(saved.inserts[0].metadata).toMatchObject({ recordSummary: { savedRecords: 3, analystSupportedAssociations: 0 } });
  });
});
