/** Retrieve an authorized saved artifact, then download its actual bytes. */
export async function downloadArtifact(url: string): Promise<void> {
  const source = new URL(url);
  if (source.protocol !== "https:") throw new Error("Download must use an authorized HTTPS URL");
  const response = await fetch(source.href, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Artifact download failed (HTTP ${response.status})`);
  if (Number(response.headers.get("Content-Length")) > 150 * 1024 * 1024) throw new Error("Artifact exceeds the 150 MiB browser download limit");
  const blob = await response.blob();
  if (!blob.size || blob.size > 150 * 1024 * 1024) throw new Error("Artifact is empty or exceeds the browser download limit");
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = decodeURIComponent(source.pathname.split("/").pop() || "artifact");
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
}
