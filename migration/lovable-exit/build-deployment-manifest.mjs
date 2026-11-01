import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

// Inventory only. Resolves local import closures and hashes bytes; does not
// fetch modules, inspect secret values, call providers, or deploy functions.
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const slash=value=>value.split(path.sep).join('/');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function boundedFile(file){const relative=path.relative(app,file);if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||fs.lstatSync(file).isSymbolicLink())throw new Error('Dependency path escaped application or is a symlink');return file;}
function fileRecord(file){const bytes=fs.readFileSync(boundedFile(file));return {path:slash(path.relative(app,file)),bytes:bytes.length,sha256:hash(bytes)};}
function closure(entry){
  const files=new Map(),external=new Set(),configuration=new Set(),dynamic=[];
  function visit(file){
    file=path.resolve(file);boundedFile(file);if(files.has(file))return;
    files.set(file,fileRecord(file));
    const text=fs.readFileSync(file,'utf8');
    if(!/\.[cm]?[jt]sx?$/.test(file))return;
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    function imported(specifier){
      if(specifier.startsWith('.')){
        const clean=specifier.split('?')[0];let target=path.resolve(path.dirname(file),clean);
        const relative=path.relative(app,target);if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Import escaped application');
        if(!fs.existsSync(target)||!fs.statSync(target).isFile()){
          const candidates=[`${target}.ts`,`${target}.js`,path.join(target,'index.ts'),path.join(target,'index.js')].filter(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
          if(candidates.length!==1)throw new Error(`Local import is missing or ambiguous: ${slash(path.relative(app,target))}`);
          target=candidates[0];
        }
        visit(target);
      }
      else external.add(specifier);
    }
    function inspect(node){
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))imported(node.moduleSpecifier.text);
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){if(node.arguments.length===1&&ts.isStringLiteral(node.arguments[0]))imported(node.arguments[0].text);else dynamic.push({file:slash(path.relative(app,file)),kind:'nonliteral_dynamic_import'});}
      if(ts.isCallExpression(node)&&node.expression.getText(source)==='Deno.env.get'){
        if(node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))configuration.add(node.arguments[0].text);
        else dynamic.push({file:slash(path.relative(app,file)),kind:'dynamic_configuration_lookup'});
      }
      if(ts.isStringLiteral(node)&&/^(?:SUPABASE_|MARKETPLACE_|MONITOR_|WORKERS_AI_|ALERTS_|AI_)[A-Z0-9_]+$|^[A-Z][A-Z0-9_]+_(?:KEY|TOKEN|SECRET)$|^APP_ORIGIN$/.test(node.text))configuration.add(node.text);
      if(ts.isPropertyAccessExpression(node)&&node.expression.getText(source)==='env'&&/^[A-Z][A-Z0-9_]+$/.test(node.name.text))configuration.add(node.name.text);
      if(ts.isElementAccessExpression(node)&&node.expression.getText(source)==='env'&&ts.isStringLiteral(node.argumentExpression)&&/^[A-Z][A-Z0-9_]+$/.test(node.argumentExpression.text))configuration.add(node.argumentExpression.text);
      ts.forEachChild(node,inspect);
    }
    inspect(source);
  }
  visit(entry);
  return {files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path,'en')),external_dependencies:[...external].sort(),configuration_names_only:[...configuration].sort(),dynamic_lookups_requiring_source_review:dynamic};
}
function verifyJwt(config,name){const match=config.match(new RegExp(`\\[functions\\.${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`));if(!match)return 'not_explicit_in_local_config';const value=match[1].match(/verify_jwt\s*=\s*(true|false)/);return value?value[1]==='true':'not_explicit_in_local_config';}
const boundary={
  'accept-invite':'Verified user/email + exact invitation token; target atomic service-role-only RPC must exist',
  'admin-users':'Verified user plus administrator permission',
  'analyze-case':'Verified user plus case access; independent AI requires allowance/readiness',
  'api-gateway':'Direct stored api_keys.key match with active/owner checks (plaintext schema preserved; not hash verification), separate from user bearer Auth',
  'api-keys':'Verified user; original key ownership and administration',
  'breach-lookup':'Verified user; existing provider availability and entitlement',
  'check-alerts':'Verified user plus no-input check_owned_stored_alerts SQL wrapper; only postgres native cron invokes the internal engine; no separate HTTP scheduler/global writer',
  'check-subscription':'Verified user/email; exact local override; unavailable Stripe preserves local data with pending billing verification',
  'create-checkout':'Verified user plus reviewed product/return origin; migration must not create a purchase',
  'customer-portal':'Verified user/customer plus reviewed return origin',
  'identity-expansion':'Verified user/case permissions and provider ownership',
  'image-hash':'Shared remote session verification before image body/network/decode',
  'invite-member':'Verified user/org-admin; recipient and approved actual mail provider',
  'osint-dispatch':'Verified user and dispatch permission; preserve scan authorization/allowlists',
  'osint-tools':'Core verified session plus marketplace per-tool permission; provider budget/access guards',
  'social-profile-scrape':'Verified user/social-scrape permission before retrieval and independent AI; Firecrawl verified allowance',
  'stripe-webhook':'Raw-body verified Stripe signature, app product scope, exact stored provider refs, override preservation; no user JWT expected',
  'wigle-lookup':'Shared remote session verification before provider request',
};
try{
  const dir=path.join(app,'supabase/functions');const config=fs.readFileSync(path.join(app,'supabase/config.toml'),'utf8');
  const names=fs.readdirSync(dir,{withFileTypes:true}).filter(row=>row.isDirectory()&&!row.name.startsWith('_')).map(row=>row.name).sort();
  const functions=names.map(name=>({name,entrypoint:`supabase/functions/${name}/index.ts`,verify_jwt_local_config:verifyJwt(config,name),authorization_review_requirement:boundary[name]??'Manual handler permission review required',...closure(path.join(dir,name,'index.ts'))}));
  const osint=functions.find(row=>row.name==='osint-tools');
  const sourceModules=['../_shared/independentAi.ts','marketplacePublic.ts','marketplaceOpen.ts','marketplaceConnected.ts','marketplaceLicensed.ts','marketplaceAlternatives.ts','marketplaceSocialFull.ts','marketplaceAuth.ts','marketplaceDispatch.ts'];
  osint.assembly_source_files=sourceModules.map(name=>fileRecord(path.resolve(dir,'osint-tools',name)));
  osint.assembly_requirement='Root must run scripts/assemble-marketplace-backend.mjs after the final module edit and verify the assembled index before regenerating this manifest; assembly sources are not runtime imports in the flattened index.';
  const workers=['ai-worker','monitor-worker'].map(name=>{
    const configFile=path.join(app,name,'wrangler.jsonc');const parsed=ts.parseConfigFileTextToJson(configFile,fs.readFileSync(configFile,'utf8'));
    if(parsed.error)throw new Error(`Worker configuration could not be parsed: ${name}`);
    const worker=parsed.config;const dependencies=closure(path.join(app,name,worker.main));return {name,...dependencies,configuration_file:fileRecord(configFile),configuration_names_only:[...new Set([...dependencies.configuration_names_only,...Object.keys(worker.vars??{})])].sort(),binding_names:[...(worker.ai?[worker.ai.binding]:[]),...(worker.durable_objects?.bindings??[]).map(row=>row.name)].sort(),backend_project_refs:[...new Set(JSON.stringify(worker.vars??{}).match(/[a-z]{20}(?=\.supabase\.co)/g)??[])],deployment_requirement:name==='monitor-worker'?'Update old backend configuration to owned target while preserving existing Durable Object namespace/jobs and original user IDs; reauthenticate stored source sessions, avoid duplicate schedulers':'Verify free-plan/no-overage entitlement, model allowance and Auth/permission before one authorized inference'};
  });
  const pages=['api/breach-preview.js','api/gateway/[[path]].js','api/marketplace-monitor/[[path]].js','api/marketplace-port-scan.js','api/profile-search.js'].map(name=>({route_file:`functions/${name}`,...closure(path.join(app,'functions',name)),deployment_requirement:'Owned target Pages Auth configuration/bearer verification and correct service bindings; active scan still requires explicit PORTSCAN_ALLOWED_IPS'}));
  const manifest={format_version:1,provenance:'Static local deployment dependency manifest; source hashes/configuration names only. Not evidence of deployment, secret availability, provider entitlement or fully implemented tool scope.',destination_project_ref:'ocliymtdvtxfxczxgbjr',protected_project_refs:['zisrsttmjeipkmllqubi','dbdkvrkmeowdydizrsmn'],functions,workers,cloudflare_pages_routes:pages,shared_source_files:fs.readdirSync(path.join(dir,'_shared')).filter(name=>name.endsWith('.ts')).sort().map(name=>fileRecord(path.join(dir,'_shared',name))),required_prior_database_changes:['authoritative owned-target application schema and original record restoration','reviewed invitation policy hardening and service-role-only SECURITY INVOKER accept_organization_invitation RPC','reviewed postgres-only stored alert engine and authenticated no-input owner wrapper before deploying check-alerts','rollback fixture/ACL/concurrency review before separate native cron activation'],remote_actions:0,secret_values_copied:0};
  const output=path.join(app,'migration/lovable-exit/deployment-manifest.json');fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({prepared:true,functions:functions.length,workers:workers.length,pages_routes:pages.length,shared_files:manifest.shared_source_files.length,path:slash(path.relative(app,output)),sha256:hash(fs.readFileSync(output)),remote_actions:0,secret_values_copied:0}));
}catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}
