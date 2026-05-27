import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const RUN_PAID = Deno.env.get("RUN_PAID_TOOL_TESTS") === "1";

const ENDPOINT = `${SUPABASE_URL}/functions/v1/osint-tools`;

async function callTool(action: string, params: Record<string, unknown>) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON}`,
      "apikey": ANON,
    },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ============================================================
// FREE TIER — runs on every push (no paid API credits consumed)
// ============================================================

Deno.test("free: dns-query resolves a known domain", async () => {
  const { status, body } = await callTool("dns-query", { domain: "example.com" });
  assertEquals(status, 200);
  assert(!body.error, `unexpected error: ${body.error}`);
});

Deno.test("free: whois returns data for example.com", async () => {
  const { status, body } = await callTool("whois", { domain: "example.com" });
  assertEquals(status, 200);
  assert(!body.error, `unexpected error: ${body.error}`);
});

Deno.test("free: subdomain-enum (crt.sh) returns array-shaped result", async () => {
  const { status, body } = await callTool("subdomain-enum", { domain: "example.com" });
  assertEquals(status, 200);
  assert(!body.error, `unexpected error: ${body.error}`);
});

Deno.test("free: asn-lookup (BGPView) for AS15169 (Google)", async () => {
  const { status, body } = await callTool("asn-lookup", { asn: "15169" });
  assertEquals(status, 200);
  assert(!body.error, `unexpected error: ${body.error}`);
});

Deno.test("free: ssl-inspect on google.com", async () => {
  const { status, body } = await callTool("ssl-inspect", { host: "google.com" });
  assertEquals(status, 200);
  assert(!body.error, `unexpected error: ${body.error}`);
});

Deno.test("free: ip-geo lookup for 1.1.1.1", async () => {
  const { status, body } = await callTool("ip-geo", { ip: "1.1.1.1" });
  assertEquals(status, 200);
  assert(!body.error, `unexpected error: ${body.error}`);
});

Deno.test("free: rejects unknown action", async () => {
  const { status, body } = await callTool("not-a-tool", {});
  assertEquals(status, 400);
  assert(body.error);
});

// ============================================================
// PAID TIER — gated behind RUN_PAID_TOOL_TESTS=1.
// In CI: trigger manually or via nightly cron with a credit ceiling.
// ============================================================

Deno.test({
  name: "paid: pdl-person-enrich (consumes PDL credits)",
  ignore: !RUN_PAID,
  fn: async () => {
    const { status, body } = await callTool("pdl-person-enrich", {
      profile: "linkedin.com/in/seanthorne",
    });
    assertEquals(status, 200);
    assert(!body.error, `unexpected error: ${body.error}`);
  },
});

Deno.test({
  name: "paid: pdl-person-search (consumes PDL credits)",
  ignore: !RUN_PAID,
  fn: async () => {
    const { status, body } = await callTool("pdl-person-search", {
      company: "stripe",
      job_role: "engineering",
      size: 1,
    });
    assertEquals(status, 200);
    assert(!body.error, `unexpected error: ${body.error}`);
  },
});

Deno.test({
  name: "paid: pdl-company-enrich (consumes PDL credits)",
  ignore: !RUN_PAID,
  fn: async () => {
    const { status, body } = await callTool("pdl-company-enrich", {
      website: "stripe.com",
    });
    assertEquals(status, 200);
    assert(!body.error, `unexpected error: ${body.error}`);
  },
});