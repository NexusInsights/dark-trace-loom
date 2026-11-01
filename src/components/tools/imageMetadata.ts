import { safeFetch } from "../../../supabase/functions/_shared/safeFetch";
import { ToolExecutionError } from "./executeTool";
import type { ToolResult } from "./types";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 10000;
// Validate a complete metadata container, not pixel authenticity or ownership.
function containerFormat(buffer: ArrayBuffer): "JPEG" | "PNG" {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    const view = new DataView(buffer); let position = 2; let frame = false;
    while (position + 4 <= bytes.length) {
      if (bytes[position++] !== 0xff) break;
      while (bytes[position] === 0xff) position++;
      const marker = bytes[position++];
      if (position + 2 > bytes.length || marker === 0xd9) break;
      const length = view.getUint16(position);
      if (length < 2 || position + length > bytes.length - 2) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8 || !view.getUint16(position + 3) || !view.getUint16(position + 5)) break;
        frame = true;
      }
      if (marker === 0xda && frame && length >= 6 && position + length < bytes.length - 2) return "JPEG";
      position += length;
    }
  }
  if (bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) {
    const view = new DataView(buffer); let position = 8; let ihdr = false; let idat = false;
    while (position + 12 <= bytes.length) {
      const length = view.getUint32(position); const end = position + 12 + length;
      if (end > bytes.length) break;
      const type = String.fromCharCode(...bytes.slice(position + 4, position + 8));
      if (position === 8) {
        if (type !== "IHDR" || length !== 13 || !view.getUint32(position + 8) || !view.getUint32(position + 12)) break;
        ihdr = true;
      }
      if (type === "IDAT") idat = true;
      if (type === "IEND" && length === 0 && end === bytes.length && ihdr && idat) return "PNG";
      position = end;
    }
  }
  throw new ToolExecutionError("Invalid, incomplete, or unsupported image container. Use a direct JPEG or PNG URL.");
}

export async function extractImageMetadata(inputs: Record<string, string>): Promise<ToolResult> {
  const sourceUrl = inputs.image_url.trim();
  const response = await safeFetch(sourceUrl, { mode: "cors", credentials: "omit", maxBytes: IMAGE_MAX_BYTES, timeoutMs: IMAGE_TIMEOUT_MS });
  if (!response.ok) throw new ToolExecutionError("Image source HTTP " + response.status);
  const buffer = await response.arrayBuffer(); const format = containerFormat(buffer);
  const { default: exifr } = await import("exifr");
  let metadata: Record<string, unknown> | undefined;
  try { metadata = await exifr.parse(buffer, { gps: true, tiff: true, exif: true, iptc: true, icc: false }); }
  catch { throw new ToolExecutionError("Image metadata parser failed; absence of EXIF was not confirmed."); }
  const latitude = metadata?.latitude, longitude = metadata?.longitude;
  const geolocation = typeof latitude === "number" && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
  const warnings = !geolocation && (latitude != null || longitude != null)
    ? ["Embedded GPS coordinates are incomplete or invalid; no geolocation finding was produced."] : [];
  const hasMetadata = metadata && Object.keys(metadata).length > 0;
  return {
    status: warnings.length ? "partial" : "success",
    summary: `${hasMetadata ? "Image metadata extracted" : "No readable metadata found"}${warnings.length ? " with warnings" : ""} (${(buffer.byteLength / 1024).toFixed(1)} KB)`,
    details: {
      source_url: sourceUrl,
      size_bytes: buffer.byteLength, format, exif: hasMetadata ? metadata : null, geolocation, warnings, notes: inputs.notes || null,
      provenance: { source: "fetched image bytes", parser: "exifr", max_bytes: IMAGE_MAX_BYTES, timeout_ms: IMAGE_TIMEOUT_MS,
        scope: "Container and metadata parsing only. GPS is embedded metadata, not a verified image location. No pixel decoding or authenticity verification." },
    },
    tags: ["image", "exif", "metadata", ...(geolocation ? ["geolocation"] : [])],
  };
}
