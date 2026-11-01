import fs from "node:fs";
import path from "node:path";
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir,e.name)] : []); }
for (const file of walk("src")) {
  let source = fs.readFileSync(file,"utf8"); const original = source;
  source = source.replace(/\.from\("breach_records"\)(\s*\.select\("(?:[^"\\]|\\.)*"\))(?!\.eq\("status")/g,'.from("breach_records")$1.eq("status", "exposure")');
  source = source.replace(/BEHAVIORAL SIMILARITY/g,"PATTERN SIMILARITY (HEURISTIC)").replace(/>Risk Score</g,">Connectivity Heuristic<");
  if (file.endsWith("correlationEngine.ts")) source = source.replace('username: /@([a-zA-Z0-9_]{2,30})/g','username: /(?<![a-zA-Z0-9._%+-])@([a-zA-Z0-9_]{2,30})\\b/g').replace('// Skip common false positives','if (type === "ip" && value.split(".").some(part => Number(part) > 255)) continue;\n      if (type === "phone" && value.replace(/\\D/g, "").length < 10) continue;\n      // Skip common false positives');
  if (file.endsWith("Index.tsx")) source = source.replace('Cryptographic audit trails for every evidence interaction.','Recorded evidence hashes and custody events; exports include the saved logs.').replace('Isolated investigation environments with zero-trust architecture.','Authenticated workspace access backed by database policies.').replace('Attribute online identities to real-world entities through behavioral correlation.','Collect sourced account records and review identity hypotheses against evidence.').replace('Encrypted Evidence Storage','Private Evidence Storage').replace('Real-time operational overview with active case metrics, threat alerts, and team activity.','Overview of saved case metrics, notifications and recorded team activity.');
  if (source !== original) fs.writeFileSync(file,source);
}
let profile = fs.readFileSync("src/pages/PersonaProfile.tsx","utf8");
const start = profile.indexOf("  // Clusters containing matched entities"); const end = profile.indexOf("  // Similarity pairs",start);
if (start < 0 || end < 0) throw new Error("Expected unused cluster aggregation not found");
profile = profile.slice(0,start)+profile.slice(end);
profile = profile.replace('  const { data: allClusters = [] } = useIdentityClusters();\n','').replace('    relatedClusters, relatedSimilarity,','    relatedSimilarity,');
fs.writeFileSync("src/pages/PersonaProfile.tsx",profile);
console.log("Only actual exposure records counted; inferred behavior and cluster identity claims clarified.");
