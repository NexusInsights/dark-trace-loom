import { runDueJobs } from "./engine.js";

export async function armNextCheck(db, storage, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const row = await db.prepare("SELECT MIN(CASE WHEN lease_until>? THEN MAX(next_due,lease_until) ELSE next_due END) AS due FROM monitor_jobs WHERE enabled=1 AND archived=0").bind(now).first();
  if (row?.due === null || row?.due === undefined) { await storage.deleteAlarm(); return null; }
  const next = Math.max(nowMs + 1000, Number(row.due) * 1000);
  const existing = await storage.getAlarm();
  if (existing !== null && existing > nowMs && existing <= next) return existing;
  await storage.setAlarm(next);
  return next;
}

export async function runAlarm(db, storage, env) {
  try { return await runDueJobs(db, env, { scheduledAt: Math.floor(Date.now() / 1000) }); }
  finally { await armNextCheck(db, storage); }
}
