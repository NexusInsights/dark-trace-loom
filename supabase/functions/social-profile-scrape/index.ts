const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

function detectPlatform(url: string): string {
  const h = url.toLowerCase();
  if (h.includes("twitter.com") || h.includes("x.com")) return "X / Twitter";
  if (h.includes("instagram.com")) return "Instagram";
  if (h.includes("linkedin.com")) return "LinkedIn";
  if (h.includes("facebook.com")) return "Facebook";
  if (h.includes("tiktok.com")) return "TikTok";
  if (h.includes("github.com")) return "GitHub";
  if (h.includes("reddit.com")) return "Reddit";
  if (h.includes("youtube.com") || h.includes("youtu.be")) return "YouTube";
  if (h.includes("threads.net")) return "Threads";
  if (h.includes("mastodon")) return "Mastodon";
  if (h.includes("bsky") || h.includes("bluesky")) return "Bluesky";
  if (h.includes("medium.com")) return "Medium";
  if (h.includes("substack.com")) return "Substack";
  return "Unknown";
}

// Build alternate front-end URLs that mirror the same content but are scrapable.
function alternateUrls(target: string): string[] {
  const alts: string[] = [];
  try {
    const u = new URL(target);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const handle = path.split("/").filter(Boolean)[0] || "";

    if (host === "twitter.com" || host === "x.com" || host === "mobile.twitter.com") {
      if (handle) {
        alts.push(`https://nitter.net/${handle}`);
        alts.push(`https://nitter.privacydev.net/${handle}`);
        alts.push(`https://nitter.poast.org/${handle}`);
      }
    } else if (host === "instagram.com") {
      if (handle) {
        alts.push(`https://www.picuki.com/profile/${handle}`);
        alts.push(`https://imginn.com/${handle}/`);
      }
    } else if (host === "tiktok.com" || host === "vm.tiktok.com") {
      const h = handle.startsWith("@") ? handle.slice(1) : handle;
      if (h) alts.push(`https://www.tiktok.com/@${h}`);
    } else if (host === "reddit.com" || host === "www.reddit.com") {
      alts.push(`https://old.reddit.com${u.pathname}`);
      alts.push(`https://libreddit.privacydev.net${u.pathname}`);
    } else if (host === "youtube.com" || host === "www.youtube.com") {
      alts.push(`https://piped.video${u.pathname}${u.search}`);
      alts.push(`https://yewtu.be${u.pathname}${u.search}`);
    } else if (host === "linkedin.com" || host === "www.linkedin.com") {
      // No reliable mirror; rely on stealth proxy + cached.
      alts.push(`https://webcache.googleusercontent.com/search?q=cache:${target}`);
    } else if (host === "facebook.com" || host === "www.facebook.com") {
      alts.push(`https://m.facebook.com${u.pathname}`);
    }

    // Always add Wayback as a last-resort mirror
    alts.push(`https://web.archive.org/web/2024/${target}`);
  } catch { /* ignore */ }
  return alts;
}

async function firecrawlScrape(apiKey: string, url: string, opts: { stealth?: boolean; waitFor?: number } = {}) {
  const body: Record<string, unknown> = {
    url,
    formats: ["markdown", "links", "summary"],
    onlyMainContent: false,
    waitFor: opts.waitFor ?? 2000,
    blockAds: true,
    removeBase64Images: true,
  };
  if (opts.stealth) body.proxy = "stealth";
  const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const target = url.startsWith("http") ? url : `https://${url}`;
    const platform = detectPlatform(target);
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Scrape — try direct (basic), then stealth proxy, then alternate front-ends.
    const attempts: { url: string; stealth: boolean; label: string }[] = [
      { url: target, stealth: false, label: "direct" },
      { url: target, stealth: true,  label: "stealth" },
      ...alternateUrls(target).map((u, i) => ({ url: u, stealth: true, label: `mirror#${i + 1}` })),
    ];

    let scraped: { ok: boolean; status: number; data: any } | null = null;
    let usedAttempt = "";
    const errorTrail: { label: string; status: number; msg: string }[] = [];

    for (const a of attempts) {
      const r = await firecrawlScrape(FIRECRAWL_API_KEY, a.url, { stealth: a.stealth });
      const md = r.data?.markdown || r.data?.data?.markdown || "";
      if (r.ok && md && md.length > 200) {
        scraped = r;
        usedAttempt = `${a.label} (${a.url})`;
        break;
      }
      errorTrail.push({
        label: `${a.label} ${a.url}`,
        status: r.status,
        msg: (r.data?.error || JSON.stringify(r.data)).toString().slice(0, 200),
      });
    }

    if (!scraped) {
      return new Response(
        JSON.stringify({
          error: "All scrape attempts failed",
          platform,
          url: target,
          attempts: errorTrail,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fcData = scraped.data;
    const markdown: string = (fcData.markdown || fcData.data?.markdown || "").slice(0, 18000);
    const links: string[] = (fcData.links || fcData.data?.links || []).slice(0, 200);
    const summary: string = fcData.summary || fcData.data?.summary || "";
    const meta = fcData.metadata || fcData.data?.metadata || {};

    // 2) AI extraction — deep OSINT intel
    const sysPrompt = `You are an OSINT analyst. From the scraped social profile content, extract investigative intelligence beyond what is obvious. Infer carefully but distinguish fact vs inference. Output strict JSON only.`;

    const userPrompt = `Platform: ${platform}
URL: ${target}
Page title: ${meta.title || "(none)"}
Page description: ${meta.description || "(none)"}

--- SCRAPED MARKDOWN ---
${markdown}

--- OUTBOUND LINKS (sample) ---
${links.slice(0, 60).join("\n")}

Extract a JSON object with these fields (use null/empty when unknown):
{
  "display_name": string,
  "handle": string,
  "verified": boolean,
  "bio": string,
  "location_stated": string,
  "location_inferred": string,        // inferred from posts/timezone clues
  "language_primary": string,
  "languages_other": string[],
  "join_date": string,
  "follower_count": string,
  "following_count": string,
  "post_count": string,
  "external_links": string[],         // personal sites, linktree, etc
  "linked_accounts": [{"platform":"","handle":"","url":""}],  // cross-platform aliases
  "email_leaks": string[],            // emails visible on page
  "phone_leaks": string[],
  "real_name_candidates": string[],
  "employer_candidates": string[],
  "education_candidates": string[],
  "interests": string[],
  "top_hashtags": string[],
  "top_mentions": string[],
  "posting_cadence": string,          // e.g. "5-10 posts/day, peak 8-11pm UTC"
  "active_timezone_guess": string,
  "device_os_hints": string[],        // iOS, Android, Mac, Win clues
  "geo_clues": string[],              // place names, landmarks, plates, signage
  "behavioral_signals": string[],     // habits, routine, travel patterns
  "opsec_issues": string[],           // PII leaks, EXIF risk, reused handles, etc
  "monetization": string[],           // sponsorships, links, crypto wallets
  "crypto_wallets": string[],
  "communities": string[],            // groups, subreddits, fandoms
  "notable_posts": string[],          // 3-5 most revealing post snippets
  "sentiment_overall": string,
  "exposure_score": number,           // 0-100, OSINT exposure risk
  "confidence": number,               // 0-100 in this analysis
  "investigative_leads": string[]     // concrete next steps an analyst should take
}
Respond with JSON only, no prose.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      return new Response(
        JSON.stringify({ error: `AI ${aiRes.status}: ${t.slice(0, 300)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiJson = await aiRes.json();
    const content = aiJson.choices?.[0]?.message?.content || "{}";
    let intel: any = {};
    try { intel = JSON.parse(content); } catch { intel = { raw: content }; }

    return new Response(
      JSON.stringify({
        platform,
        url: target,
        scraped_via: usedAttempt,
        page_title: meta.title || null,
        page_summary: summary || null,
        intel,
        scraped_chars: markdown.length,
        link_count: links.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});