import fs from "node:fs/promises";
import ts from "typescript";
const source = await fs.readFile(new URL("../supabase/functions/osint-tools/marketplacePublic.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { runMarketplacePublic } = await import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`);
const cases = [
  ["vin-decoder", { vin: "5UXWX7C5XBA744634" }],
  ["corporate-records", { ticker: "AAPL", limit: 1 }],
  ["insider-tracker", { cik: "320193", limit: 1 }],
  ["satellite-search", { bbox: "-97.8,30.2,-97.7,30.3", limit: 1, max_cloud_cover: 60 }],
  ["sanctions-screening", { name: "AEROCARIBBEAN AIRLINES", lists: "all", limit: 5 }],
];
const evidence = [];
for (const [tool, params] of cases) {
  try {
    const result = await runMarketplacePublic(tool, params);
    if (!result) throw new Error("Missing handler result");
    if (tool === "vin-decoder" && result.vehicle?.Make !== "BMW") throw new Error("VIN provider record missing expected manufacturer");
    if (tool === "corporate-records" && !result.matches?.[0]?.name?.includes("Apple")) throw new Error("Company record missing");
    if (tool === "insider-tracker" && (!result.filings?.length || result.filings[0].status !== "parsed")) throw new Error("Ownership XML was not parsed");
    if (tool === "satellite-search" && (!result.scenes?.[0]?.id || !result.scenes[0].assets)) throw new Error("No real STAC scene/assets");
    if (tool === "sanctions-screening" && (result.status !== "complete" || !result.candidate_matches?.length)) throw new Error("Full sanctions dataset coverage failed");
    const item = { tool, passed: true, source: result.source || result.candidate_matches?.[0]?.source, retrieved_at: result.retrieved_at, returned: result.returned ?? result.candidate_matches?.length ?? 1,
      record: result.vehicle?.Make || result.matches?.[0]?.name || result.filings?.[0]?.accession_number || result.scenes?.[0]?.id || result.candidate_matches?.[0]?.name,
      coverage: result.coverage, transaction_count: result.filings?.[0]?.transactions?.length };
    evidence.push(item); console.log(JSON.stringify(item));
  } catch (error) { const item = { tool, passed: false, error: String(error) }; evidence.push(item); console.error(JSON.stringify(item)); process.exitCode = 1; }
}
if (process.argv.includes("--save")) await fs.writeFile(new URL("../deployment-evidence/marketplace-public-live.json", import.meta.url), JSON.stringify({ checked_at: new Date().toISOString(), execution: "Local Node calling actual public providers; backend live deployment is a separate check.", evidence }, null, 2));
