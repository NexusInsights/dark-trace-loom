import { HttpError, json } from './core.js';

export class MigrationHoldError extends HttpError {
  constructor(code = 'migration_hold') {
    super(code === 'migration_generation_changed'
      ? 'The monitoring migration state changed during this operation. Its outcome must be checked before retrying.'
      : code === 'migration_state_unavailable'
        ? 'Monitoring is paused because its migration control state could not be verified.'
        : 'Monitoring is paused for migration. New checks and mutations are unavailable.', 503);
    this.code = code;
  }
}

function checkedState(row) {
  if (!row || ![0, 1].includes(row.held) || !Number.isSafeInteger(row.generation) || row.generation < 0) throw new MigrationHoldError('migration_state_unavailable');
  return row;
}

export async function migrationState(db) {
  try { return checkedState(await db.prepare('SELECT held,generation FROM monitor_runtime_control WHERE id=1').first()); }
  catch (error) { if (error instanceof MigrationHoldError) throw error; throw new MigrationHoldError('migration_state_unavailable'); }
}

export async function initializeMigrationControl(db) {
  const existing = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='monitor_runtime_control'").first();
  if (!existing) {
    await db.batch([
      db.prepare('CREATE TABLE monitor_runtime_control (id INTEGER PRIMARY KEY CHECK(id=1),held INTEGER NOT NULL CHECK(held IN(0,1)),generation INTEGER NOT NULL CHECK(generation>=0))'),
      db.prepare('INSERT INTO monitor_runtime_control(id,held,generation) VALUES(1,0,0)'),
    ]);
  }
  // A missing/corrupt row in an existing table never resets a latched hold.
  return migrationState(db);
}

// Called only during Durable Object initialization, never through a public route.
// Missing configuration preserves a latched hold. Only exact "false" releases it.
// Invalid nonempty configuration fails closed by latching the hold.
export async function configureMigrationHold(db, env) {
  const before = await migrationState(db);
  const value = env.MONITOR_MIGRATION_HOLD;
  if (value === undefined || value === null || value === '') return before;
  const held = value === 'false' ? 0 : 1;
  if (before.held !== held) {
    if (before.generation >= Number.MAX_SAFE_INTEGER) throw new MigrationHoldError('migration_state_unavailable');
    await db.prepare('UPDATE monitor_runtime_control SET held=?,generation=generation+1 WHERE id=1 AND held<>?').bind(held, held).run();
  }
  return migrationState(db);
}

export async function migrationSession(db) {
  if (db.migrationGeneration !== undefined) { db.assertGuard(); return db; }
  const state = await migrationState(db);
  if (state.held) throw new MigrationHoldError();
  if (typeof db.withTransactionGuard !== 'function') throw new MigrationHoldError('migration_state_unavailable');
  const session = db.withTransactionGuard(sql => {
    let current;
    try { current = checkedState(sql.exec('SELECT held,generation FROM monitor_runtime_control WHERE id=1').one()); }
    catch { throw new MigrationHoldError('migration_state_unavailable'); }
    if (current.held) throw new MigrationHoldError();
    if (current.generation !== state.generation) throw new MigrationHoldError('migration_generation_changed');
  });
  session.migrationGeneration = state.generation;
  session.assertGuard();
  return session;
}

export function migrationFetch(db, fetcher = fetch) {
  return async (...args) => {
    db.assertGuard(); // Synchronous fence immediately before dispatching a new request.
    const response = await fetcher(...args);
    try { db.assertGuard(); }
    catch (error) { await response.body?.cancel().catch(() => undefined); throw error; }
    return response;
  };
}

export function migrationResponse(error, headers = {}) {
  const held = error.code === 'migration_hold';
  return json({ error: error.message, code: error.code, configured: false,
    scheduler: { enabled: held ? false : null, state: held ? 'migration_paused' : 'migration_state_changed_or_unverified', mechanism: 'durable_object_alarm' },
    retry_safe: false,
    notice: 'Retained data is preserved. An operation started before the pause may already have dispatched a request or committed an earlier write; verify its outcome before retrying.' }, 503, headers);
}
