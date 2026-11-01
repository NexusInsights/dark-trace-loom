# Independent included-allocation AI route

Prepared October 14, 2026. The source, local tests and Wrangler dry-run are ready. Deployment, account-policy activation and actual inference remain review steps owned by the main task.

This Worker uses the existing Cloudflare `AI` binding on account `da9871f264f6e4268fd904015f5703df`, without a model API key or a new provider token. The only accepted model is `@cf/google/gemma-4-26b-a4b-it`. Its official model documentation supports `response_format`, `max_completion_tokens` and standard Chat Completions output. [Model contract](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/).

The main task reports that the actual account's Workers plan is Free, with 10,000 included neurons per day. Save that account proof and review this route before activation. Cloudflare's documented Free-plan quota stops further operations when exhausted; Paid-plan overage can incur charges. This code remains disabled until all three policy variables explicitly record verified free execution. Disable it before changing the account to a plan that allows billed overage. The flags are operator assertions, not an independent live billing meter. [Current pricing and Free/Paid behavior](https://developers.cloudflare.com/workers-ai/platform/pricing/).

Worker configuration:

| Variable | Value or purpose |
| --- | --- |
| `SUPABASE_URL` | Exact `https://ocliymtdvtxfxczxgbjr.supabase.co`; any other project is rejected |
| `SUPABASE_PUBLISHABLE_KEY` | That project's public publishable/anon key; no service role |
| `WORKERS_AI_ENABLED` | Exact `true` after review |
| `WORKERS_AI_ZERO_SPEND_VERIFIED` | Exact `true` after account/model/overage verification |
| `WORKERS_AI_VERIFIED_PLAN` | Exact `free` after the account proof is saved |
| `WORKERS_AI_VERIFIED_AT` / `WORKERS_AI_VERIFICATION_EXPIRES_AT` | Optional paired UTC timestamps; a configured attestation may last at most 24 hours |

Default configuration has a blank public key and disabled/unverified policy values. A deploy without the reviewed values cannot perform inference. Do not enable paid overage, create new provider credentials, or accept additional provider terms as part of this setup.

If the paired timestamps are configured, inference stops at their expiry until the actual Free-plan account is reverified and the attestation renewed. Neither flags nor this lease automatically detect an account upgrade during their validity period. Keep the route disabled before an upgrade that permits billed overage. Leaving both timestamps blank preserves the explicit current-plan guard without introducing a hidden daily expiry; choose the attestation policy deliberately at activation.

The Worker accepts only POST `/v1/chat/completions`. Each call carries the already verified end-user bearer token, then reverifies identity using the new project's actual Auth `/auth/v1/user` service. It queries subscription and tool permission records under the same user token and public project key. Active, unexpired Professional/Team/Enterprise access is required, using the app's exact `professional`, `team`, and `enterprise` plan IDs. An explicit administrator disable blocks the operation; an empty successful permission query preserves the existing app's default entitlement rule. No decoded JWT claim or service-role caller is trusted.

The social backend function maps to the actual UI permission ID `social-scrape`; its function name alone is not the permission key. The standalone social function also checks that permission before using any Firecrawl allowance in caller-session mode.

Supabase AI functions use this server configuration:

| Name | Value |
| --- | --- |
| `AI_AUTH_MODE` | `supabase_user` |
| `AI_CHAT_COMPLETIONS_URL` | The actual deployed Worker's HTTPS URL plus `/v1/chat/completions` |
| `AI_MODEL` | `@cf/google/gemma-4-26b-a4b-it` |
| `AI_ENABLED` | Exact `true` after review and proxy activation |
| `AI_ZERO_SPEND_VERIFIED` | Exact `true` after the same account verification |

No `AI_API_KEY` is needed in this mode. The existing explicitly configured static-key mode remains available and fails closed by default. `independentAiChat(input, { authorization, tool_id })` forwards the caller only in user mode. Case analysis and social profile extraction pass their remotely verified caller authorization. The marketplace dispatcher must pass its verified context with `runMarketplaceConnected(tool, params, { authorization: user.authorization })`; its allowed AI tools are sentiment and translation.

The exact known local Connected import is `import { independentAiChat, independentAiConfiguration } from "../_shared/independentAi.ts";`. The backend assembler must place the shared source before Connected and strip that known local import when bundling. Standalone function imports continue using the shared module directly.

Requests are limited to 256 KiB, sixteen text messages, 4,096 output tokens and structured JSON. Arbitrary models, multimodal input, streaming, provider options and tools are rejected. Auth/REST requests are bounded; inference is one attempt with a deadline shorter than the adapter's 30-second timeout. Returning a timeout does not claim that an already dispatched provider inference was canceled. Actual returned choices, finish reason, model and provider ID are preserved when supplied. Legacy binding responses are mapped without inventing an ID or a successful finish reason. Truncated, malformed and refused responses fail rather than producing substitute content. Existing case/social exact-source validation remains enforced after transport.

Local proof: focused Worker, shared adapter and Connected suites passed; application TypeScript passed; `wrangler deploy --dry-run --config ai-worker/wrangler.jsonc` compiled the real `AI` binding without upload. These are local contracts and compile evidence, not proof of an actual model response. The next authorized acceptance check after review is a tiny non-private source-text call using a real new-project session, followed by the original app interaction and its saved/result evidence. No inference was performed by this subtask.
