const marketplacePublicSlugs = ["flight-tracking", "reverse-ip", "cve-tracker", "threat-feed", "ip-reputation", "crypto-wallet-tracer", "blockchain-tracer", "phishing-detector", "vin-decoder", "sanctions-screening", "corporate-records", "insider-tracker", "satellite-search"];
// Unknown provider allowances fail closed. These flags require independently verified
// included access; adding a credential alone cannot authorize a billable request.
const marketplaceAllowanceFlags: Record<string,string> = {
  ...CONNECTED_FREE_ALLOWANCE_FLAGS,
  SHODAN_API_KEY: 'MARKETPLACE_SHODAN_FREE_ALLOWANCE_VERIFIED',
  TWILIO_API_KEY: 'MARKETPLACE_TWILIO_FREE_ALLOWANCE_VERIFIED',
  TWILIO_API_SECRET: 'MARKETPLACE_TWILIO_FREE_ALLOWANCE_VERIFIED',
  CARSXE_API_KEY: 'MARKETPLACE_CARSXE_FREE_ALLOWANCE_VERIFIED',
  COURTLISTENER_API_TOKEN: 'MARKETPLACE_COURTLISTENER_FREE_ALLOWANCE_VERIFIED',
  X_API_BEARER_TOKEN: 'MARKETPLACE_X_FREE_ALLOWANCE_VERIFIED',
  DISCORD_BOT_TOKEN: 'MARKETPLACE_DISCORD_FREE_ALLOWANCE_VERIFIED',
  VIRUSTOTAL_API_KEY: 'MARKETPLACE_VIRUSTOTAL_FREE_ALLOWANCE_VERIFIED',
  DARKOWL_PUBLIC_KEY: 'MARKETPLACE_DARKOWL_FREE_ALLOWANCE_VERIFIED',
  DARKOWL_PRIVATE_KEY: 'MARKETPLACE_DARKOWL_FREE_ALLOWANCE_VERIFIED',
  AISSTREAM_API_KEY: 'MARKETPLACE_AISSTREAM_FREE_ALLOWANCE_VERIFIED',
};
function marketplaceStatus() {
  const requirements: Record<string, readonly string[]> = { ...Object.fromEntries(marketplacePublicSlugs.map(slug => [slug, []])), "shodan-integration": ["SHODAN_API_KEY"], ...CONNECTED_REQUIRED_SECRETS, ...MARKETPLACE_REQUIRED_SECRETS, 'streetview-compare': [], 'telegram-monitor': [] };
  const tools: Record<string, { configured: boolean; missing_secrets: string[]; provider: string; scope: string; allowance_verified: boolean; blocked_reason: string | null }> = {};
  const ai = independentAiConfiguration();
  for (const [slug, names] of Object.entries(requirements)) {
    const missing = names.filter(name => !Deno.env.get(name));
    const unverified = [...new Set(names.map(name=>marketplaceAllowanceFlags[name]).filter(Boolean))].filter(flag=>Deno.env.get(flag)!=='true');
    const usesAi = slug === 'translation' || slug === 'sentiment-analysis';
    const allowanceVerified = unverified.length === 0 && (!usesAi || ai.zero_spend_verified);
    const blocked = usesAi && ai.excluded_builder_endpoint ? 'Lovable-hosted AI endpoints are disabled for this independent deployment. Configure an independent endpoint; no provider request will be sent.' : !allowanceVerified ? 'Verified included provider access is required under the zero-new-spend setting. Credential presence does not establish a free allowance. No provider request will be sent.' : usesAi && !ai.enabled ? 'Independent AI is disabled. Enable it only after verifying the configured account allowance and absence of paid overage. No provider request will be sent.' : null;
    tools[slug] = { configured: missing.length === 0 && !blocked && (!usesAi || ai.ready), missing_secrets: missing, provider: usesAi ? "Configured independent AI provider" : "Documented external provider", scope: blocked || "Provider access and complete listing coverage are verified only by actual execution. See runner scope and sourced result.", allowance_verified: allowanceVerified, blocked_reason: blocked };
  }
  return { tools, checked_at: new Date().toISOString(), status_meaning: "Configured means required backend setup and verified included-access checks pass. Provider response and data coverage still require a successful sourced run.", new_provider_spend_allowed: false };
}
async function marketplaceRun(req: Request, params: unknown, verifiedUser?: Awaited<ReturnType<typeof marketplaceUser>>) {
  const user = verifiedUser ?? await marketplaceUser(req);
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new MarketplaceHttpError("Marketplace parameters must be an object.", 400);
  const p = params as Record<string, unknown>; const tool = p.tool;
  if (typeof tool !== "string" || !/^[a-z0-9-]{1,80}$/.test(tool)) throw new MarketplaceHttpError("A valid marketplace tool ID is required.", 400);
  const status = marketplaceStatus().tools[tool];
  if (!status) throw new MarketplaceHttpError("This operation has no executable integration. Monitoring requires an authorized durable feed; biometric identity matching is unavailable.", 422);
  if (!status.configured) throw new MarketplaceHttpError(status.blocked_reason || `Provider access required: configure ${status.missing_secrets.join(", ")} in this project's backend secrets. No provider request was made.`, 424);
  await marketplacePermission(user, tool);
  const inputs = p.inputs;
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) || Object.keys(inputs).length > 20 || Object.entries(inputs).some(([k,v]) => !/^[a-zA-Z0-9_]{1,60}$/.test(k) || typeof v !== "string" || v.length > 50000)) throw new MarketplaceHttpError("Provide at most 20 text fields, each at most 50,000 characters.", 400);
  const record = inputs as Record<string, string>;
  const result = await (tool==='streetview-compare'?runMarketplaceAlternatives(tool,record):undefined) ?? await runMarketplaceSocialFull(tool,record) ?? await runMarketplacePublic(tool, record) ?? await runMarketplaceOpen(tool, record) ?? await runMarketplaceConnected(tool, record, { authorization: user.authorization }) ?? await runMarketplaceLicensed(tool, record);
  if (!result) throw new MarketplaceHttpError("No executable handler exists for this operation.", 422);
  return result;
}
