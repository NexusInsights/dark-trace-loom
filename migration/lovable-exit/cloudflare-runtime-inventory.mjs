import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {checkedSource} from './bundle-sources.mjs';

// Source inventory only: never builds an image, installs a package or starts a
// container. COPY inputs are recorded even when they are test/support files.
export function cloudflareRuntimeInventory(app, {closure, fileRecord}) {
  const root=path.join(app,'services/cloudflare');
  const configFile=checkedSource(app,'services/cloudflare/wrangler.jsonc');
  const parsed=ts.parseConfigFileTextToJson(configFile,fs.readFileSync(configFile,'utf8'));
  if(parsed.error)throw new Error('Cloudflare container Worker configuration could not be parsed');
  const config=parsed.config;
  if(!Array.isArray(config.containers)||config.containers.length!==1)throw new Error('Review changed Cloudflare container inventory');
  const container=config.containers[0];
  const bounded=target=>{const relative=path.relative(app,target);if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Container build input escaped application');return target;};
  const context=bounded(path.resolve(root,container.image_build_context));
  const dockerfile=bounded(path.resolve(root,container.image));
  checkedSource(app,path.relative(app,dockerfile));
  const docker=fs.readFileSync(dockerfile,'utf8').replace(/\\\r?\n/g,' ');
  if(/^\s*ADD\s/im.test(docker))throw new Error('Docker ADD requires explicit source/dependency review');
  const copyLines=docker.split(/\r?\n/).filter(line=>/^\s*COPY\s/i.test(line));
  if(!copyLines.length)throw new Error('Container Dockerfile has no inventoried COPY inputs');
  const buildFiles=new Map();
  function add(file){const record=fileRecord(bounded(file));buildFiles.set(record.path,record);}
  function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('Container COPY symlink requires review');if(entry.isDirectory())walk(file);else add(file);}}
  for(const line of copyLines){
    const tokens=line.trim().split(/\s+/).slice(1);
    if(tokens.length<2||tokens.some(token=>/["'\[\]$]/.test(token))||tokens[0].startsWith('--'))throw new Error('Unsupported Docker COPY syntax requires explicit review');
    for(const source of tokens.slice(0,-1)){
      if(source.split(/[\\/]/).includes('..')||path.isAbsolute(source))throw new Error('Container COPY input escaped build context');
      const input=bounded(path.resolve(context,source));
      if(source.includes('*')){
        if(path.basename(source)!=='*.mjs'||path.dirname(source).includes('*'))throw new Error('Unsupported Docker COPY glob requires explicit review');
        const matched=fs.readdirSync(path.dirname(input),{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.mjs'));
        if(!matched.length)throw new Error('Docker COPY glob has no source files');
        for(const entry of matched)add(path.join(path.dirname(input),entry.name));
      }else if(fs.statSync(input).isDirectory())walk(input);else add(input);
    }
  }
  const entryLine=docker.match(/^\s*ENTRYPOINT\s+(\[[^\r\n]+\])/im);
  if(!entryLine)throw new Error('Container entrypoint requires explicit inventory review');
  const entries=JSON.parse(entryLine[1]).filter(value=>typeof value==='string'&&/\.[cm]?js$/.test(value));
  if(entries.length!==1)throw new Error('Container runtime entrypoint is ambiguous');
  const entry=bounded(path.resolve(context,entries[0]));
  const worker=closure(bounded(path.resolve(root,config.main)));
  const runtime=closure(entry);
  const slash=value=>value.split(path.sep).join('/');
  for(const row of runtime.files){if(!buildFiles.has(row.path))throw new Error('Container runtime dependency is absent from Docker COPY inputs: '+row.path);}
  add(dockerfile);add(dockerfile+'.dockerignore');
  const files=[...new Map([...worker.files,...runtime.files].map(row=>[row.path,row])).values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  return {
    name:'services/cloudflare',runtime_kind:'cloudflare_worker_with_container',entrypoint:slash(path.relative(app,path.resolve(root,config.main))),
    files,external_dependencies:[...new Set([...worker.external_dependencies,...runtime.external_dependencies])].sort(),
    configuration_file:fileRecord(configFile),
    configuration_names_only:[...new Set([...worker.configuration_names_only,...runtime.configuration_names_only,...Object.keys(config.vars??{})])].sort(),
    dynamic_lookups_requiring_source_review:[...worker.dynamic_lookups_requiring_source_review,...runtime.dynamic_lookups_requiring_source_review],
    binding_names:(config.durable_objects?.bindings??[]).map(row=>row.name).sort(),
    backend_project_refs:[...new Set(JSON.stringify(config.vars??{}).match(/[a-z]{20}(?=\.supabase\.co)/g)??[])],
    container:{name:container.name,class_name:container.class_name,image_build_context:slash(path.relative(app,context))||'.',
      runtime_entrypoint:slash(path.relative(app,entry)),runtime_files:runtime.files,
      build_source_files:[...buildFiles.values()].sort((a,b)=>a.path.localeCompare(b.path,'en')),
      scheduling_policy:container.scheduling_policy,max_instances:container.max_instances,instance_type:container.instance_type,
      dockerignore_review:'All local COPY source files are inventoried conservatively; Docker ignore rules are retained as hashed build inputs.'},
    deployment_status:'not_deployed',
    billing_gate:'Cloudflare Containers requires Workers Paid; prior account check was rejected. No paid-plan/resource approval or live container acceptance is established by this inventory.',
    deployment_requirement:'Obtain explicit approval for paid Containers/resources and verify current entitlement before deployment; preserve server-only token authentication before starting compute, scoped browser/Tor access, and the single-instance cap. Local source checks are not live acceptance.',
  };
}
