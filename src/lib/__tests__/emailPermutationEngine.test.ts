import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { generateEmailCandidates, normalizeDomain } = await import("@/lib/emailPermutationEngine");

describe("normalizeDomain", () => {
  it("strips scheme, path and leading local parts", () => {
    expect(normalizeDomain("https://Corp.com/careers?ref=1")).toBe("corp.com");
    expect(normalizeDomain("@corp.com")).toBe("corp.com");
    expect(normalizeDomain("jane@mail.corp.com")).toBe("mail.corp.com");
    expect(normalizeDomain("  corp.com.  ")).toBe("corp.com");
    expect(normalizeDomain("corp.com:8080")).toBe("corp.com");
  });

  it("rejects values that are not domains", () => {
    expect(normalizeDomain("corp")).toBeNull();
    expect(normalizeDomain("corp .com")).toBeNull();
    expect(normalizeDomain("-corp.com")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("generateEmailCandidates", () => {
  it("never emits malformed addresses from messy domain input", () => {
    const candidates = generateEmailCandidates("Jane", "Doe", ["@corp.com", "not a domain"], [
      "https://acme.io/jobs",
    ]);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
    }
    expect(candidates.some((c) => c.email === "jane.doe@corp.com")).toBe(true);
    expect(candidates.some((c) => c.email === "jane.doe@acme.io")).toBe(true);
  });

  it("ranks company domains above free providers and caps confidence at 1", () => {
    const candidates = generateEmailCandidates("Jane", "Doe", [], ["acme.io"]);
    expect(candidates[0].email).toBe("jane.doe@acme.io");
    for (const c of candidates) expect(c.confidence).toBeLessThanOrEqual(1);
  });

  it("deduplicates domains supplied in both lists", () => {
    const candidates = generateEmailCandidates("Jane", "Doe", ["acme.io"], ["ACME.io"]);
    const acme = candidates.filter((c) => c.email === "jane.doe@acme.io");
    expect(acme).toHaveLength(1);
    expect(acme[0].confidence).toBeGreaterThan(0.92);
  });

  it("falls back to free providers when no domain is supplied", () => {
    const candidates = generateEmailCandidates("Jane", undefined, [], []);
    expect(candidates.some((c) => c.email === "jane@gmail.com")).toBe(true);
  });
});
