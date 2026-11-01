import fs from "node:fs";
import path from "node:path";
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir,e.name)] : []); }
for (const file of walk("src")) {
  const original = fs.readFileSync(file,"utf8");
  let source = original.replaceAll('.from("infrastructure_links").eq("source_tool", "live-dns")','.from("infrastructure_links")');
  if (!file.endsWith("infrastructureEngine.ts")) source = source.replace(/\.from\("infrastructure_links"\)(\s*\.select\("(?:[^"\\]|\\.)*"\))/g,'.from("infrastructure_links")$1.eq("source_tool", "live-dns")');
  if (source !== original) fs.writeFileSync(file,source);
}
