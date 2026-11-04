# Captured CSV tail candidate

Private candidate generated and synthetically verified; no live tail execution by this agent.

Run: `InsightNexus_csv_tail_20261104_4947857f`. Expected **162 inserts + 42 updates + zero audit rows**, **2,712 → 2,874 public rows**.

**17 new checks passed:** 7 PostgreSQL rehearsals and 10 Python guard tests. PostgreSQL rehearsed all 162 synthetic inserts and 42 synthetic updates, exact rollback, wrong before-image atomicity, later-write refusal, UPDATE-trigger rejection, and untouched-row protection. Python tests cover ambiguous changed fields, preserved unchanged blanks/decorations, JSON precision/nulls and forbidden mutation paths.

## Private executable files

Directory: `D:\CodexData\InsightNexus-Migration\2026-11-04\current-tail-candidate-v1`

- `tail-forward.private.sql`: 498,319 bytes; SHA-256 `1ff6cdb43af9fa29e82e6e2b26aa32376dd099a1b97711c54264c355d52bf41f`.
- `tail-rollback.private.sql`: 273,010 bytes; SHA-256 `b4486991ccb8deea2cba2bffd9c852daacda5b734feed26a83c9b4832dc9fc62`.

Generator SHA-256 `4e3cd9aa82a1bcbd8d7bbf59227e203c40f49d12ca37c480cab1d36f3fa3c43f`. Both helper implementations are pinned and recorded in the JSON receipt. Saved SQL bytes independently rehashed.

## Preservation and guards

- One table-lock phase covers all 63 public tables plus private receipt tables and migration anchor; READ COMMITTED snapshots after locks, 5s lock timeout, 120s statement timeout.
- Exact prior run identity and all 63 pinned checkpoint counts/content hashes must match the live target before writes.
- No artifact inserts; no relevant INSERT/UPDATE triggers, DELETE triggers, non-public inbound FKs or public table rewrite rules allowed.
- Only metadata/confidence_score/source_tool may update, only on identity_entities; full before-image digest and affected-row count 1 required for each update.
- Ambiguous changed update fields reject; unchanged fields retain original before-image values.
- Untouched-row counts/digests are captured after baseline verification under locks and checked after mutation; updated and inserted IDs are both excluded.
- Rollback checks whole poststate first, deletes only exact inserted rows in reverse FK order, restores 42 exact before-images, then verifies full original state. It refuses later writes.
- Pinned source manifest, null-evidence membership, before-image file and helper implementations prevent input/normalizer drift.

Preserves the target-only cluster, earlier migration audit row, target pipeline timestamp conflict, all Auth/session/provider settings and all 15 values affected by possible CSV spreadsheet decoration. Private before-images for all 42 updates are retained.

## Limits before cutover

- This candidate covers the immutable captured exports, not a current/frozen source. At least one later activity row is excluded and remains for cutover reconciliation.
- No real multi-connection contention rehearsal; table locks exclude ordinary writes. Coordinate against concurrent privileged catalog/function changes.
- Root owns any live apply/rollback and subsequent independent count/digest verification. No tail SQL has been executed by this agent.
- Authenticated application acceptance and production routing remain separate.

All 63 captured CSV hashes/counts are pinned, all capture totals have UI evidence, and all 151 new ambiguous blank cells have exact-ID UI null bindings. No record values or credentials appear in this report.
