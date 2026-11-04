// SQLite Durable Object adapter for the small prepared-statement surface used by the engine.
// Every statement is executed against ctx.storage.sql; there is no in-memory production store.
export function sqliteFacade(storage, guard) {
  const assertGuard = () => { if (guard) guard(storage.sql); };
  const atomic = operation => guard ? storage.transactionSync(operation) : operation();
  function prepared(query, values = []) {
    const execute = () => {
      assertGuard();
      const cursor = storage.sql.exec(query, ...values);
      const rows = cursor.toArray();
      const changed = storage.sql.exec("SELECT changes() AS count").one().count;
      return { success: true, results: rows, meta: { changes: Number(changed), rows_read: cursor.rowsRead, rows_written: cursor.rowsWritten } };
    };
    return {
      bind: (...parameters) => prepared(query, parameters),
      _execute: execute,
      async all() { return atomic(execute); },
      async first(column) { const row = atomic(execute).results[0] || null; return column && row ? row[column] : row; },
      async run() { return atomic(execute); },
    };
  }
  return {
    prepare: prepared,
    assertGuard,
    withTransactionGuard: nextGuard => sqliteFacade(storage, nextGuard),
    async batch(statements) { return storage.transactionSync(() => { assertGuard(); return statements.map(statement => statement._execute()); }); },
    async exec(query) { return atomic(() => { assertGuard(); storage.sql.exec(query); return { success: true }; }); },
  };
}
