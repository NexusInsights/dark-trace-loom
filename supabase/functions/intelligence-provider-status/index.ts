import { createProviderStatusHandler } from "./handler.ts";

// This operator endpoint never accepts a user session or exposes server keys.
Deno.serve(createProviderStatusHandler({ getEnv: (name) => Deno.env.get(name) }));
