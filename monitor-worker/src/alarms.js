import { runDueJobs } from "./engine.js";
import { migrationSession, MigrationHoldError } from './migration-hold.js';

export async function armNextCheck(db, storage, nowMs = Date.now()) {
  // Reconcile at most one generation race; repeated control changes remain paused.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const session = await migrationSession(db);
      const now = Math.floor(nowMs / 1000);
      const row = await session.prepare("SELECT MIN(CASE WHEN lease_until>? THEN MAX(next_due,lease_until) ELSE next_due END) AS due FROM monitor_jobs WHERE enabled=1 AND archived=0").bind(now).first();
      if (row?.due === null || row?.due === undefined) { await storage.deleteAlarm(); return null; }
      const next = Math.max(nowMs + 1000, Number(row.due) * 1000);
      const existing = await storage.getAlarm();
      session.assertGuard();
      if (existing !== null && existing > nowMs && existing <= next) return existing;
      await storage.setAlarm(next);
      session.assertGuard();
      return next;
    } catch (error) {
      if (!(error instanceof MigrationHoldError)) throw error;
      try { await storage.deleteAlarm(); }
      catch { return { alarm_disarm_verified: false, code: 'migration_alarm_disarm_unverified' }; }
      if (error.code !== 'migration_generation_changed') return null;
    }
  }
  return null;
}

export async function runAlarm(db, storage, env) {
  let outcome;
  let failure;
  try { outcome = await runDueJobs(db, env, { scheduledAt: Math.floor(Date.now() / 1000) }); }
  catch (error) {
    if (!(error instanceof MigrationHoldError)) failure = error;
    else outcome = { paused: error.code === 'migration_hold' ? true : null, interrupted: true, code: error.code, completed: false, notice: 'No completed scheduler tick is claimed. Previously dispatched requests cannot be unsent; later writes from this generation are fenced. A changed generation does not establish whether the current scheduler is paused.' };
  }
  const next = await armNextCheck(db, storage);
  if (failure) throw failure;
  return next && typeof next === 'object' ? { ...outcome, alarm_disarm_verified: false, next_alarm_state: 'unverified' } : outcome;
}
