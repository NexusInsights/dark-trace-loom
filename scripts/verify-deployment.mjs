import { readFile, writeFile, mkdir } from "node:fs/promises";

const base = new URL(process.argv[2] || "https://dark-trace-loom.pages.dev");
if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/") {
  throw new Error("Expected an HTTPS site origin without credentials or path");
}

const evidence = { origin: base.origin, checkedAt: new Date().toISOString(), checks: [] };

async function request(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response;
}

try {
  const builtHtml = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const expectedAssets = [...builtHtml.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((match) => match[1]);
  if (expectedAssets.length < 2) throw new Error("Local build has no generated assets; run npm run build first");
  const root = await request("/");
  const html = await root.text();
  if (!html.includes("Insight Nexus") || !html.includes('id="root"')) throw new Error("Unexpected homepage HTML");
  if (expectedAssets.some((path) => !html.includes(`\"${path}\"`))) {
    throw new Error("Production is not yet serving the current local build; check deployment propagation before claiming verification");
  }
  evidence.currentBuildAssets = expectedAssets;
  for (const [name, value] of [["x-content-type-options", "nosniff"], ["x-frame-options", "DENY"]]) {
    if (root.headers.get(name) !== value) throw new Error(`Missing response header: ${name}`);
  }
  evidence.checks.push({ path: "/", status: root.status, cloudflare: root.headers.get("server"), securityHeaders: true });

  for (const path of ["/auth", "/auth?mode=signup", "/dashboard", "/reset-password", "/auth/callback", "/accept-invite"]) {
    const response = await request(path);
    if ((await response.text()) !== html) throw new Error(`SPA fallback failed for ${path}`);
    evidence.checks.push({ path, status: response.status, spaFallback: true });
  }

  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((match) => match[1]);
  if (assetPaths.length < 2) throw new Error("No generated JavaScript/CSS assets found");
  for (const path of assetPaths) {
    const response = await request(path);
    const bytes = (await response.arrayBuffer()).byteLength;
    if (!bytes) throw new Error(`Empty deployed asset: ${path}`);
    evidence.checks.push({ path, status: response.status, bytes, cache: response.headers.get("cache-control") });
  }
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  evidence.error = error instanceof Error ? error.message : "Unknown verification failure";
  process.exitCode = 1;
} finally {
  await mkdir("deployment-evidence", { recursive: true });
  await writeFile("deployment-evidence/live-http.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}
