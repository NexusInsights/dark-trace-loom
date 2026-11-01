// Actual supplied packet bytes only. No remote upload or invented traffic.
import type { ToolResult } from './types';
type Packet = { time: number | null; bytes: Uint8Array; link: number; original: number };
const MAX = 8 * 1024 * 1024;
const LIMIT = 100000;
function packets(bytes: Uint8Array): { format: string; packets: Packet[]; warnings: string[] } {
  if(bytes.length<24 || bytes.length>MAX) throw new Error('Provide a complete PCAP/PCAPNG capture of at most 8 MiB.');
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), list:Packet[]=[], warnings:string[]=[];
  const magic=d.getUint32(0,false);
  if([0xa1b2c3d4,0xd4c3b2a1,0xa1b23c4d,0x4d3cb2a1].includes(magic)) {
    const le=[0xd4c3b2a1,0x4d3cb2a1].includes(magic), nano=[0xa1b23c4d,0x4d3cb2a1].includes(magic);
    if(d.getUint16(4,le)!==2 || d.getUint16(6,le)!==4) throw new Error('Unsupported PCAP version.');
    const link=d.getUint32(20,le)&0xffff;
    let off=24;
    while(off<bytes.length) {
      if(list.length>=LIMIT) throw new Error('Capture exceeds the 100,000-packet analysis limit.');
      if(off+16>bytes.length) throw new Error('Truncated PCAP packet header.');
      const cap=d.getUint32(off+8,le), original=d.getUint32(off+12,le);
      if(cap>original || off+16+cap>bytes.length) throw new Error('Invalid or truncated PCAP packet length.');
      const fraction=d.getUint32(off+4,le); if(fraction>=(nano?1e9:1e6)) throw new Error('Invalid PCAP timestamp fraction.');
      list.push({time:d.getUint32(off,le)+fraction/(nano?1e9:1e6),bytes:bytes.subarray(off+16,off+16+cap),link,original}); off+=16+cap;
    }
    return {format:'PCAP',packets:list,warnings};
  }
  if(magic!==0x0a0d0d0a) throw new Error('File is not PCAP or PCAPNG. HAR and DNS logs use their text inputs.');
  let off=0,le=true,interfaces:{link:number;resolution:number}[]=[];
  while(off<bytes.length) {
    if(off+12>bytes.length) throw new Error('Truncated PCAPNG block.');
    const section=d.getUint32(off,false)===0x0a0d0d0a;
    if(section) {if(off+28>bytes.length) throw new Error('Truncated PCAPNG section.'); const order=d.getUint32(off+8,false);if(![0x1a2b3c4d,0x4d3c2b1a].includes(order))throw new Error('Invalid PCAPNG byte order.');le=order===0x4d3c2b1a;interfaces=[];}
    const type=d.getUint32(off,le),length=d.getUint32(off+4,le);
    if(length<12 || length%4 || off+length>bytes.length || d.getUint32(off+length-4,le)!==length)throw new Error('Invalid PCAPNG block length.');
    if(type===1) {
      if(length<20)throw new Error('Invalid PCAPNG interface block.');
      let resolution=1e-6;
      for(let p=off+16;p+4<=off+length-4;) {const code=d.getUint16(p,le),n=d.getUint16(p+2,le);if(code===0)break;if(p+4+n>off+length-4)throw new Error('Invalid interface option.');if(code===9&&n===1){const v=bytes[p+4];resolution=v&128?Math.pow(2,-(v&127)):Math.pow(10,-v);}p+=4+Math.ceil(n/4)*4;}
      interfaces.push({link:d.getUint16(off+8,le),resolution});
    } else if(type===6) {
      if(length<32)throw new Error('Invalid enhanced packet block.');
      const intf=interfaces[d.getUint32(off+8,le)],cap=d.getUint32(off+20,le),original=d.getUint32(off+24,le);
      if(!intf || cap>original || 28+Math.ceil(cap/4)*4>length-4)throw new Error('Invalid enhanced packet interface/length.');
      const ticks=d.getUint32(off+12,le)*4294967296+d.getUint32(off+16,le);
      list.push({time:ticks*intf.resolution,bytes:bytes.subarray(off+28,off+28+cap),link:intf.link,original});
    } else if(type===3) {
      if(length<16 || !interfaces[0])throw new Error('Invalid simple packet block.');
      const original=d.getUint32(off+8,le),cap=Math.min(original,length-16);
      list.push({time:null,bytes:bytes.subarray(off+12,off+12+cap),link:interfaces[0].link,original});
    } else if(!section) warnings.push(`Block type ${type} was retained in source but is not decoded.`);
    if(list.length>LIMIT)throw new Error('Capture exceeds the 100,000-packet analysis limit.'); off+=length;
  }
  return {format:'PCAPNG',packets:list,warnings:[...new Set(warnings)]};
}
function dnsName(b:Uint8Array,start:number):{name:string;next:number} {
  let p=start,next=-1;const labels:string[]=[],seen=new Set<number>();
  for(let depth=0;depth<64;depth++) {
    if(p>=b.length || seen.has(p))throw new Error('Invalid DNS name compression.');seen.add(p);const n=b[p++];
    if(!n)return {name:labels.join('.'),next:next<0?p:next};
    if((n&192)===192){if(p>=b.length)throw new Error('Truncated DNS pointer.');if(next<0)next=p+1;p=((n&63)<<8)|b[p];continue;}
    if(n>63 || p+n>b.length)throw new Error('Invalid DNS label.');
    labels.push(new TextDecoder().decode(b.subarray(p,p+n)));p+=n;
  }
  throw new Error('DNS name exceeded compression-depth limit.');
}
export async function analyzePacketCapture(encoded:string,filename:string):Promise<ToolResult> {
  if(!encoded || encoded.length>Math.ceil(MAX*4/3)+4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('Invalid capture encoding.');
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)), capture=packets(bytes);
  const flows=new Map<string,{source:string;destination:string;source_port:number|null;destination_port:number|null;protocol:string;packets:number;captured_bytes:number;syn:number;reset:number;first:number|null;last:number|null}>();
  const dns:{name:string;type:number;response:boolean;rcode:number;time:number|null;source:string;destination:string}[]=[], warnings=[...capture.warnings];let undecoded=0,truncated=0;
  const protocols:Record<string,number>={};
  for(const packet of capture.packets) {
    const b=packet.bytes,d=new DataView(b.buffer,b.byteOffset,b.length);if(b.length<packet.original)truncated++;
    let off=0,ether=0;
    if(packet.link===1){if(b.length<14){undecoded++;continue;}ether=d.getUint16(12);off=14;for(let n=0;n<2&&[0x8100,0x88a8].includes(ether);n++){if(off+4>b.length)break;ether=d.getUint16(off+2);off+=4;}}
    else if([101,228,229].includes(packet.link)){ether=(b[0]>>4)===4?0x800:0x86dd;}
    else if(packet.link===113&&b.length>=16){ether=d.getUint16(14);off=16;}
    else {undecoded++;continue;}
    let source='',destination='',ipProto=0,end=b.length;
    if(ether===0x800) {
      if(off+20>b.length || b[off]>>4!==4){undecoded++;continue;}const h=(b[off]&15)*4,len=d.getUint16(off+2);if(h<20||len<h||off+h>b.length){undecoded++;continue;}
      source=[...b.subarray(off+12,off+16)].join('.');destination=[...b.subarray(off+16,off+20)].join('.');ipProto=b[off+9];end=Math.min(b.length,off+len);
      if(d.getUint16(off+6)&0x1fff){warnings.push('IP fragments with nonzero offsets were not reassembled.');undecoded++;continue;}off+=h;
    } else if(ether===0x86dd) {
      if(off+40>b.length){undecoded++;continue;}const ip=(p:number)=>Array.from({length:8},(_,i)=>d.getUint16(p+i*2).toString(16)).join(':');source=ip(off+8);destination=ip(off+24);ipProto=b[off+6];end=Math.min(b.length,off+40+d.getUint16(off+4));off+=40;
      if([0,43,44,50,51,60].includes(ipProto)){warnings.push('IPv6 extension headers were not decoded.');undecoded++;continue;}
    } else {protocols[`EtherType 0x${ether.toString(16)}`]=(protocols[`EtherType 0x${ether.toString(16)}`]||0)+1;undecoded++;continue;}
    const protocol=ipProto===6?'TCP':ipProto===17?'UDP':ipProto===1||ipProto===58?'ICMP':`IP ${ipProto}`;protocols[protocol]=(protocols[protocol]||0)+1;
    let sport:number|null=null,dport:number|null=null,flags=0,payload=off;
    if([6,17].includes(ipProto)&&off+4<=end){sport=d.getUint16(off);dport=d.getUint16(off+2);if(ipProto===17){if(off+8>end){undecoded++;continue;}payload=off+8;end=Math.min(end,off+d.getUint16(off+4));}else{if(off+20>end){undecoded++;continue;}const h=(b[off+12]>>4)*4;if(h<20||off+h>end){undecoded++;continue;}flags=b[off+13];payload=off+h;}}
    const key=`${source}:${sport}>${destination}:${dport}/${protocol}`,flow=flows.get(key)||{source,destination,source_port:sport,destination_port:dport,protocol,packets:0,captured_bytes:0,syn:0,reset:0,first:packet.time,last:packet.time};flow.packets++;flow.captured_bytes+=b.length;flow.syn+=(flags&2)?1:0;flow.reset+=(flags&4)?1:0;if(packet.time!==null){flow.first=flow.first===null?packet.time:Math.min(flow.first,packet.time);flow.last=flow.last===null?packet.time:Math.max(flow.last,packet.time);}flows.set(key,flow);
    if((sport===53||dport===53)&&[6,17].includes(ipProto)) {
      let db=b.subarray(payload,end);if(ipProto===6){if(db.length<2)continue;const n=new DataView(db.buffer,db.byteOffset,db.length).getUint16(0);if(n>db.length-2){warnings.push('DNS over TCP messages spanning packets were not reassembled.');continue;}db=db.subarray(2,2+n);}if(db.length<12)continue;
      try{const dv=new DataView(db.buffer,db.byteOffset,db.length),f=dv.getUint16(2),q=dv.getUint16(4);let p=12;for(let i=0;i<Math.min(q,32);i++){const name=dnsName(db,p);p=name.next;if(p+4>db.length)throw new Error('Truncated DNS question.');dns.push({name:name.name,type:dv.getUint16(p),response:!!(f&0x8000),rcode:f&15,time:packet.time,source,destination});p+=4;}}catch(e){warnings.push(e instanceof Error?e.message:'DNS parsing failed.');}
    }
  }
  const times=capture.packets.flatMap(p=>p.time===null?[]:[p.time]), start=times.length?Math.min(...times):null,last=times.length?Math.max(...times):null,duration=start!==null&&last!==null?last-start:null;
  const queries=dns.filter(q=>!q.response),responses=dns.filter(q=>q.response),nxdomain=responses.filter(q=>q.rcode===3).length;
  const heuristics:{indicator:string;observed:number;threshold:number;meaning:string}[]=[];
  if(responses.length>=10&&nxdomain/responses.length>0.3)heuristics.push({indicator:'High DNS NXDOMAIN fraction',observed:nxdomain/responses.length,threshold:0.3,meaning:'Possible misconfiguration or scanning; this is not a maliciousness finding.'});
  const destinationsBySource=new Map<string,Set<number>>();for(const f of flows.values())if(f.destination_port!==null){const set=destinationsBySource.get(f.source)||new Set<number>();set.add(f.destination_port);destinationsBySource.set(f.source,set);}for(const [source,ports]of destinationsBySource)if(ports.size>=20)heuristics.push({indicator:`Many destination ports from ${source}`,observed:ports.size,threshold:20,meaning:'Observed fan-out merits review; authorized scans and normal services may explain it.'});
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  return {summary:`${capture.packets.length} captured packets; ${flows.size} flows; ${queries.length} DNS questions`,tags:['actual-capture','local-analysis'],details:{source:{filename,format:capture.format,bytes:bytes.length,sha256:sha},packet_count:capture.packets.length,truncated_packets:truncated,undecoded_packets:undecoded,protocols,first_packet_epoch:start,last_packet_epoch:last,duration_seconds:duration,captured_bytes:capture.packets.reduce((n,p)=>n+p.bytes.length,0),flows:[...flows.values()].slice(0,2000),flows_truncated:flows.size>2000,dns:dns.slice(0,2000),dns_records_truncated:dns.length>2000,dns_query_count:queries.length,dns_response_count:responses.length,anomaly_heuristics:heuristics,warnings:[...new Set(warnings)],coverage:'Actual supplied Ethernet/raw-IP/Linux cooked IPv4/IPv6 PCAP or PCAPNG bytes, TCP/UDP/ICMP metadata, DNS questions and measured traffic heuristics. Encrypted payloads, fragmented streams, unknown link types and unseen activity are not inferred. No packet payload or credentials are exported.'}};
}
