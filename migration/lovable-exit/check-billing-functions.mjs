import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

// Static type checking only: exact pinned Stripe 18.5 declarations, existing
// installed Supabase declarations, and minimal Deno/serve declarations. No
// remote import resolution, network request, billing account or DB connection.
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const fixture=path.join(app,'migration/lovable-exit/test-sdk/node_modules/stripe');
try {
  const metadata=JSON.parse(fs.readFileSync(path.join(fixture,'package.json'),'utf8'));
  if(metadata.version!=='18.5.0')throw new Error('Install the isolated exact Stripe fixture with npm ci --prefix migration/lovable-exit/test-sdk --ignore-scripts --no-audit --no-fund');
  const virtual=path.join(app,'migration/lovable-exit/__deno_billing_check__.d.ts');
  const declaration='declare const Deno: {env:{get(name:string):string|undefined}}; declare module "https://deno.land/std@0.190.0/http/server.ts" {export function serve(handler:(req:Request)=>Promise<Response>|Response):void;} declare module "https://esm.sh/stripe@18.5.0" {export {default} from "stripe";}';
  const options={noEmit:true,strict:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true,lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts'],skipLibCheck:true};
  const host=ts.createCompilerHost(options);
  const originalSource=host.getSourceFile.bind(host);const originalExists=host.fileExists.bind(host);
  const isVirtual=file=>path.resolve(file).toLowerCase()===virtual.toLowerCase();
  host.fileExists=file=>isVirtual(file)||originalExists(file);
  host.getSourceFile=(file,languageVersion,onError,shouldCreateNew)=>isVirtual(file)?ts.createSourceFile(file,declaration,languageVersion):originalSource(file,languageVersion,onError,shouldCreateNew);
  host.resolveModuleNames=(names,containingFile)=>names.map(name=>{
    const mapped=name==='npm:@supabase/supabase-js@2.57.2'?'@supabase/supabase-js':name;
    return ts.resolveModuleName(mapped,containingFile,options,host).resolvedModule;
  });
  const program=ts.createProgram(['check-subscription','stripe-webhook','create-checkout','customer-portal','check-alerts'].map(name=>path.join(app,`supabase/functions/${name}/index.ts`)).concat(virtual,path.join(fixture,'types/index.d.ts')),options,host);
  const diagnostics=ts.getPreEmitDiagnostics(program);
  if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>app,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}));process.exitCode=1;}
  else console.log('Billing/alert handlers and shared Auth passed strict static types against pinned Stripe 18.5 and installed Supabase declarations (not a Deno runtime/deployment check).');
}catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}
