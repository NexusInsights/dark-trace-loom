import fs from "node:fs";
import path from "node:path";
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir,e.name)] : []); }
for (const file of [...walk("src/lib"),...walk("src/hooks"),...walk("src/pages")]) {
  let source = fs.readFileSync(file,"utf8"); const original = source;
  if (!file.endsWith("infrastructureEngine.ts")) source = source.replace(/\.from\("infrastructure_links"\)(?!\s*\.eq\("source_tool")/g,'.from("infrastructure_links").eq("source_tool", "live-dns")');
  source = source.replace(/"Risk Distribution"/g,'"Connectivity Distribution (heuristic)"').replace(/"RISK SCORE"/g,'"CONNECTIVITY HEURISTIC"').replace(/"Risk Score"/g,'"Connectivity Heuristic"').replace(/High-Risk Personas/g,'Highly Connected Personas').replace(/high-risk personas/g,'highly connected personas');
  if (source !== original) fs.writeFileSync(file,source);
}
const timelineFile = "src/lib/personaTimelineEngine.ts";
let timeline = fs.readFileSync(timelineFile,"utf8");
const start = timeline.indexOf("  // 2. Username creation events"); const end = timeline.indexOf("  // 4. Entity creation events",start);
if (start < 0 || end < 0) throw new Error("Timeline candidate block not found");
timeline = timeline.slice(0,start)+timeline.slice(end);
const deletion = 'await checkedDatabase(supabase.from("persona_events").delete().eq("persona_id", personaId).eq("user_id", userId));';
if (!timeline.includes(deletion)) throw new Error("Expected timeline clear operation not found");
timeline = timeline.replace(deletion,'const existing = await checkedDatabase(supabase.from("persona_events").select("event_type,event_timestamp,event_label").eq("persona_id", personaId).eq("user_id", userId));\n  const existingKeys = new Set((existing.data || []).map(event => `${event.event_type}:${event.event_timestamp}:${event.event_label}`));\n  const fresh = events.filter(event => !existingKeys.has(`${event.event_type}:${event.event_timestamp}:${event.event_label}`));');
timeline = timeline.replace(/i < events.length/g,"i < fresh.length").replace("events.slice(i, i + batchSize)","fresh.slice(i, i + batchSize)");
fs.writeFileSync(timelineFile,timeline);
const indexFile = "src/pages/Index.tsx";
let index = fs.readFileSync(indexFile,"utf8");
const mockStart = index.indexOf("              {/* Mock UI */}"); const mockEnd = index.indexOf('              <div className="flex items-center gap-2 mb-2">',mockStart);
if (mockStart < 0 || mockEnd < 0) throw new Error("Landing mock preview not found");
index = index.slice(0,mockStart)+index.slice(mockEnd);
index = index.replace('{ label: "Investigations", value: "10K+" }','{ label: "Evidence", value: "Source links" }').replace('{ label: "Data Sources", value: "250+" }','{ label: "Public profile APIs", value: "5" }').replace('{ label: "Uptime SLA", value: "99.9%" }','{ label: "Provider status", value: "Reported per query" }').replace('AES-256 encryption for all evidence artifacts and investigation data.','Private investigation records with authenticated access and storage permissions.').replace('Produce verified, exportable intelligence packages.','Export saved records, source references and recorded custody logs.');
fs.writeFileSync(indexFile,index);
console.log("Legacy inferred DNS hidden, timeline guesses excluded, mock preview and unsupported marketing claims removed.");
