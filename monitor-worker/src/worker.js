import schema from "../migrations/0001_monitors.sql";
import { sqliteFacade } from "./sqlite-facade.js";
import { handleApi } from "./api.js";
import { json } from "./core.js";
import { armNextCheck, runAlarm } from "./alarms.js";
import { migrationResponse, MigrationHoldError } from './migration-hold.js';
import { initializeMonitorRuntime } from './runtime-init.js';

export class MonitorStore {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.db = sqliteFacade(ctx.storage);
    this.startup = null;
    ctx.blockConcurrencyWhile(async () => { this.startup = await initializeMonitorRuntime(this.db, ctx.storage, env, schema); });
  }
  async fetch(request) {
    if (this.startup?.error) return migrationResponse(this.startup.error, { 'X-Monitor-Alarm-Disarm-Verified': String(this.startup.alarmDisarmVerified) });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/internal")) return json({ error: "Route was not found" }, 404);
    const response = await handleApi(request, this.db, this.env, { getNextAlarm: () => this.ctx.storage.getAlarm() });
    if (response.ok && ["POST", "PATCH", "DELETE"].includes(request.method)) {
      const alarm = await armNextCheck(this.db, this.ctx.storage);
      if (alarm && typeof alarm === 'object') return migrationResponse(new MigrationHoldError('migration_state_unavailable'), { 'X-Monitor-Alarm-Disarm-Verified': 'false' });
    }
    return response;
  }
  async alarm() {
    if (this.startup?.error) return { interrupted: true, completed: false, code: this.startup.error.code, alarm_disarm_verified: this.startup.alarmDisarmVerified };
    return runAlarm(this.db, this.ctx.storage, this.env);
  }
}
export default {
  async fetch(request, env) {
    // External callers cannot reach the scheduler's private service-binding route.
    if (new URL(request.url).pathname.startsWith("/internal")) return json({ error: "Route was not found" }, 404);
    if (!env.MONITOR_STORE) return json({ error: "Durable monitor storage binding is not configured" }, 503);
    return env.MONITOR_STORE.get(env.MONITOR_STORE.idFromName("scheduler")).fetch(request);
  },
};
