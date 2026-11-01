# mailauth 8.0.4 scoped DKIM compatibility adapter

The copied verifier and stream wrapper originate from the MIT-licensed mailauth8.0.4 npm distribution, `dist/esm/dkim/dkim-verifier.js` and `verify.js`. The full upstream copyright and licence notice is retained in `LICENSE.txt`; original file SHA256 values and exact transformations are in `manifest.json`.

Workers Node crypto rejected the SDK's `rsa-sha256` digest alias with `Unknown digest: rsa-sha256`. This copy changes only that exact literal algorithm name to the standard digest name `sha256` at native `crypto.verify`. Ed25519's null algorithm is unchanged. Native cryptography, signature bytes, key options, SDK parsing/canonicalization/body hashes/strictness and minimum-key rules remain unchanged. Strict mode still rejects RSA-SHA1 before key lookup.

Nine relative verifier imports and the wrapper's helper import use the installed SDK's public deep exports so every other SDK component continues to come from the exactly pinned8.0.4 dependency. Existing nodemailer/libmime imports are unchanged and resolved by the npm lock/install. No global crypto mutation, installed-package patch, postinstall hook, manual verifier or automatic source generation is used.

Run `node services/research/vendor/mailauth-8.0.4/verify-upstream.mjs` from the app root. The read-only guard checks the exact dependency version, original source hashes, every import rewrite, one digest-alias substitution, wrapper and complete MIT notice. `email-compat.test.mjs` runs that guard with a bounded child process. A dependency upgrade or source drift must fail until this copy is reviewed and regenerated deliberately.

Primary references:

- Pinned SDK/API and public deep imports: https://github.com/postalsys/mailauth/blob/v8.0.4/README.md
- Cloudflare native Node crypto example using `sha256`: https://developers.cloudflare.com/changelog/post/2025-04-08-nodejs-crypto-and-tls/
- Matching runtime digest lookup/error: https://github.com/cloudflare/workerd/blob/v1.20261023.1/src/workerd/api/node/crypto.c%2B%2B#L440
- Node recommendation to use digest names: https://nodejs.org/api/crypto.html#cryptocreateverifyalgorithm-options
- RSA-SHA1 prohibition: https://www.rfc-editor.org/rfc/rfc8301.html#section-3.1

Local owning-Wrangler execution is distinct from hosted deployment and CPU allowance. Synthetic tests never establish the identity of a person or that an email is benign.
