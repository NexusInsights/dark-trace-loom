import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { jaccard, normalizedSimilarity } = await import("@/lib/similarityEngine");

describe("normalizedSimilarity", () => {
  it("is 1 for case-insensitive equality and 0 for empty input", () => {
    expect(normalizedSimilarity("JaneDoe", " janedoe ")).toBe(1);
    expect(normalizedSimilarity("", "janedoe")).toBe(0);
  });

  it("scales with edit distance", () => {
    expect(normalizedSimilarity("janedoe", "janedo3")).toBeCloseTo(6 / 7, 5);
    expect(normalizedSimilarity("abc", "xyz")).toBe(0);
  });
});

describe("jaccard", () => {
  it("measures set overlap", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3, 5);
    expect(jaccard(new Set(["a"]), new Set(["a"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set())).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});
