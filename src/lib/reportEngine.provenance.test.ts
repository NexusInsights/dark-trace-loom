import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateReport } from "./reportEngine";

const saved = vi.hoisted(() => ({
  artifacts: [] as Array<{ id: string; artifact_type: string; data: string; created_at: string }>,
  uploaded: null as Blob | null,
  markdown: "",
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const rows = table === "cases" ? { id: "case-1", title: "Synthetic case", description: "Provided description", created_at: "2026-11-01T00:00:00Z" }
      : table === "subjects" ? [{ id: "subject-1", name: "Ann", type: "person", notes: "Provided notes" }]
      : table === "artifacts" ? saved.artifacts : [];
    const query = { select: () => query, eq: () => query, order: () => query, in: () => query,
      insert: () => query, single: async () => ({ data: table === "reports" ? { id: "report-1" } : rows, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) };
    return query;
  },
  storage: { from: () => ({
    upload: async (_path: string, blob: Blob) => { saved.uploaded = blob; return { error: null }; },
    createSignedUrl: async () => ({ data: { signedUrl: "https://storage.invalid/synthetic-report" }, error: null }),
  }) },
} }));
vi.mock("./reportFormats", () => ({ encodeReport: async (markdown: string) => {
  saved.markdown = markdown;
  return new Blob([markdown], { type: "application/pdf" });
} }));

function artifact(id: string, value: unknown, type = "saved-tool-result") {
  return { id, artifact_type: type, data: typeof value === "string" ? value : JSON.stringify(value), created_at: "2026-11-01T00:00:00Z" };
}
function text(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
}
async function jsonReport() {
  await generateReport("case-1", "user-1", "investigation-summary", "json");
  return JSON.parse(await text(saved.uploaded!));
}

beforeEach(() => { saved.artifacts = []; saved.uploaded = null; saved.markdown = ""; });

describe("report provenance boundaries", () => {
  it("preserves input, generated, failed, partial, demo and rejected records without promoting them to findings", async () => {
    saved.artifacts = [
      artifact("input", { source: "input", username: "supplied-handle" }),
      artifact("candidate", { source: "username_permutation", username: "generated-handle" }),
      artifact("failure", { status: "error", error: "Synthetic provider failure", username: "not-observed" }),
      artifact("partial", { status: "partial", details: { username: "incomplete" } }),
      artifact("demo", { status: "demo", details: { username: "example" } }),
      artifact("rejected", { decision: "rejected", profile_url: "https://github.com/synthetic" }),
    ];
    const report = await jsonReport();
    expect(report.artifacts.map((item: { data: string }) => item.data)).toEqual(saved.artifacts.map(item => item.data));
    expect(report.artifacts.map((item: { assessment: { classification: string } }) => item.assessment.classification)).toEqual([
      "supplied_input", "generated_candidate", "failed_output", "partial_output", "demo_output", "rejected_association",
    ]);
    expect(report.recordSummary.analystSupportedAssociations).toBe(0);
  });

  it("keeps a cited account observation separate from a person association", async () => {
    saved.artifacts = [artifact("account", { status: "success", evidenceKind: "public_account", profileUrl: "https://github.com/synthetic", sourceUrl: "https://api.github.com/users/synthetic", retrievedAt: "2026-11-01T00:00:00Z" })];
    const report = await jsonReport();
    expect(report.artifacts[0].assessment).toMatchObject({ classification: "sourced_observation", sourceUrl: "https://api.github.com/users/synthetic", retrievedAt: "2026-11-01T00:00:00Z", personAssociation: "not_established" });
    expect(report.recordSummary.analystSupportedAssociations).toBe(0);
  });

  it("does not establish a source or person association from arbitrary or malformed saved text", async () => {
    saved.artifacts = [artifact("legacy", "Ann might be @somebody; this is a saved analyst note"), artifact("malformed", '{"sourceUrl":')];
    const report = await jsonReport();
    expect(report.artifacts).toHaveLength(2);
    expect(report.artifacts.every((item: { assessment: { classification: string } }) => item.assessment.classification === "unreviewed_record")).toBe(true);
  });

  it("requires complete supported-association metadata rather than a positive classification string", async () => {
    saved.artifacts = [artifact("assertion", { metadata: { identity_evidence: { classification: "analyst_supported_association", source_url: "https://github.com/synthetic" } } })];
    const report = await jsonReport();
    expect(report.artifacts[0].assessment.personAssociation).toBe("not_established");
    expect(report.recordSummary.analystSupportedAssociations).toBe(0);
  });

  it("does not trust even complete association metadata embedded in arbitrary artifact JSON", async () => {
    const metadata = { identity_evidence: { classification: "analyst_supported_association", persona_id: "persona-1", account_id: "github:123", profile_url: "https://github.com/synthetic", lookup_result_id: "lookup-1", review_id: "forged-or-stale-review", source_url: "https://api.github.com/users/synthetic", retrieved_at: "2026-11-01T00:00:00Z", supporting_source_url: "https://github.com/synthetic", reviewed_at: "2026-11-02T00:00:00Z" } };
    saved.artifacts = [artifact("forged", { metadata }), artifact("demo-claim", { metadata, status: "demo" }), artifact("rejected-claim", { metadata, decision: "rejected" })];
    const report = await jsonReport();
    expect(report.artifacts.map((item: { assessment: { classification: string } }) => item.assessment.classification)).toEqual(["unvalidated_association_claim", "demo_output", "rejected_association"]);
    expect(report.artifacts.every((item: { assessment: { personAssociation: string } }) => item.assessment.personAssociation === "not_established")).toBe(true);
    expect(report.recordSummary).toMatchObject({ analystSupportedAssociations: 0, associationValidation: "not_performed" });
    expect(report.artifacts[0].assessment.label).toContain("not revalidated");
  });

  it("does not attach an artifact to a subject because its name is a substring", async () => {
    saved.artifacts = [artifact("unrelated", { description: "Annual plan; contains Ann but establishes no association" })];
    await generateReport("case-1", "user-1", "subject-profile", "pdf");
    expect(saved.markdown).not.toContain("Related Artifacts");
    expect(saved.markdown).toContain("No subject association is inferred from names or text matches");
  });

  it("renders demo, failed and source-cited classifications in human-readable evidence exports", async () => {
    saved.artifacts = [artifact("demo", { status: "demo" }), artifact("failure", { status: "not_configured" }), artifact("source", { status: "success", source_url: "https://www.example.org/record", retrieved_at: "2026-11-01T00:00:00Z" })];
    await generateReport("case-1", "user-1", "evidence-list", "pdf");
    expect(saved.markdown).toContain("Demo output");
    expect(saved.markdown).toContain("Failed or unavailable output");
    expect(saved.markdown).toContain("Source-cited observation");
    expect(saved.markdown).toContain("https://www.example.org/record");
    expect(saved.markdown).toContain("not_configured");
  });

  it("does not accept unsafe source URLs or missing retrieval timestamps as sourced observations", async () => {
    saved.artifacts = [artifact("unsafe", { sourceUrl: "javascript:alert(1)", retrievedAt: "2026-11-01T00:00:00Z" }), artifact("undated", { sourceUrl: "https://www.example.org/record" }), artifact("invalid-date", { sourceUrl: "https://www.example.org/record", retrievedAt: "0" }), artifact("private-source", { sourceUrl: "https://127.0.0.1/record", retrievedAt: "2026-11-01T00:00:00Z" })];
    const report = await jsonReport();
    expect(report.artifacts.every((item: { assessment: { classification: string } }) => item.assessment.classification === "unreviewed_record")).toBe(true);
  });
});
