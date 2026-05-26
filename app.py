import os, sys, json, asyncio
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

sys.path.insert(0, os.path.dirname(__file__))
import database as db
from osint.engine import run_scan, run_auto_pivot, run_graph_analytics, export_stix, ai_analyze, ai_correlate
from osint.maigret_scanner import scan_username as maigret_scan, get_db_stats as maigret_stats

app = FastAPI(title="Dark Trace Loom", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class ScanReq(BaseModel):
    query: str
    scan_type: Optional[str] = None
    case_id: Optional[str] = None

class PivotReq(BaseModel):
    seed: str
    max_depth: int = 2
    max_entities: int = 100
    confidence_threshold: float = 0.5
    case_id: Optional[str] = None

class CaseReq(BaseModel):
    name: str
    description: str = ""
    priority: str = "medium"
    analyst: str = ""

class KeyReq(BaseModel):
    service: str
    api_key: str

class CaseEntityReq(BaseModel):
    case_id: str
    entity_id: str

@app.on_event("startup")
async def startup():
    await db.init_db()

async def _keys() -> dict:
    keys = {}
    for svc in ("shodan", "virustotal", "hibp", "hunter", "securitytrails", "numverify", "etherscan", "anthropic"):
        k = await db.get_api_key(svc)
        if k:
            keys[svc] = k
    return keys

# ---- SCAN ----
@app.post("/api/scan")
async def api_scan(req: ScanReq):
    keys = await _keys()
    result = await run_scan(req.query.strip(), keys, type_override=req.scan_type)
    eid = await db.upsert_entity(result["entity_type"], req.query.strip(), req.query.strip(),
                                  {"last_scan": result}, result["risk_score"])
    result["entity_id"] = eid
    for src, data in result.get("modules", {}).items():
        if isinstance(data, dict):
            await db.store_scan_result(eid, src, result["entity_type"], data)
    for disc in result.get("discovered_entities", []):
        dv = str(disc.get("value", "")).strip()
        if not dv or len(dv) < 2:
            continue
        did = await db.upsert_entity(disc["type"], dv, dv)
        await db.add_relationship(eid, did, disc.get("relationship", "discovered"), disc.get("confidence", 0.5))
    if result["risk_score"] > 70:
        await db.create_alert("high", f"High risk: {req.query} (score {result['risk_score']})", eid, "scan")
    if req.case_id:
        await db.add_entity_to_case(req.case_id, eid)
    return result

@app.get("/api/scan/detect")
async def api_detect(query: str = Query(...)):
    from osint.detection import detect_input_type
    return {"query": query, "entity_type": detect_input_type(query)}

# ---- MAIGRET USERNAME SCANNER (3000+ sites) ----
@app.get("/api/maigret/stats")
async def api_maigret_stats():
    """Maigret database stats: total sites, default scan count, tags."""
    return await maigret_stats()

@app.post("/api/maigret/scan")
async def api_maigret_scan(username: str, top: int = 500, tags: str = None, all_sites: bool = False):
    """Full maigret username scan with profile parsing and ID extraction.
    Args:
        username: target username
        top: number of top-ranked sites (default 500)
        tags: comma-separated tag filter (e.g. 'us,photo')
        all_sites: scan all 3000+ sites (overrides top)
    """
    tag_list = tags.split(",") if tags else None
    result = await maigret_scan(username.strip(), top=top, tags=tag_list, all_sites=all_sites)
    # Store username entity
    eid = await db.upsert_entity("username", username.strip(), username.strip(),
                                  {"maigret_scan": {
                                      "found_count": result["found_count"],
                                      "total_checked": result["total_checked"],
                                      "extracted_ids": result.get("extracted_ids", {})
                                  }})
    # Store each found profile as a linked entity
    for f in result.get("found", []):
        url = f.get("url", "")
        site = f.get("site_name", "unknown")
        if url:
            did = await db.upsert_entity("social", url, site)
            tag_label = f["tags"][0] if f.get("tags") else "misc"
            await db.add_relationship(eid, did, f"maigret_{tag_label}", 0.9)
    # Store extracted IDs as linked entities
    for id_type, id_vals in result.get("extracted_ids", {}).items():
        vals = id_vals if isinstance(id_vals, list) else [id_vals]
        for v in vals:
            if v:
                xid = await db.upsert_entity("username", str(v), str(v), {"source": f"maigret_extract_{id_type}"})
                await db.add_relationship(eid, xid, f"extracted_{id_type}", 0.85)
    result["entity_id"] = eid
    return result

# ---- AUTO-PIVOT ----
@app.post("/api/autopivot")
async def api_pivot(req: PivotReq):
    keys = await _keys()
    return await run_auto_pivot(req.seed, keys, req.max_depth, req.max_entities, req.confidence_threshold, req.case_id)

# ---- ENTITIES ----
@app.get("/api/entities")
async def api_entities(q: str = "", entity_type: str = None, limit: int = 200):
    ents = await db.search_entities(q, entity_type, limit)
    return {"entities": ents, "count": len(ents)}

@app.get("/api/entities/{eid}")
async def api_entity(eid: str):
    e = await db.get_entity(eid)
    if not e:
        raise HTTPException(404, "Entity not found")
    scans = await db.get_entity_scan_results(eid)
    rels = await db.get_entity_relationships(eid)
    resolved = []
    for r in rels:
        oid = r["target_id"] if r["source_id"] == eid else r["source_id"]
        other = await db.get_entity(oid)
        resolved.append({**r, "other_entity": other})
    return {"entity": e, "scan_results": scans, "relationships": resolved}

@app.delete("/api/entities/{eid}")
async def api_del_entity(eid: str):
    await db.delete_entity(eid)
    return {"deleted": eid}

# ---- GRAPH ----
@app.get("/api/graph")
async def api_graph():
    ents = await db.search_entities(limit=5000)
    rels = await db.get_all_relationships()
    eids = {e["id"] for e in ents}
    links = [{"source": r["source_id"], "target": r["target_id"],
              "rel_type": r["rel_type"], "confidence": r.get("confidence", 0.5)}
             for r in rels if r["source_id"] in eids and r["target_id"] in eids]
    return {"nodes": ents, "links": links}

# ---- ANALYTICS ----
@app.get("/api/analytics")
async def api_analytics():
    return await run_graph_analytics()

# ---- AI ----
@app.post("/api/ai/analyze/{eid}")
async def api_ai_analyze(eid: str):
    key = await db.get_api_key("anthropic")
    if not key:
        raise HTTPException(400, "Anthropic API key not configured in Settings")
    e = await db.get_entity(eid)
    if not e:
        raise HTTPException(404)
    scans = await db.get_entity_scan_results(eid)
    rels = await db.get_entity_relationships(eid)
    return await ai_analyze(e, scans, rels, key)

@app.post("/api/ai/correlate")
async def api_ai_correlate():
    key = await db.get_api_key("anthropic")
    if not key:
        raise HTTPException(400, "Anthropic API key not configured")
    ents = await db.search_entities(limit=500)
    rels = await db.get_all_relationships()
    return await ai_correlate(ents, rels, key)

# ---- STIX ----
@app.get("/api/export/stix")
async def api_stix():
    return await export_stix()

@app.get("/api/export/stix/download")
async def api_stix_dl():
    bundle = await export_stix()
    fp = os.path.join(os.path.dirname(__file__), "reports", f"DTL_STIX_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json")
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "w") as f:
        json.dump(bundle, f, indent=2)
    return FileResponse(fp, media_type="application/json", filename=os.path.basename(fp))

# ---- CASES ----
@app.post("/api/cases")
async def api_create_case(req: CaseReq):
    return await db.create_case(req.name, req.description, req.priority, req.analyst)

@app.get("/api/cases")
async def api_cases():
    return {"cases": await db.get_all_cases()}

@app.post("/api/cases/add-entity")
async def api_case_entity(req: CaseEntityReq):
    await db.add_entity_to_case(req.case_id, req.entity_id)
    return {"success": True}

# ---- ALERTS ----
@app.get("/api/alerts")
async def api_alerts(limit: int = 50):
    a = await db.get_alerts(limit)
    return {"alerts": a, "count": len(a)}

# ---- API KEYS ----
@app.post("/api/keys")
async def api_set_key(req: KeyReq):
    await db.set_api_key(req.service, req.api_key)
    return {"success": True}

@app.get("/api/keys")
async def api_list_keys():
    return {"keys": await db.get_all_api_keys()}

@app.delete("/api/keys/{service}")
async def api_del_key(service: str):
    d = await db.get_db()
    await d.execute("DELETE FROM api_keys WHERE service=?", (service,))
    await d.commit()
    await d.close()
    return {"deleted": service}

# ---- STATS ----
@app.get("/api/stats")
async def api_stats():
    return await db.get_stats()

# ---- FRONTEND ----
from fastapi.staticfiles import StaticFiles
_static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=_static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    """Serve mobile PWA by default (desktop at /desktop)."""
    fp = os.path.join(_static_dir, "mobile.html")
    if os.path.exists(fp):
        with open(fp) as f:
            return f.read()
    return "<h1>Dark Trace Loom</h1><p>API at /docs | Mobile at /mobile</p>"

@app.get("/desktop", response_class=HTMLResponse)
async def serve_desktop():
    fp = os.path.join(_static_dir, "index.html")
    if os.path.exists(fp):
        with open(fp) as f:
            return f.read()
    return "<h1>Dark Trace Loom</h1>"

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8900, log_level="info")
