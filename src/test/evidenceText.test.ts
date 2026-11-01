import { describe, it, expect } from "vitest";
import { evidenceText } from "../lib/evidenceText";
describe("evidence observations", () => {
  it("excludes generated interpretation and candidate identities while keeping retrieved records", () => {
    expect(evidenceText(JSON.stringify({profiles:[{username:"actual",profileUrl:"https://github.com/actual"}],ai_interpretation:{email:"invented@example.org"},email_candidates:["guess@example.org"],summary:"suggested"}))).toBe("actual\nhttps://github.com/actual");
  });
  it("preserves supplied unstructured evidence as text, without asserting ownership", () => expect(evidenceText("Subject supplied @actual")).toBe("Subject supplied @actual"));
});
