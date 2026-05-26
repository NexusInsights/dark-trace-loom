import aiosqlite
import json
import os
import uuid
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "dtl.db")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _id():
    return uuid.uuid4().hex[:12]


async def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    db = await get_db()
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            value TEXT NOT NULL,
            label TEXT,
            risk_score INTEGER DEFAULT 0,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS relationships (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
            target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
            rel_type TEXT NOT NULL,
            confidence REAL DEFAULT 0.5,
            metadata TEXT DEFAULT '{}',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scan_results (
            id TEXT PRIMARY KEY,
            entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
            source TEXT NOT NULL,
            result_type TEXT NOT NULL,
            data TEXT NOT NULL,
            raw_response TEXT,
            scanned_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY,
            case_number TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            status TEXT DEFAULT 'active',
            priority TEXT DEFAULT 'medium',
            analyst TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS case_entities (
            case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
            entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
            added_at TEXT NOT NULL,
            PRIMARY KEY (case_id, entity_id)
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            source TEXT,
            acknowledged INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS api_keys (
            service TEXT PRIMARY KEY,
            api_key TEXT NOT NULL,
            added_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ent_type ON entities(entity_type);
        CREATE INDEX IF NOT EXISTS idx_ent_value ON entities(value);
        CREATE INDEX IF NOT EXISTS idx_rel_src ON relationships(source_id);
        CREATE INDEX IF NOT EXISTS idx_rel_tgt ON relationships(target_id);
        CREATE INDEX IF NOT EXISTS idx_scan_ent ON scan_results(entity_id);
        CREATE INDEX IF NOT EXISTS idx_alert_sev ON alerts(severity);
    """)
    await db.commit()
    await db.close()


async def upsert_entity(entity_type, value, label=None, metadata=None, risk_score=0):
    db = await get_db()
    now = _now()
    rows = await db.execute_fetchall(
        "SELECT id, risk_score, metadata FROM entities WHERE entity_type=? AND value=?",
        (entity_type, value)
    )
    if rows:
        eid = rows[0][0]
        old_risk = rows[0][1]
        old_meta = json.loads(rows[0][2] or "{}")
        if metadata:
            old_meta.update(metadata)
        await db.execute(
            "UPDATE entities SET last_seen=?, risk_score=?, metadata=?, updated_at=?, label=COALESCE(?,label) WHERE id=?",
            (now, max(old_risk, risk_score), json.dumps(old_meta), now, label, eid)
        )
    else:
        eid = _id()
        await db.execute(
            "INSERT INTO entities (id,entity_type,value,label,risk_score,first_seen,last_seen,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (eid, entity_type, value, label or value, risk_score, now, now, json.dumps(metadata or {}), now, now)
        )
    await db.commit()
    await db.close()
    return eid


async def get_entity(entity_id):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM entities WHERE id=?", (entity_id,))
    await db.close()
    if not rows:
        return None
    r = rows[0]
    return dict(r)


async def search_entities(query="", entity_type=None, limit=200):
    db = await get_db()
    sql = "SELECT * FROM entities WHERE 1=1"
    params = []
    if query:
        sql += " AND (value LIKE ? OR label LIKE ?)"
        params += [f"%{query}%", f"%{query}%"]
    if entity_type:
        sql += " AND entity_type=?"
        params.append(entity_type)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)
    rows = await db.execute_fetchall(sql, params)
    await db.close()
    return [dict(r) for r in rows]


async def add_relationship(source_id, target_id, rel_type, confidence=0.5, metadata=None):
    db = await get_db()
    existing = await db.execute_fetchall(
        "SELECT id FROM relationships WHERE source_id=? AND target_id=? AND rel_type=?",
        (source_id, target_id, rel_type)
    )
    if existing:
        rid = existing[0][0]
        await db.execute("UPDATE relationships SET confidence=?, metadata=? WHERE id=?",
                         (confidence, json.dumps(metadata or {}), rid))
    else:
        rid = _id()
        await db.execute(
            "INSERT INTO relationships (id,source_id,target_id,rel_type,confidence,metadata,created_at) VALUES (?,?,?,?,?,?,?)",
            (rid, source_id, target_id, rel_type, confidence, json.dumps(metadata or {}), _now())
        )
    await db.commit()
    await db.close()
    return rid


async def get_entity_relationships(entity_id):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM relationships WHERE source_id=? OR target_id=?",
        (entity_id, entity_id)
    )
    await db.close()
    return [dict(r) for r in rows]


async def get_all_relationships():
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM relationships ORDER BY created_at DESC")
    await db.close()
    return [dict(r) for r in rows]


async def store_scan_result(entity_id, source, result_type, data, raw=None):
    db = await get_db()
    rid = _id()
    await db.execute(
        "INSERT INTO scan_results (id,entity_id,source,result_type,data,raw_response,scanned_at) VALUES (?,?,?,?,?,?,?)",
        (rid, entity_id, source, result_type, json.dumps(data), raw, _now())
    )
    await db.commit()
    await db.close()
    return rid


async def get_entity_scan_results(entity_id):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM scan_results WHERE entity_id=? ORDER BY scanned_at DESC", (entity_id,)
    )
    await db.close()
    return [dict(r) for r in rows]


async def create_case(name, description="", priority="medium", analyst=""):
    db = await get_db()
    cid = _id()
    now = _now()
    count_rows = await db.execute_fetchall("SELECT COUNT(*) as c FROM cases")
    num = count_rows[0][0] + 1
    cn = f"C-{datetime.now(timezone.utc).year}-{num:04d}"
    await db.execute(
        "INSERT INTO cases (id,case_number,name,description,status,priority,analyst,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (cid, cn, name.upper(), description, "active", priority, analyst, now, now)
    )
    await db.commit()
    await db.close()
    return {"id": cid, "case_number": cn, "name": name.upper(), "status": "active",
            "priority": priority, "analyst": analyst, "created_at": now}


async def get_all_cases():
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM cases ORDER BY created_at DESC")
    results = []
    for r in rows:
        ec = await db.execute_fetchall("SELECT COUNT(*) as c FROM case_entities WHERE case_id=?", (r["id"],))
        d = dict(r)
        d["entity_count"] = ec[0][0]
        results.append(d)
    await db.close()
    return results


async def add_entity_to_case(case_id, entity_id):
    db = await get_db()
    await db.execute(
        "INSERT OR IGNORE INTO case_entities (case_id,entity_id,added_at) VALUES (?,?,?)",
        (case_id, entity_id, _now())
    )
    await db.commit()
    await db.close()


async def create_alert(severity, message, entity_id=None, source=None):
    db = await get_db()
    aid = _id()
    await db.execute(
        "INSERT INTO alerts (id,entity_id,severity,message,source,created_at) VALUES (?,?,?,?,?,?)",
        (aid, entity_id, severity, message, source, _now())
    )
    await db.commit()
    await db.close()
    return aid


async def get_alerts(limit=50):
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT a.*, e.value as entity_value, e.entity_type as etype
           FROM alerts a LEFT JOIN entities e ON a.entity_id=e.id
           ORDER BY a.created_at DESC LIMIT ?""", (limit,)
    )
    await db.close()
    return [dict(r) for r in rows]


async def set_api_key(service, key):
    db = await get_db()
    await db.execute("INSERT OR REPLACE INTO api_keys (service,api_key,added_at) VALUES (?,?,?)",
                     (service, key, _now()))
    await db.commit()
    await db.close()


async def get_api_key(service):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT api_key FROM api_keys WHERE service=?", (service,))
    await db.close()
    return rows[0][0] if rows else None


async def get_all_api_keys():
    db = await get_db()
    rows = await db.execute_fetchall("SELECT service, added_at FROM api_keys")
    await db.close()
    return [dict(r) for r in rows]


async def get_stats():
    db = await get_db()
    ent = (await db.execute_fetchall("SELECT COUNT(*) as c FROM entities"))[0][0]
    rel = (await db.execute_fetchall("SELECT COUNT(*) as c FROM relationships"))[0][0]
    cas = (await db.execute_fetchall("SELECT COUNT(*) as c FROM cases WHERE status='active'"))[0][0]
    alr = (await db.execute_fetchall("SELECT COUNT(*) as c FROM alerts WHERE acknowledged=0"))[0][0]
    scn = (await db.execute_fetchall("SELECT COUNT(*) as c FROM scan_results"))[0][0]
    hr = (await db.execute_fetchall("SELECT COUNT(*) as c FROM entities WHERE risk_score > 70"))[0][0]
    ak = (await db.execute_fetchall("SELECT COUNT(*) as c FROM api_keys"))[0][0]
    tb = await db.execute_fetchall("SELECT entity_type, COUNT(*) as c FROM entities GROUP BY entity_type")
    await db.close()
    return {
        "total_entities": ent, "total_relationships": rel, "active_cases": cas,
        "unread_alerts": alr, "total_scans": scn, "high_risk_entities": hr,
        "api_keys_configured": ak, "entity_breakdown": {r[0]: r[1] for r in tb}
    }


async def delete_entity(entity_id):
    db = await get_db()
    await db.execute("DELETE FROM entities WHERE id=?", (entity_id,))
    await db.commit()
    await db.close()
