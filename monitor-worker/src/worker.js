import schema from "../migrations/0001_monitors.sql";
import { sqliteFacade } from "./sqlite-facade.js";
import { handleApi } from "./api.js";
import { json } from "./core.js";
import { armNextCheck, runAlarm } from "./alarms.js";

export class MonitorStore {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.db = sqliteFacade(ctx.storage);
    ctx.blockConcurrencyWhile(async () => { await this.db.exec(schema); await armNextCheck(this.db, ctx.storage); });
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/internal")) return json({ error: "Route was not found" }, 404);
    const response = await handleApi(request, this.db, this.env, { getNextAlarm: () => this.ctx.storage.getAlarm() });
    if (response.ok && ["POST", "PATCH", "DELETE"].includes(request.method)) await armNextCheck(this.db, this.ctx.storage);
    return response;
  }
  async alarm() { return runAlarm(this.db, this.ctx.storage, this.env); }
}
export default {
  async fetch(request, env) {
    // External callers cannot reach the scheduler's private service-binding route.
    if (new URL(request.url).pathname.startsWith("/internal")) return json({ error: "Route was not found" }, 404);
    if (!env.MONITOR_STORE) return json({ error: "Durable monitor storage binding is not configured" }, 503);
    return env.MONITOR_STORE.get(env.MONITOR_STORE.idFromName("scheduler")).fetch(request);
  },
};
