export const IMAGE_HASH_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_HASH_MAX_PIXELS = 4 * 1024 * 1024;
export const IMAGE_HASH_MAX_SIDE = 4096;
export const IMAGE_HASH_ALGORITHM = "insight-phash63-dhash64-white-alpha-v2";
export interface ImageHeader { format: "png" | "jpeg"; width: number; height: number; }
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunkCrc(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function validateDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error("invalid_image_dimensions");
  if (width > IMAGE_HASH_MAX_SIDE || height > IMAGE_HASH_MAX_SIDE || width * height > IMAGE_HASH_MAX_PIXELS) throw new Error("image_pixel_limit_exceeded");
}
// Reject unsupported formats and declared pixel bombs before allocating decoded RGBA.
export function inspectImage(bytes: Uint8Array): ImageHeader {
  if (!bytes.length || bytes.length > IMAGE_HASH_MAX_BYTES) throw new Error("image_too_large_or_empty");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) {
    if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") throw new Error("malformed_png");
    const width = view.getUint32(16), height = view.getUint32(20); validateDimensions(width, height);
    let position = 8, idat = false;
    while (position + 12 <= bytes.length) {
      const length = view.getUint32(position), end = position + 12 + length;
      if (end > bytes.length) break;
      if (chunkCrc(bytes, position + 4, end - 4) !== view.getUint32(end - 4)) throw new Error("malformed_png_crc");
      const type = String.fromCharCode(...bytes.slice(position + 4, position + 8));
      if (type === "IHDR" && position !== 8) throw new Error("malformed_png_duplicate_header");
      if (["acTL", "fcTL", "fdAT"].includes(type)) throw new Error("animated_images_unsupported");
      if (type === "IDAT") idat = true;
      if (type === "IEND" && length === 0 && end === bytes.length && idat) return { format: "png", width, height };
      position = end;
    }
    throw new Error("malformed_png");
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) {
    let position = 2; let header: ImageHeader | null = null;
    while (position + 4 <= bytes.length) {
      if (bytes[position++] !== 255) break;
      while (bytes[position] === 255) position++;
      const marker = bytes[position++];
      if (position + 2 > bytes.length || marker === 217) break;
      const length = view.getUint16(position);
      if (length < 2 || position + length > bytes.length - 2) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) break;
        const height = view.getUint16(position + 3), width = view.getUint16(position + 5); validateDimensions(width, height);
        header = { format: "jpeg", width, height };
      }
      if (marker === 218 && header && length >= 6 && position + length < bytes.length - 2) return header;
      position += length;
    }
    throw new Error("malformed_jpeg");
  }
  throw new Error("unsupported_or_malformed_image_format; use static JPEG or PNG");
}
function grayscale(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const j = i * 4, alpha = rgba[j + 3] / 255;
    out[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) * alpha + 255 * (1 - alpha);
  }
  return out;
}
function resize(src: Float64Array, width: number, height: number, dw: number, dh: number): Float64Array {
  const out = new Float64Array(dw * dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) out[y * dw + x] = src[Math.floor(y * height / dh) * width + Math.floor(x * width / dw)];
  return out;
}
function bitsToHex(bits: number[]): string {
  const padded = bits.concat(Array((4 - bits.length % 4) % 4).fill(0));
  let hex = "";
  for (let i = 0; i < padded.length; i += 4) hex += ((padded[i] << 3) | (padded[i + 1] << 2) | (padded[i + 2] << 1) | padded[i + 3]).toString(16);
  return hex;
}
function phash(gray: Float64Array): string {
  const size = 32, temporary = new Float64Array(size * size), dct = new Float64Array(size * size);
  const factor = (k: number) => (k === 0 ? 1 / Math.sqrt(2) : 1) * Math.sqrt(2 / size);
  for (let y = 0; y < size; y++) for (let k = 0; k < size; k++) {
    let sum = 0;
    for (let n = 0; n < size; n++) sum += gray[y * size + n] * Math.cos((2 * n + 1) * k * Math.PI / (2 * size));
    temporary[y * size + k] = sum * factor(k);
  }
  for (let x = 0; x < size; x++) for (let k = 0; k < size; k++) {
    let sum = 0;
    for (let n = 0; n < size; n++) sum += temporary[n * size + x] * Math.cos((2 * n + 1) * k * Math.PI / (2 * size));
    const value = sum * factor(k); dct[k * size + x] = Math.abs(value) < 1e-9 ? 0 : value;
  }
  const coefficients: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (x || y) coefficients.push(dct[y * size + x]);
  const median = [...coefficients].sort((a, b) => a - b)[31];
  return bitsToHex(coefficients.map(value => value > median ? 1 : 0));
}
export function hashDecodedImage(decoded: unknown, header: ImageHeader) {
  const image = decoded as { width?: number; height?: number; bitmap?: Uint8Array | Uint8ClampedArray };
  if (!image || Array.isArray(image) || image.width !== header.width || image.height !== header.height
    || !ArrayBuffer.isView(image.bitmap) || image.bitmap.BYTES_PER_ELEMENT !== 1 || image.bitmap.byteLength !== header.width * header.height * 4) throw new Error("invalid_decoder_output");
  validateDimensions(header.width, header.height);
  const gray = grayscale(image.bitmap, header.width, header.height);
  const small = resize(gray, header.width, header.height, 9, 8), bits: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(small[y * 9 + x] < small[y * 9 + x + 1] ? 1 : 0);
  return { phash: phash(resize(gray, header.width, header.height, 32, 32)), dhash: bitsToHex(bits), algorithm: IMAGE_HASH_ALGORITHM };
}
