import { DurableObject } from 'cloudflare:workers';
import { createContainerController, handleGatewayRequest } from './controller.mjs';

export class IntelligenceContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.controller = createContainerController({ container: ctx.container, env,
      log: event => console.error(JSON.stringify(event)) });
  }
  fetch(request) { return this.controller.fetch(request); }
}

export default { fetch: handleGatewayRequest };
