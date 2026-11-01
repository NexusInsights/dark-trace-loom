import { describe, expect, it } from "vitest";
import { readToolUpload, validateToolInputs } from "./ToolRunner";
import { marketplaceLocalTools } from "./marketplaceLocalTools";

describe("tool file upload boundaries", () => {
  const document = marketplaceLocalTools.find(tool => tool.id === "document-forensics")!;

  it("allows only declared file fields to exceed the normal text limit", () => {
    const bytes = "A".repeat(100000);
    expect(validateToolInputs(document, { file_base64: bytes, filename: "document.pdf" }).file_base64).toBe(bytes);
    expect(() => validateToolInputs(document, { filename: bytes })).toThrow("Input value too long");
    expect(() => validateToolInputs(document, { arbitrary: bytes })).toThrow("Input value too long");
  });

  it("rejects oversized uploads and input collections", () => {
    expect(() => validateToolInputs(document, { file_base64: "A".repeat(Math.ceil(8 * 1024 * 1024 * 4 / 3) + 10) })).toThrow("upload limit");
    expect(() => validateToolInputs(document, Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key${index}`, "value"])))).toThrow("Too many input fields");
  });

  it("reads the actual selected file bytes as base64", async () => {
    const input = new File(["%PDF-1.7\nactual supplied bytes"], "evidence.pdf", { type: "application/pdf" });
    const result = await readToolUpload(input, document.fields.find(field => field.key === "file_base64")!);
    expect(atob(result)).toBe("%PDF-1.7\nactual supplied bytes");
  });

  it("rejects empty or oversized files before reading them", async () => {
    const field = document.fields.find(field => field.key === "file_base64")!;
    await expect(readToolUpload(new File([], "empty.pdf"), field)).rejects.toThrow("nonempty file");
    await expect(readToolUpload(new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.pdf"), field)).rejects.toThrow("no larger than 8 MiB");
  });
});
