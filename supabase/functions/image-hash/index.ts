import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { z } from "npm:zod@3.23.8";
import { decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { safeFetch } from "../_shared/safeFetch.ts";
import { authenticateUser, boundedJsonBody, RequestAuthenticationError } from "../_shared/authenticateUser.ts";
import { inspectImage, hashDecodedImage, IMAGE_HASH_MAX_BYTES, IMAGE_HASH_MAX_PIXELS, IMAGE_HASH_MAX_SIDE } from "../_shared/imageHash.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.object({ url: z.string().url().max(2000) }).strict();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "error", reason: "method_not_allowed" }, 405);
  let body: unknown;
  try { await authenticateUser(req); body = await boundedJsonBody(req); }
  catch (error) { return json({ status: "error", reason: error instanceof RequestAuthenticationError ? error.code : "request_preparation_failed" }, error instanceof RequestAuthenticationError ? error.status : 503); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return json({ status: "error", reason: "invalid_body" }, 400);
  const url = parsed.data.url;

  try {
    const r = await safeFetch(url, { maxBytes: IMAGE_HASH_MAX_BYTES, timeoutMs: 10_000, credentials: "omit" });
    if (!r.ok) return json({ status: "error", reason: `fetch_failed_${r.status}` });
    const buf = new Uint8Array(await r.arrayBuffer());
    const header = inspectImage(buf);
    const img = await decode(buf);
    const hashes = hashDecodedImage(img, header);
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(buf).buffer);
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");

    return json({
      status: "success",
      result: {
        url,
        ...hashes, sha256,
        width: header.width,
        height: header.height,
        format: header.format,
        bytes: buf.byteLength,
        provenance: { source_url: url, decoder: "ImageScript 1.2.17", phash_bits: 63, phash_padding_bits: 1, dhash_bits: 64,
          alpha: "composited over white", max_bytes: IMAGE_HASH_MAX_BYTES, max_pixels: IMAGE_HASH_MAX_PIXELS, max_side: IMAGE_HASH_MAX_SIDE,
          scope: "Image fingerprint only; no reverse-image search, identity match, authenticity or ownership verification. Decoder orientation behavior requires runtime acceptance." },
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
