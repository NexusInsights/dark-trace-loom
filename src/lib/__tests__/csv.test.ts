import { describe, it, expect } from "vitest";
import { toCsv, sanitizeFilename } from "@/lib/csv";

interface Row {
  value: string;
  score: number | null;
}

const columns = [
  { header: "Value", value: (r: Row) => r.value },
  { header: "Score", value: (r: Row) => r.score },
];

describe("toCsv", () => {
  it("writes a header row even with no data", () => {
    expect(toCsv([], columns)).toBe("Value,Score");
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = toCsv([{ value: 'a,b "c"\nd', score: 1 }], columns);
    expect(csv).toBe('Value,Score\r\n"a,b ""c""\nd",1');
  });

  it("renders null and undefined as empty cells", () => {
    expect(toCsv([{ value: "x", score: null }], columns)).toBe("Value,Score\r\nx,");
  });

  it("neutralizes spreadsheet formulas", () => {
    const csv = toCsv([{ value: "=1+1", score: 0 }], columns);
    expect(csv).toBe("Value,Score\r\n'=1+1,0");
  });
});

describe("sanitizeFilename", () => {
  it("slugifies labels", () => {
    expect(sanitizeFilename("Jane Doe / Alias #2")).toBe("jane-doe-alias-2");
  });

  it("falls back when nothing usable remains", () => {
    expect(sanitizeFilename("///", "persona")).toBe("persona");
  });
});
