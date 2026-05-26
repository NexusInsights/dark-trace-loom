"""
Scan orchestrator and enterprise modules.
Routes input type to correct scanners. Extracts discovered entities from results.
Also contains: auto-pivot, graph analytics, STIX export, AI engine.
"""
import asyncio
import json
import uuid
import re
import aiohttp
import networkx as nx
from datetime import datetime, timezone
from collections import defaultdict

from osint.detection import detect_input_type, calculate_risk_score
from osint.scanners import (
    scan_whois, scan_dns, scan_crtsh, scan_ssl, scan_wayback,
    scan_ip_geo, scan_reverse_dns, scan_shodan, scan_virustotal,
    scan_mx, scan_gravatar, scan_hibp, extract_email_metadata,
    scan_username, parse_phone, identify_crypto, scan_btc, scan_eth,
)


# ==================== SCAN ORCHESTRATOR ====================

async def run_scan(query: str, api_keys: dict = None, type_override: str = None) -> dict:
    api_keys = api_keys or {}
    entity_type = type_override if type_override else detect_input_type(query)
    result = {
        "query": query, "entity_type": entity_type,
        "scan_started": datetime.now(timezone.utc).isoformat(),
        "modules": {}, "risk_score": 0, "discovered_entities": [],
    }

    if entity_type == "domain":
        tasks = {
            "whois": scan_whois(query), "dns": scan_dns(query),
            "subdomains": scan_crtsh(query), "ssl": scan_ssl(query),
            "wayback": scan_wayback(query),
        }
        if api_keys.get("virustotal"):
            tasks["virustotal"] = scan_virustotal(query, api_keys["virustotal"])
        gathered = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for key, val in zip(tasks.keys(), gathered):
            result["modules"][key] = val if not isinstance(val, Exception) else {"success": False, "error": str(val)}

        # Extract entities from WHOIS
        wd = result["modules"].get("whois", {}).get("data", {})
        if isinstance(wd, dict):
            for email in (wd.get("emails") or []) if isinstance(wd.get("emails"), list) else ([wd["emails"]] if wd.get("emails") else []):
                result["discovered_entities"].append({"type": "email", "value": str(email), "relationship": "whois_contact", "confidence": 0.9})
            for ns in (wd.get("name_servers") or []) if isinstance(wd.get("name_servers"), list) else ([wd["name_servers"]] if wd.get("name_servers") else []):
                result["discovered_entities"].append({"type": "domain", "value": str(ns).lower().rstrip("."), "relationship": "nameserver", "confidence": 0.95})

        # Extract from DNS
        dd = result["modules"].get("dns", {}).get("data", {})
        if isinstance(dd, dict):
            for a in dd.get("A", []):
                result["discovered_entities"].append({"type": "ip", "value": a, "relationship": "resolves_to", "confidence": 0.95})
            for mx in dd.get("MX", []):
                if isinstance(mx, dict):
                    result["discovered_entities"].append({"type": "domain", "value": str(mx.get("exchange", "")).rstrip("."), "relationship": "mail_exchange", "confidence": 0.9})

        # Extract from subdomains (cap at 20)
        sd = result["modules"].get("subdomains", {}).get("data", {})
        if isinstance(sd, dict):
            for sub in sd.get("subdomains", [])[:20]:
                if sub != query:
                    result["discovered_entities"].append({"type": "domain", "value": sub, "relationship": "subdomain", "confidence": 0.95})

        # Extract from SSL SANs
        ssl_d = result["modules"].get("ssl", {}).get("data", {})
        if isinstance(ssl_d, dict):
            for san in ssl_d.get("san", []):
                if san != query and not san.startswith("*"):
                    result["discovered_entities"].append({"type": "domain", "value": san, "relationship": "ssl_san", "confidence": 0.9})

    elif entity_type == "ip":
        tasks = {"geolocation": scan_ip_geo(query), "reverse_dns": scan_reverse_dns(query)}
        if api_keys.get("shodan"):
            tasks["shodan"] = scan_shodan(query, api_keys["shodan"])
        gathered = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for key, val in zip(tasks.keys(), gathered):
            result["modules"][key] = val if not isinstance(val, Exception) else {"success": False, "error": str(val)}

        geo = result["modules"].get("geolocation", {}).get("data", {})
        if isinstance(geo, dict) and geo.get("org"):
            result["discovered_entities"].append({"type": "organization", "value": geo["org"], "relationship": "operated_by", "confidence": 0.8})
        rdns = result["modules"].get("reverse_dns", {}).get("data", {})
        if isinstance(rdns, dict) and rdns.get("hostname"):
            result["discovered_entities"].append({"type": "domain", "value": rdns["hostname"], "relationship": "reverse_dns", "confidence": 0.85})

    elif entity_type == "email":
        meta = extract_email_metadata(query)
        result["modules"]["metadata"] = meta
        tasks = {"mx": scan_mx(query), "gravatar": scan_gravatar(query)}
        if api_keys.get("hibp"):
            tasks["hibp_breaches"] = scan_hibp(query, api_keys["hibp"])
        gathered = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for key, val in zip(tasks.keys(), gathered):
            result["modules"][key] = val if not isinstance(val, Exception) else {"success": False, "error": str(val)}

        if meta.get("domain"):
            result["discovered_entities"].append({"type": "domain", "value": meta["domain"], "relationship": "email_domain", "confidence": 0.95})
        grav = result["modules"].get("gravatar", {}).get("data", {})
        if isinstance(grav, dict) and grav.get("found"):
            if grav.get("display_name"):
                result["discovered_entities"].append({"type": "person", "value": grav["display_name"], "relationship": "gravatar_name", "confidence": 0.7})
            for u in grav.get("urls", []):
                if isinstance(u, dict) and u.get("value"):
                    result["discovered_entities"].append({"type": "social", "value": u["value"], "relationship": "gravatar_url", "confidence": 0.6})

    elif entity_type == "username":
        from osint.maigret_scanner import scan_username as maigret_scan
        scan_data = await maigret_scan(query)
        result["modules"] = scan_data
        # Found profiles from maigret
        for f in scan_data.get("found", []):
            url = f.get("url", "")
            site = f.get("site_name", "").lower().replace(" ", "_")
            if url:
                result["discovered_entities"].append({
                    "type": "social", "value": url,
                    "relationship": f"profile_{site}", "confidence": 0.9
                })
        # Extracted IDs from profile parsing (maigret's differentiator)
        for id_type, id_values in scan_data.get("extracted_ids", {}).items():
            if isinstance(id_values, list):
                for val in id_values:
                    if val:
                        result["discovered_entities"].append({
                            "type": "username" if id_type == "username" else "misc",
                            "value": str(val),
                            "relationship": f"extracted_{id_type}",
                            "confidence": 0.85
                        })
            elif id_values:
                result["discovered_entities"].append({
                    "type": "username" if id_type == "username" else "misc",
                    "value": str(id_values),
                    "relationship": f"extracted_{id_type}",
                    "confidence": 0.85
                })

    elif entity_type == "phone":
        result["modules"]["analysis"] = parse_phone(query)

    elif entity_type == "crypto":
        ident = identify_crypto(query)
        result["modules"]["identification"] = ident
        if ident["type"] == "bitcoin":
            result["modules"]["blockchain"] = await scan_btc(query)
        elif ident["type"] == "ethereum":
            result["modules"]["etherscan"] = await scan_eth(query, api_keys.get("etherscan"))

    result["risk_score"] = calculate_risk_score(result["modules"], entity_type)
    result["scan_completed"] = datetime.now(timezone.utc).isoformat()
    return result


# ==================== AUTO-PIVOT ENGINE ====================

async def run_auto_pivot(seed: str, api_keys: dict = None, max_depth: int = 2,
                         max_entities: int = 100, confidence_threshold: float = 0.5,
                         case_id: str = None, db_module=None) -> dict:
    """Recursive scan engine. Scans seed, discovers entities, scans those, repeats."""
    import database as db_mod
    db = db_module or db_mod
    api_keys = api_keys or {}
    scanned = set()
    queue = [(seed, 0, None)]
    entity_count = 0
    scan_count = 0
    lineage = []
    errors = []

    while queue and entity_count < max_entities:
        value, depth, parent_id = queue.pop(0)
        norm = value.strip().lower()
        if norm in scanned or depth > max_depth:
            continue
        scanned.add(norm)

        try:
            result = await run_scan(value, api_keys)
            scan_count += 1
            eid = await db.upsert_entity(result["entity_type"], value, value,
                                         {"pivot_depth": depth}, result["risk_score"])
            entity_count += 1

            for src, data in result.get("modules", {}).items():
                if isinstance(data, dict):
                    await db.store_scan_result(eid, src, result["entity_type"], data)

            if parent_id:
                await db.add_relationship(parent_id, eid, "auto_pivot", 0.8)
                lineage.append({"parent": parent_id, "child": eid, "value": value, "depth": depth})

            if case_id:
                await db.add_entity_to_case(case_id, eid)

            if result["risk_score"] > 70:
                await db.create_alert("high", f"Auto-pivot: {value} (risk {result['risk_score']})", eid, "auto_pivot")

            for disc in result.get("discovered_entities", []):
                dv = str(disc.get("value", "")).strip()
                if not dv or len(dv) < 2 or disc.get("confidence", 0) < confidence_threshold:
                    continue
                did = await db.upsert_entity(disc["type"], dv, dv)
                entity_count += 1
                await db.add_relationship(eid, did, disc.get("relationship", "discovered"), disc.get("confidence", 0.5))
                if case_id:
                    await db.add_entity_to_case(case_id, did)
                dn = dv.lower()
                scannable = {"email", "domain", "ip", "username", "crypto", "phone"}
                if disc["type"] in scannable and dn not in scanned and depth + 1 <= max_depth:
                    queue.append((dv, depth + 1, eid))

            await asyncio.sleep(0.3)
        except Exception as e:
            errors.append({"value": value, "depth": depth, "error": str(e)})

    return {
        "seed": seed, "total_scans": scan_count, "total_entities": entity_count,
        "max_depth_reached": max((l["depth"] for l in lineage), default=0),
        "lineage_count": len(lineage), "errors": len(errors), "error_details": errors[:10],
    }


# ==================== GRAPH ANALYTICS ====================

async def run_graph_analytics(db_module=None, case_id: str = None) -> dict:
    import database as db_mod
    db = db_module or db_mod

    entities = await db.search_entities(limit=5000)
    relationships = await db.get_all_relationships()
    eids = {e["id"] for e in entities}

    G = nx.Graph()
    for e in entities:
        G.add_node(e["id"], entity_type=e["entity_type"], value=e["value"],
                    risk_score=e.get("risk_score", 0))
    for r in relationships:
        if r["source_id"] in eids and r["target_id"] in eids:
            G.add_edge(r["source_id"], r["target_id"], rel_type=r["rel_type"],
                       weight=r.get("confidence", 0.5))

    if G.number_of_nodes() == 0:
        return {"error": "No entities in graph", "node_count": 0}

    res = {"node_count": G.number_of_nodes(), "edge_count": G.number_of_edges()}

    # PageRank
    try:
        pr = nx.pagerank(G, weight="weight")
        ranked = sorted(pr.items(), key=lambda x: x[1], reverse=True)[:20]
        res["pagerank"] = [{"entity_id": n, "value": G.nodes[n].get("value", ""),
                            "entity_type": G.nodes[n].get("entity_type", ""),
                            "score": round(s, 6), "risk_score": G.nodes[n].get("risk_score", 0)} for n, s in ranked]
    except Exception:
        res["pagerank"] = []

    # Betweenness
    try:
        bc = nx.betweenness_centrality(G)
        ranked = sorted(bc.items(), key=lambda x: x[1], reverse=True)[:20]
        res["betweenness"] = [{"entity_id": n, "value": G.nodes[n].get("value", ""),
                               "score": round(s, 6)} for n, s in ranked if s > 0]
    except Exception:
        res["betweenness"] = []

    # Degree
    dc = nx.degree_centrality(G)
    ranked = sorted(dc.items(), key=lambda x: x[1], reverse=True)[:20]
    res["degree"] = [{"entity_id": n, "value": G.nodes[n].get("value", ""),
                      "degree": G.degree(n), "score": round(s, 6)} for n, s in ranked]

    # Communities
    try:
        from networkx.algorithms.community import greedy_modularity_communities
        comms = list(greedy_modularity_communities(G))
        res["communities"] = []
        for i, comm in enumerate(comms):
            members = [{"id": n, "value": G.nodes[n].get("value", ""),
                        "type": G.nodes[n].get("entity_type", ""),
                        "risk": G.nodes[n].get("risk_score", 0)} for n in comm]
            risks = [m["risk"] for m in members]
            res["communities"].append({"id": i, "size": len(comm),
                                       "avg_risk": round(sum(risks)/len(risks), 1) if risks else 0,
                                       "members": members[:30]})
        res["community_count"] = len(comms)
    except Exception:
        res["communities"] = []
        res["community_count"] = 0

    # Bridges
    try:
        bridges = list(nx.bridges(G))
        res["bridges"] = [{"source": b[0], "source_val": G.nodes[b[0]].get("value", ""),
                           "target": b[1], "target_val": G.nodes[b[1]].get("value", "")}
                          for b in bridges[:20]]
        res["bridge_count"] = len(bridges)
    except Exception:
        res["bridges"] = []
        res["bridge_count"] = 0

    # Threat propagation
    tp = {}
    for n in G.nodes():
        nr = G.nodes[n].get("risk_score", 0)
        neighbor_risk = sum(G.nodes[nb].get("risk_score", 0) for nb in G.neighbors(n))
        deg = G.degree(n)
        tp[n] = round(nr * 0.4 + (neighbor_risk / deg if deg else 0) * 0.3 + deg * 3 * 0.3, 2)
    ranked_tp = sorted(tp.items(), key=lambda x: x[1], reverse=True)[:20]
    res["threat_propagation"] = [{"entity_id": n, "value": G.nodes[n].get("value", ""),
                                  "score": s, "risk": G.nodes[n].get("risk_score", 0),
                                  "degree": G.degree(n)} for n, s in ranked_tp]

    res["density"] = round(nx.density(G), 6)
    comps = list(nx.connected_components(G))
    res["components"] = len(comps)
    res["largest_component"] = max(len(c) for c in comps) if comps else 0

    types = defaultdict(int)
    for n in G.nodes():
        types[G.nodes[n].get("entity_type", "unknown")] += 1
    res["type_distribution"] = dict(types)

    return res


# ==================== STIX 2.1 EXPORT ====================

STIX_MAP = {"domain": "domain-name", "ip": "ipv4-addr", "email": "email-addr",
            "username": "user-account", "person": "identity", "organization": "identity",
            "social": "url", "crypto": "artifact", "phone": "user-account"}

async def export_stix(db_module=None) -> dict:
    import database as db_mod
    db = db_module or db_mod
    entities = await db.search_entities(limit=5000)
    relationships = await db.get_all_relationships()
    eids = {e["id"] for e in entities}

    objects = []
    id_map = {}
    for e in entities:
        st = STIX_MAP.get(e["entity_type"], "artifact")
        sid = f"{st}--{uuid.uuid4()}"
        id_map[e["id"]] = sid
        sco = {"type": st, "id": sid, "spec_version": "2.1",
               "x_dtl_id": e["id"], "x_dtl_risk": e.get("risk_score", 0)}
        if st == "domain-name":
            sco["value"] = e["value"]
        elif st == "ipv4-addr":
            sco["value"] = e["value"]
        elif st == "email-addr":
            sco["value"] = e["value"]
        elif st == "user-account":
            sco["account_login"] = e["value"]
        elif st == "identity":
            sco["name"] = e["value"]
            sco["identity_class"] = "individual" if e["entity_type"] == "person" else "organization"
        elif st == "url":
            sco["value"] = e["value"]
        else:
            sco["x_dtl_value"] = e["value"]
        objects.append(sco)

        if e.get("risk_score", 0) >= 50:
            iid = f"indicator--{uuid.uuid4()}"
            objects.append({"type": "indicator", "id": iid, "spec_version": "2.1",
                            "name": f"DTL: {e['value']}", "pattern_type": "stix",
                            "pattern": f"[{st}:value = '{e['value']}']",
                            "valid_from": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "confidence": min(e.get("risk_score", 0), 100),
                            "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "modified": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})

    for r in relationships:
        if r["source_id"] in eids and r["target_id"] in eids:
            sid = id_map.get(r["source_id"])
            tid = id_map.get(r["target_id"])
            if sid and tid:
                objects.append({"type": "relationship", "id": f"relationship--{uuid.uuid4()}",
                                "spec_version": "2.1", "relationship_type": "related-to",
                                "source_ref": sid, "target_ref": tid,
                                "confidence": int(r.get("confidence", 0.5) * 100),
                                "x_dtl_type": r.get("rel_type", ""),
                                "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                "modified": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})

    return {"type": "bundle", "id": f"bundle--{uuid.uuid4()}", "objects": objects}


# ==================== AI ENGINE ====================

ANALYST_SYSTEM = """You are a senior OSINT analyst inside Dark Trace Loom.
Analyze raw scan data. Produce structured intelligence assessments.
Rules: Only analyze data provided. No fabrication. Confidence levels on every finding.
Output: Key Findings, Risk Indicators, OPSEC Profile, Attack Surface, Pivot Recommendations, Gaps."""

CORRELATION_SYSTEM = """You are a signals intelligence correlation engine.
Analyze entities and relationships. Find hidden patterns, clusters, identity linkages.
Output JSON: {"threat_level":"","clusters":[],"identity_links":[],"pivot_targets":[],"assessment":""}"""


async def ai_analyze(entity: dict, scan_results: list, relationships: list, api_key: str) -> dict:
    scan_data = {sr.get("source", "?"): json.loads(sr["data"]) if isinstance(sr["data"], str) else sr.get("data", {}) for sr in scan_results}
    rels = [{"type": r.get("rel_type"), "target": r.get("target_id"), "conf": r.get("confidence")} for r in relationships]
    prompt = f"""Entity: {entity.get('entity_type')} = {entity.get('value')}
Risk: {entity.get('risk_score')}/100
Scan Data ({len(scan_data)} sources): {json.dumps(scan_data, default=str)[:12000]}
Relationships ({len(rels)}): {json.dumps(rels, default=str)[:3000]}
Produce full intelligence assessment."""
    return await _call_claude(ANALYST_SYSTEM, prompt, api_key)


async def ai_correlate(entities: list, relationships: list, api_key: str) -> dict:
    ents = [{"id": e["id"], "type": e["entity_type"], "value": e["value"], "risk": e.get("risk_score", 0)} for e in entities]
    rels = [{"src": r["source_id"], "tgt": r["target_id"], "type": r["rel_type"]} for r in relationships]
    prompt = f"Entities ({len(ents)}): {json.dumps(ents, default=str)[:8000]}\nRelationships ({len(rels)}): {json.dumps(rels, default=str)[:5000]}\nReturn ONLY JSON."
    return await _call_claude(CORRELATION_SYSTEM, prompt, api_key)


async def _call_claude(system: str, prompt: str, api_key: str) -> dict:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post("https://api.anthropic.com/v1/messages",
                headers={"Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"},
                json={"model": "claude-sonnet-4-20250514", "max_tokens": 4000,
                      "system": system, "messages": [{"role": "user", "content": prompt}]},
                timeout=aiohttp.ClientTimeout(total=120)
            ) as r:
                if r.status == 200:
                    data = await r.json()
                    return {"success": True, "result": data["content"][0]["text"]}
                return {"success": False, "error": f"HTTP {r.status}: {await r.text()}"}
    except Exception as e:
        return {"success": False, "error": str(e)}
