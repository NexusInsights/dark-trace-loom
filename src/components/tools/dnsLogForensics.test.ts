import {describe,expect,it} from "vitest";
import {analyzeDnsLog} from "./dnsLogForensics";
import {marketplaceLocalTools} from "./marketplaceLocalTools";
const row={ts:1700000000.25,uid:"actual-uid", "id.orig_h":"192.0.2.10","id.orig_p":54321,"id.resp_h":"1.1.1.1","id.resp_p":53,proto:"udp",trans_id:123,query:"example.org",qtype:1,qtype_name:"A",rcode:0,rcode_name:"NOERROR",answers:["192.0.2.20"],TTLs:[60],rtt:0.02};
const dig=`; <<>> DiG 9.18 <<>> example.org
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 123
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 0
;; QUESTION SECTION:
;example.org. IN A

;; ANSWER SECTION:
example.org. 60 IN A 192.0.2.20

;; Query time: 20 msec
;; SERVER: 1.1.1.1#53(1.1.1.1) (UDP)
;; WHEN: Tue Oct 13 12:00:00 CDT 2026
;; MSG SIZE  rcvd: 56
`;
describe("actual DNS log input",()=>{
  it("preserves Zeek JSONL endpoints, questions, actual answers/TTLs and timing without inventing packets",async()=>{const r=await analyzeDnsLog(JSON.stringify(row)+"\n"+JSON.stringify({...row,ts:1700000001,trans_id:124,qtype:28,qtype_name:"AAAA",answers:[],TTLs:[]}));expect(r.details.record_count).toBe(2);expect(r.details.duration_seconds).toBe(0.75);expect(r.details.dns).toMatchObject([{source:"192.0.2.10",destination:"1.1.1.1",answers:["192.0.2.20"],ttls:[60],query_time_seconds:0.02},{answers:[],answers_status:"supplied_empty"}]);expect(r.details).not.toHaveProperty("packet_count");expect(r.details.source).toMatchObject({sha256:expect.stringMatching(/^[0-9a-f]{64}$/)});});
  it("distinguishes omitted answers from an actually supplied empty list",async()=>{const {answers,TTLs,...without}=row;void answers;void TTLs;const r=await analyzeDnsLog(JSON.stringify(without));expect(r.details.dns).toMatchObject([{answers:null,ttls:null,answers_status:"not_supplied"}]);expect(r.details.records_without_answer_field).toBe(1);});
  it("parses standard dig resource records while preserving its printed time without guessing client timezone/IP",async()=>{const r=await analyzeDnsLog(dig,"dig-output.txt");expect(r.details.dns).toMatchObject([{query:"example.org.",qtype:1,rcode_name:"NOERROR",destination:"1.1.1.1",destination_port:53,source:null,timestamp_epoch:null,timestamp_raw:"Tue Oct 13 12:00:00 CDT 2026",answers:["192.0.2.20"],answer_records:[{ttl:60,type:"A",data:"192.0.2.20"}]}]);});
  it("rejects unrelated JSON, malformed JSONL, invalid fields and misaligned TTLs without substituting records",async()=>{await expect(analyzeDnsLog(JSON.stringify({log:{entries:[]}}))).rejects.toThrow("ts");await expect(analyzeDnsLog(JSON.stringify(row)+"\nnot-json")).rejects.toThrow("line 2");await expect(analyzeDnsLog(JSON.stringify({...row,"id.resp_p":99999}))).rejects.toThrow("numeric range");await expect(analyzeDnsLog(JSON.stringify({...row,TTLs:[]}))).rejects.toThrow("align");});
  it("rejects short dig answers and incomplete question sections rather than guessing their query",async()=>{await expect(analyzeDnsLog("192.0.2.20")).rejects.toThrow("not supported dig");await expect(analyzeDnsLog(dig.replace(";example.org. IN A",""))).rejects.toThrow("actual question");});
  it("reports measured DNS error concentrations with a transparent denominator and no attack verdict",async()=>{const r=await analyzeDnsLog(JSON.stringify(Array.from({length:10},(_,i)=>({...row,trans_id:i,rcode:i<4?3:0,rcode_name:i<4?"NXDOMAIN":"NOERROR",answers:[],TTLs:[]}))));expect(r.details.anomaly_heuristics).toMatchObject([{observed:0.4,denominator:10,threshold:0.3}]);expect(r.details).not.toHaveProperty("attack_score");});
  it("bounds actual UTF-8 bytes before parsing",async()=>{await expect(analyzeDnsLog("é".repeat(5*1024*1024))).rejects.toThrow("8 MiB");});
  it("runs the wired DNS upload branch and rejects competing input formats",async()=>{const tool=marketplaceLocalTools.find(t=>t.id==="network-forensics");expect(tool).toBeDefined();expect(tool?.fields).toEqual(expect.arrayContaining([expect.objectContaining({key:"dns_upload",fileEncoding:"text"}),expect.objectContaining({key:"dns_log",type:"textarea"})]));const result=await tool!.process({dns_upload:JSON.stringify(row),dns_filename:"actual-dns.jsonl"});expect(result.details.source).toMatchObject({filename:"actual-dns.jsonl",format:"Zeek DNS JSON/JSONL"});expect(result.details.record_count).toBe(1);await expect(tool!.process({dns_log:JSON.stringify(row),har_json:JSON.stringify({log:{entries:[]}})})).rejects.toThrow("Select one");});
});
