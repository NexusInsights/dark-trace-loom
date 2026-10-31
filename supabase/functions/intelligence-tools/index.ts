import { createIntelligenceHandler } from "./handler.ts";

Deno.serve(createIntelligenceHandler({ getEnv: (name) => Deno.env.get(name) }));
