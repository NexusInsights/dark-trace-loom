import ts from 'typescript';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'supabase/functions/osint-tools/index.ts');
const declaration = path.join(root, '__marketplace_deno_check__.d.ts');
const options = { noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [], skipLibCheck: true };
const host = ts.createCompilerHost(options);
const originalSource = host.getSourceFile.bind(host);
const isDeclaration = filename => path.resolve(filename).toLowerCase() === declaration.toLowerCase();
const originalExists = host.fileExists.bind(host);
host.fileExists = filename => isDeclaration(filename) || originalExists(filename);
host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => isDeclaration(filename)
  ? ts.createSourceFile(filename, 'declare const Deno: { env: {get(name:string): string|undefined}, serve(handler:(req:Request)=>Promise<Response>|Response):unknown };', languageVersion)
  : originalSource(filename, languageVersion, onError, shouldCreateNewSourceFile);
try {
  const program = ts.createProgram([file, declaration], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\n' }));
    process.exitCode = 1;
  } else console.log('Assembled marketplace backend TypeScript check passed.');
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
