// Real social-source indexing support. This adds public Telegram message records
// and cursor catch-up for the durable monitor worker; it does not grant private
// membership/history access or label public counts as a member list.
type SocialParams = Record<string, unknown>;
type SocialRecord = Record<string, unknown>;
const SOCIAL_SOURCE_AGENT = "InsightNexus/1.0 (contact: travis@tjksecurity.com)";
function socialText(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function socialDecode(html: string): string { return html.replace(/&#(x[\da-f]+|\d+);/gi, (_,value:string)=>{const n=value[0].toLowerCase()==="x"?parseInt(value.slice(1),16):Number(value);return n>=0&&n<=0x10ffff?String.fromCodePoint(n):"";}).replace(/&(?:nbsp|ensp|emsp);/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&mdash;/g,"—").replace(/&ndash;/g,"–").replace(/&hellip;/g,"…").replace(/&amp;/g,"&"); }
function socialPlain(html: string): string { return socialDecode(html.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi,"").replace(/<br\s*\/?\s*>|<\/(?:p|div|blockquote)>/gi,"\n").replace(/<[^>]*>/g,"")).replace(/[\t ]+/g," ").replace(/\n\s*\n\s*\n/g,"\n\n").trim(); }
function socialAttrs(tag: string): Record<string,string> { return Object.fromEntries(Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g),m=>[m[1],socialDecode(m[2]??m[3])])); }
function socialClassInner(html: string, wanted: string): string | null {
  const starts=Array.from(html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/gi));
  for(const start of starts){if(!(socialAttrs(start[0]).class||"").split(/\s+/).includes(wanted))continue;const name=start[1].toLowerCase(),from=(start.index||0)+start[0].length;let depth=1;const tags=/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;tags.lastIndex=from;
    for(let token;(token=tags.exec(html));){if(token[1].toLowerCase()!==name)continue;if(token[0].startsWith("</"))depth--;else if(!token[0].endsWith("/>"))depth++;if(depth===0)return html.slice(from,token.index);}return null;}
  return null;
}
function socialChannel(params: SocialParams): { channel: string; url: string } {
  const raw=socialText(params.url || params.channel_url || params.channel); if(!raw || raw.length>2048)throw new Error("Provide a public Telegram channel URL or username.");
  let channel=raw.replace(/^@/,"");
  if(raw.includes("://")){let parsed:URL;try{parsed=new URL(raw);}catch{throw new Error("Invalid Telegram URL.");}if(parsed.protocol!=="https:"||parsed.hostname!=="t.me"||parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||!/^\/s\/[A-Za-z][A-Za-z0-9_]{4,31}\/?$/.test(parsed.pathname))throw new Error("Provide https://t.me/s/PUBLIC_CHANNEL without login, invite, private paths or query parameters.");channel=parsed.pathname.split("/")[2];}
  if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(channel))throw new Error("Public Telegram username must be 5–32 characters, starting with a letter.");
  return {channel,url:`https://t.me/s/${channel}`};
}
async function socialTelegramPage(url: string): Promise<string> {
  let response:Response;try{response=await fetch(url,{headers:{"User-Agent":SOCIAL_SOURCE_AGENT,Accept:"text/html"},redirect:"error",signal:AbortSignal.timeout(15_000)});}catch{throw new Error("Telegram public source request failed or timed out; no alternate host or access workaround was used.");}
  if(!response.ok)throw new Error(`Telegram public source returned HTTP ${response.status}; no retry was made.`);
  const maximum=5_000_000;if(Number(response.headers.get("content-length"))>maximum){await response.body?.cancel().catch(()=>{});throw new Error("Telegram public page exceeded the 5 MB processing limit.");}
  const reader=response.body?.getReader();if(!reader)throw new Error("Telegram source returned no page body.");const decoder=new TextDecoder();let bytes=0,text="";
  try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>maximum)throw new Error("Telegram public page exceeded the 5 MB processing limit.");text+=decoder.decode(p.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!/tgme_widget_message/.test(text))throw new Error("Telegram did not supply a public message archive for this channel. No messages or members were inferred.");return text;
}
function socialParseTelegram(html: string, channel: string, pageUrl: string): { messages: SocialRecord[]; next: string | null; title: string | null } {
  const starts=Array.from(html.matchAll(/<div\b[^>]*\bdata-post="([^"]+)"[^>]*>/g));const messages:SocialRecord[]=[];
  for(let i=0;i<starts.length;i++){const start=starts[i],identifier=start[1],parts=identifier.split("/");if(parts.length!==2||parts[0].toLowerCase()!==channel.toLowerCase()||!/^\d{1,15}$/.test(parts[1]))continue;const id=Number(parts[1]);if(!Number.isSafeInteger(id)||id<1)continue;const block=html.slice(start.index,starts[i+1]?.index??html.length);const textInner=socialClassInner(block,"tgme_widget_message_text");const date=block.match(/<time\b[^>]*datetime="([^"]+)"/i)?.[1]||null;
    if(!date||!Number.isFinite(Date.parse(date)))throw new Error("Telegram message markup had no valid published timestamp; indexing was stopped.");
    const forwarded=socialClassInner(block,"tgme_widget_message_forwarded_from");const forwardAnchor=forwarded?.match(/<a\b[^>]*>/i)?.[0];const forwardUrl=forwardAnchor?socialAttrs(forwardAnchor).href:null;
    const links=Array.from(new Set(Array.from((textInner||"").matchAll(/<a\b[^>]*>/gi),m=>socialAttrs(m[0]).href).filter(link=>typeof link==="string"&&/^https?:\/\//i.test(link))));
    messages.push({id:identifier,channel,post_id:id,source:`https://t.me/${channel}/${id}`,source_page:pageUrl,published_at:date,text:textInner===null?null:socialPlain(textInner),text_status:textInner===null?"not_supplied":"retrieved",views_display:socialPlain(socialClassInner(block,"tgme_widget_message_views")||"")||null,edited:/tgme_widget_message_meta[^>]*>[\s\S]{0,300}?edited/i.test(block),forwarded_from:forwarded?{label:socialPlain(forwarded),url:forwardUrl&&/^https?:\/\//i.test(forwardUrl)?forwardUrl:null}:null,links});
  }
  if(!messages.length)throw new Error("Telegram page had no recognized message records; no empty archive result was fabricated.");
  const pagination=Array.from(html.matchAll(/<a\b[^>]*>/gi)).map(m=>socialAttrs(m[0])).find(a=>(a.class||"").split(/\s+/).includes("tme_messages_more")&&a.href);let next:string|null=null;
  if(pagination){const candidate=new URL(pagination.href,pageUrl);if(candidate.protocol==="https:"&&candidate.hostname==="t.me"&&candidate.pathname===`/s/${channel}`&&Array.from(candidate.searchParams.keys()).length===1&&/^\d{1,15}$/.test(candidate.searchParams.get("before")||""))next=candidate.toString();}
  const title=socialPlain(socialClassInner(html,"tgme_channel_info_header_title")||"")||null;return {messages,next,title};
}
export async function runMarketplaceSocialFull(tool: string, params: SocialParams): Promise<SocialRecord | undefined> {
  if(tool!=="telegram-monitor")return undefined;
  const {channel,url}=socialChannel(params);const rawAfter=socialText(params.after_post_id);let after:number|null=null;if(rawAfter){if(!/^\d{1,15}$/.test(rawAfter))throw new Error("after_post_id must be a nonnegative message ID.");after=Number(rawAfter);if(!Number.isSafeInteger(after))throw new Error("Invalid message cursor.");}
  const rawMax=socialText(params.max_pages);const maxPages=rawMax?Number(rawMax):5;if(!Number.isInteger(maxPages)||maxPages<1||maxPages>20)throw new Error("max_pages must be an integer from 1 to 20.");
  const history=params.mode==="history";const indexed=new Map<string,SocialRecord>();const observed=new Map<string,SocialRecord>();const pages:string[]=[];const seen=new Set<string>();let current:string|null=url,next:string|null=null,caughtUp=false,title:string|null=null,latest:number|null=null;
  for(let page=0;current&&page<maxPages;page++){if(seen.has(current))throw new Error("Telegram pagination repeated a page; indexing was stopped.");seen.add(current);const html=await socialTelegramPage(current);const parsed=socialParseTelegram(html,channel,current);pages.push(current);title=title||parsed.title;for(const message of parsed.messages){latest=Math.max(latest||0,Number(message.post_id));observed.set(String(message.id),message);if(after===null||Number(message.post_id)>after)indexed.set(String(message.id),message);}next=parsed.next;
    if(after!==null&&parsed.messages.some(m=>Number(m.post_id)<=after)){caughtUp=true;break;}if(!next){caughtUp=true;break;}if(after===null&&!history){caughtUp=true;break;}current=next;
  }
  const behind=after!==null&&latest!==null&&latest<after;if(behind)caughtUp=false;const messages=Array.from(indexed.values()).sort((a,b)=>Number(a.post_id)-Number(b.post_id));return {provider:"Telegram public channel web archive",source:url,channel,title,retrieved_at:new Date().toISOString(),messages,observed_messages:Array.from(observed.values()).sort((a,b)=>Number(a.post_id)-Number(b.post_id)),returned:messages.length,latest_post_id:latest,after_post_id:after,caught_up:caughtUp,source_cursor_behind:behind,status:behind?"source_cursor_behind":caughtUp?"complete_for_requested_cursor":"catch_up_incomplete",next_archive_page:next,pages_read:pages.length,page_sources:pages,monitor_payload:true,coverage:"Actual published channel message IDs, times, text, public forward attribution and links. Use observed_messages for change comparison and messages for new-message indexing in the durable monitor worker. Never move a stored cursor backwards; source_cursor_behind can indicate stale or unavailable source data. caught_up applies only to the requested cursor, not all historical messages. Public member identities, private groups and access-restricted messages are not supplied by this source; a count is not a member graph."};
}
