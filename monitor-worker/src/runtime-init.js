import { initializeMigrationControl, configureMigrationHold, MigrationHoldError } from './migration-hold.js';
import { armNextCheck } from './alarms.js';

export async function initializeMonitorRuntime(db, storage, env, schema) {
  try {
    await db.exec(schema);
    await initializeMigrationControl(db);
    await configureMigrationHold(db, env);
    const alarm = await armNextCheck(db, storage);
    if (alarm && typeof alarm === 'object') return { error: new MigrationHoldError('migration_state_unavailable'), alarmDisarmVerified: false };
    return { error: null };
  } catch {
    // Resolve initialization so the DO can answer controlled503s instead of
    // repeatedly resetting/retrying a broken constructor. Never poll on failure.
    let alarmDisarmVerified = false;
    try { await storage.deleteAlarm(); alarmDisarmVerified = true; } catch { /* Report uncertainty; no automatic rearm. */ }
    return { error: new MigrationHoldError('migration_state_unavailable'), alarmDisarmVerified };
  }
}
