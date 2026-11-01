import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(dir,entry.name)] : []); }
for (const file of [...files("src/lib"), ...files("src/hooks"), ...files("src/pages")]) {
  let source = fs.readFileSync(file,"utf8");
  const ast = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  function visit(node) {
    if (ts.isCallExpression(node) && (ts.isAwaitExpression(node.parent) || ts.isArrayLiteralExpression(node.parent)) && /^supabase\s*\.(?:from\s*\(|storage\s*\.)/.test(node.getText(ast))) {
      edits.push({ start: node.getStart(ast), end: node.end, text: `checkedDatabase(${node.getText(ast)})` });
      return;
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
  if (!edits.length) continue;
  for (const edit of edits.sort((a,b) => b.start-a.start)) source = source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  if (!source.includes('import { checkedDatabase }')) source = 'import { checkedDatabase } from "@/lib/checkedDatabase";\n'+source;
  fs.writeFileSync(file,source);
  process.stdout.write(`${file}: ${edits.length} database error guards\n`);
}
