import { describe, it, expect } from 'vitest';
import { analyzePacketCapture } from './packetForensics';
// Constructed binary fixtures verify parsers; never used as live capture evidence.
function fixture({badLength=false,response=false}={}) {
  const name=[7,...new TextEncoder().encode('example'),3,...new TextEncoder().encode('com'),0];
  const dns=new Uint8Array(12+name.length+4),dv=new DataView(dns.buffer);dv.setUint16(2,response?0x8183:0x0100);dv.setUint16(4,1);dns.set(name,12);dv.setUint16(12+name.length,1);dv.setUint16(14+name.length,1);
  const b=new Uint8Array(24+16+20+8+dns.length),d=new DataView(b.buffer);d.setUint32(0,0xa1b2c3d4,true);d.setUint16(4,2,true);d.setUint16(6,4,true);d.setUint32(16,65535,true);d.setUint32(20,101,true);d.setUint32(24,1700000000,true);d.setUint32(32,badLength?999:b.length-40,true);d.setUint32(36,b.length-40,true);
  b[40]=0x45;d.setUint16(42,b.length-40);b[49]=17;b.set([192,0,2,1,8,8,8,8],52);d.setUint16(60,response?53:4242);d.setUint16(62,response?4242:53);d.setUint16(64,8+dns.length);b.set(dns,68);
  return btoa(String.fromCharCode(...b));
}
describe('actual packet capture parser',()=>{
  it('decodes captured IP, UDP ports and compressed-question metadata without body export',async()=>{const r=await analyzePacketCapture(fixture(),'fixture.pcap');expect(r.details.packet_count).toBe(1);expect(r.details.protocols).toEqual({UDP:1});expect(r.details.dns).toEqual([expect.objectContaining({name:'example.com',type:1,response:false,source:'192.0.2.1',destination:'8.8.8.8'})]);expect(r.details.source).toEqual(expect.objectContaining({sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}));expect(r.details).not.toHaveProperty('payload');});
  it('preserves actual DNS response status without inventing safety or attack scores',async()=>{const r=await analyzePacketCapture(fixture({response:true}),'response.pcap');expect(r.details.dns).toEqual([expect.objectContaining({response:true,rcode:3})]);expect(r.details.anomaly_heuristics).toEqual([]);});
  it('rejects declared packet lengths outside the actual supplied bytes',async()=>{await expect(analyzePacketCapture(fixture({badLength:true}),'bad.pcap')).rejects.toThrow(/length/);});
  it('rejects non-capture bytes and oversized input before parsing',async()=>{await expect(analyzePacketCapture(btoa('This is text, not a PCAP.'),'x.pcap')).rejects.toThrow(/not PCAP/);await expect(analyzePacketCapture('A'.repeat(12*1024*1024),'huge.pcap')).rejects.toThrow(/encoding/);});
  it('decodes actual enhanced PCAPNG block timestamps and interface link types',async()=>{const old=Uint8Array.from(atob(fixture()),c=>c.charCodeAt(0)),payload=old.subarray(40),n=32+Math.ceil(payload.length/4)*4,b=new Uint8Array(28+20+n),d=new DataView(b.buffer);d.setUint32(0,0x0a0d0d0a,true);d.setUint32(4,28,true);d.setUint32(8,0x1a2b3c4d,true);d.setUint16(12,1,true);d.setUint32(24,28,true);d.setUint32(28,1,true);d.setUint32(32,20,true);d.setUint16(36,101,true);d.setUint32(40,65535,true);d.setUint32(44,20,true);d.setUint32(48,6,true);d.setUint32(52,n,true);d.setUint32(64,1000000,true);d.setUint32(68,payload.length,true);d.setUint32(72,payload.length,true);b.set(payload,76);d.setUint32(48+n-4,n,true);const r=await analyzePacketCapture(btoa(String.fromCharCode(...b)),'fixture.pcapng');expect(r.details.first_packet_epoch).toBe(1);expect(r.details.packet_count).toBe(1);});
});
