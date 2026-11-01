import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { encodeReport } from "./reportFormats";
async function bytes(blob: Blob): Promise<ArrayBuffer> { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); }); }
describe("actual export formats", () => {
  it("creates a PDF file rather than HTML", async () => {
    const blob = await encodeReport("# Evidence\nSource: https://github.com/octocat","pdf");
    expect(new TextDecoder().decode((await bytes(blob)).slice(0,5))).toBe("%PDF-");
    expect(blob.type).toBe("application/pdf");
  });
  it("creates a real DOCX package with document XML", async () => {
    const blob = await encodeReport("# Evidence\nActual source record","docx");
    const zip = await JSZip.loadAsync(await bytes(blob));
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(await zip.file("word/document.xml")!.async("string")).toContain("Actual source record");
  });
});
