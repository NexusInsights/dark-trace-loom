import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { z } from "npm:zod@3.23.8";
import { decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { safeFetch } from "../_shared/safeFetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.object({ url: z.string().url() });

// Convert RGBA pixel buffer to grayscale float array of size w*h
function toGrayscale(rgba: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}

// Nearest-neighbor resize of a grayscale image
function resizeGray(src: Float64Array, sw: number, sh: number, dw: number, dh: number): Float64Array {
  const out = new Float64Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.floor((y * sh) / dh);
    for (let x = 0; x < dw; x++) {
      const sx = Math.floor((x * sw) / dw);
      out[y * dw + x] = src[sy * sw + sx];
    }
  }
  return out;
}

// 2D DCT-II on N x N grayscale buffer (separable implementation, N small)
function dct2(input: Float64Array, N: number): Float64Array {
  const tmp = new Float64Array(N * N);
  const out = new Float64Array(N * N);
  const c = (k: number) => (k === 0 ? 1 / Math.sqrt(2) : 1);
  // rows
  for (let y = 0; y < N; y++) {
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) {
        sum += input[y * N + n] * Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N));
      }
      tmp[y * N + k] = sum * c(k) * Math.sqrt(2 / N);
    }
  }
  // cols
  for (let x = 0; x < N; x++) {
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) {
        sum += tmp[n * N + x] * Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N));
      }
      out[k * N + x] = sum * c(k) * Math.sqrt(2 / N);
    }
  }
  return out;
}

function bitsToHex(bits: number[]): string {
  // pack bits MSB first into hex
  const padded = bits.length % 4 === 0 ? bits : bits.concat(Array(4 - (bits.length % 4)).fill(0));
  let hex = "";
  for (let i = 0; i < padded.length; i += 4) {
    const nib = (padded[i] << 3) | (padded[i + 1] << 2) | (padded[i + 2] << 1) | padded[i + 3];
    hex += nib.toString(16);
  }
  return hex;
}

function pHash(gray32: Float64Array): string {
  const dct = dct2(gray32, 32);
  // top-left 8x8 excluding [0,0]
  const coeffs: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue;
      coeffs.push(dct[y * 32 + x]);
    }
  }
  const sorted = [...coeffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const bits = coeffs.map((v) => (v > median ? 1 : 0));
  return bitsToHex(bits);
}

function dHash(gray9x8: Float64Array): string {
  const bits: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = gray9x8[y * 9 + x];
      const right = gray9x8[y * 9 + x + 1];
      bits.push(left < right ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

function sniffFormat(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return "unknown";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ status: "error", reason: "invalid_body" }, 400);
  const url = parsed.data.url;

  try {
    const r = await safeFetch(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 10_000 });
    if (!r.ok) return json({ status: "error", reason: `fetch_failed_${r.status}` });
    const buf = new Uint8Array(await r.arrayBuffer());
    const format = sniffFormat(buf);

    const img = await decode(buf);
    // img.bitmap is a Uint8ClampedArray of RGBA
    const rgba = new Uint8Array(img.bitmap.buffer, img.bitmap.byteOffset, img.bitmap.byteLength);
    const w = img.width;
    const h = img.height;
    const gray = toGrayscale(rgba, w, h);
    const g32 = resizeGray(gray, w, h, 32, 32);
    const g9 = resizeGray(gray, w, h, 9, 8);

    return json({
      status: "success",
      result: {
        url,
        phash: pHash(g32),
        dhash: dHash(g9),
        width: w,
        height: h,
        format,
        bytes: buf.byteLength,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("exceeded") && msg.includes("bytes")) {
      return json({ status: "error", reason: "image_too_large" });
    }
    return json({ status: "error", reason: msg });
  }
});