import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}
    else if(ch==='"'){if(field)throw new Error('Invalid quoted CSV field');quoted=true;}
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\n'){row.push(field.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if(quoted)throw new Error('Unterminated CSV quote');
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  if(!rows.length||rows[0].join(',')!=='relation,row_count,id_set_digest')throw new Error('Expected exact administrative count-query CSV header');
  const map=new Map();
  for(const cells of rows.slice(1)){
    if(cells.length!==3||!/^(public|auth)\.[a-z_][a-z0-9_]*$/.test(cells[0])||!/^\d+$/.test(cells[1])||!(/^[a-f0-9]{32}$/).test(cells[2])||map.has(cells[0]))throw new Error('Malformed or duplicate relation evidence');
    map.set(cells[0],{count:BigInt(cells[1]),digest:cells[2]});
  }
  if(!map.size)throw new Error('Empty count evidence');
  return map;
}
try{
  const args=process.argv.slice(2);
  if(args.length!==2 && !(args.length===4&&args[2]==='--bundle'&&args[3]))throw new Error('Usage: node compare-counts.mjs SOURCE_COUNTS.csv TARGET_COUNTS.csv [--bundle CURRENT_BUNDLE_DIRECTORY]');
  const taskDir=path.dirname(fileURLToPath(import.meta.url));
  const bundle=args.length===4?path.resolve(args[3]):path.join(taskDir,'bundle');
  const verification=spawnSync(process.execPath,[path.join(taskDir,'verify-bundle.mjs'),'--bundle',bundle],{encoding:'utf8',timeout:30000,windowsHide:true});
  if(verification.error||verification.status!==0)throw new Error('Count acceptance requires a current verified bundle; use --bundle CURRENT_BUNDLE_DIRECTORY: '+(verification.stderr||verification.error?.message||'verification failed').trim());
  const source=parseCsv(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
  const target=parseCsv(fs.readFileSync(process.argv[3],'utf8').replace(/^\uFEFF/,''));
  const inventory=JSON.parse(fs.readFileSync(path.join(bundle,'inventory.json'),'utf8'));
  if(!Array.isArray(inventory.public_tables)||!inventory.public_tables.length)throw new Error('Expected bundle table inventory is missing');
  const required=[...inventory.public_tables.map(table=>`public.${table}`),'auth.users','auth.identities'];
  if(required.some(relation=>!source.has(relation)||!target.has(relation)))throw new Error('Count evidence omits a required local table or Auth relation; subset equality is not complete acceptance');
  const differences=[];
  for(const relation of [...new Set([...source.keys(),...target.keys()])].sort()){
    const a=source.get(relation),b=target.get(relation);
    if(!a||!b)differences.push({relation,error:'Relation missing from one evidence file'});
    else if(a.count!==b.count||a.digest!==b.digest)differences.push({relation,row_count_matches:a.count===b.count,id_set_matches:a.digest===b.digest});
  }
  if(differences.length){console.error(JSON.stringify({matches:false,differences}));process.exitCode=1;}
  else console.log(JSON.stringify({matches:true,relations:source.size,scope:'Counts and sorted ID sets only; not a comparison of record values, files, RLS behavior or provider execution'}));
}catch(error){console.error(error instanceof Error?error.message:'Count evidence comparison failed');process.exitCode=1;}
