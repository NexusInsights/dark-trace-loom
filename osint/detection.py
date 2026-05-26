"""
Entity type detection and risk score calculation.
Pure logic. No network calls. Fully testable in sandbox.
"""
import re


def detect_input_type(query: str) -> str:
    query = query.strip()
    if not query:
        return "unknown"

    if re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', query):
        return "email"

    if re.match(r'^(\d{1,3}\.){3}\d{1,3}$', query):
        parts = query.split(".")
        if all(0 <= int(p) <= 255 for p in parts):
            return "ip"
        return "unknown"  # looks like IP but invalid octets

    if re.match(r'^[\+]?[\d\s\-\(\)\.]{7,20}$', query) and sum(c.isdigit() for c in query) >= 7:
        return "phone"

    # Bitcoin
    if re.match(r'^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$', query):
        return "crypto"
    if re.match(r'^3[a-km-zA-HJ-NP-Z1-9]{25,34}$', query):
        return "crypto"
    if re.match(r'^bc1[a-zA-HJ-NP-Z0-9]{25,62}$', query):
        return "crypto"
    # Ethereum
    if re.match(r'^0x[0-9a-fA-F]{40}$', query):
        return "crypto"
    # Monero
    if re.match(r'^4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$', query):
        return "crypto"

    if re.match(r'^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$', query):
        # Validate TLD to avoid misclassifying "john.doe" as domain
        tld = query.rsplit(".", 1)[-1].lower()
        known_tlds = {
            "com","net","org","io","co","us","uk","de","fr","ru","cn","jp","au","ca",
            "in","br","it","es","nl","se","no","fi","dk","pl","cz","at","ch","be",
            "info","biz","me","tv","cc","ai","app","dev","tech","xyz","online","site",
            "club","pro","gov","edu","mil","int","museum","aero","coop","travel",
            "mobi","asia","tel","jobs","name","cat","store","shop","cloud","design",
            "digital","solutions","agency","consulting","services","systems","network",
            "security","money","exchange","finance","trading","capital","fund",
            "health","science","engineering","academy","school","university",
            "media","news","blog","press","video","photo","music","art","film",
            "ly","gg","to","so","la","gl","sh","sx","ws","tk","cf","ga","gq","ml",
        }
        if tld in known_tlds or len(tld) == 2:  # 2-char = country codes
            return "domain"

    if re.match(r'^[a-zA-Z0-9._-]{2,50}$', query):
        return "username"

    return "unknown"


def calculate_risk_score(scan_data: dict, entity_type: str) -> int:
    """
    Calculate risk from real scan findings. Each rule is documented.
    Returns 0-100.
    """
    score = 0

    if entity_type == "domain":
        whois = scan_data.get("whois", {})
        if isinstance(whois, dict) and whois.get("success"):
            wd = whois.get("data", {})
            # Privacy-protected registrations: +15
            for field in ["org", "registrar", "name"]:
                val = str(wd.get(field, "")).lower()
                if any(kw in val for kw in ["privacy", "redacted", "proxy", "whoisguard", "domains by proxy"]):
                    score += 15
                    break
            # New domain (<90 days): +20
            creation = wd.get("creation_date")
            if creation:
                try:
                    from datetime import datetime, timezone
                    if isinstance(creation, list):
                        creation = creation[0]
                    created = datetime.fromisoformat(str(creation).replace("Z", "+00:00"))
                    age_days = (datetime.now(timezone.utc) - created).days
                    if age_days < 90:
                        score += 20
                    elif age_days < 365:
                        score += 10
                except Exception:
                    pass

        dns = scan_data.get("dns", {})
        if isinstance(dns, dict) and dns.get("success"):
            dd = dns.get("data", {})
            if not dd.get("MX"):
                score += 5  # No mail exchange = possibly parked

        subs = scan_data.get("subdomains", {})
        if isinstance(subs, dict) and subs.get("success"):
            sub_count = len(subs.get("data", {}).get("subdomains", []))
            if sub_count > 50:
                score += 10

        vt = scan_data.get("virustotal", {})
        if isinstance(vt, dict) and vt.get("success"):
            stats = vt.get("data", {}).get("last_analysis_stats", {})
            score += min(stats.get("malicious", 0) * 10, 40)
            score += min(stats.get("suspicious", 0) * 5, 15)

    elif entity_type == "ip":
        geo = scan_data.get("geolocation", {})
        if isinstance(geo, dict) and geo.get("success"):
            gd = geo.get("data", {})
            if gd.get("proxy"):
                score += 25
            if gd.get("hosting"):
                score += 10
            if gd.get("countryCode") in ("RU", "CN", "KP", "IR"):
                score += 20

        shodan = scan_data.get("shodan", {})
        if isinstance(shodan, dict) and shodan.get("success"):
            sd = shodan.get("data", {})
            score += min(len(sd.get("vulns", [])) * 5, 30)
            for p in sd.get("ports", []):
                if p in (22, 23, 3389, 445, 139, 5900):
                    score += 5

    elif entity_type == "email":
        meta = scan_data.get("metadata", {})
        if meta.get("is_disposable"):
            score += 35
        if meta.get("is_custom_domain"):
            score += 5

        hibp = scan_data.get("hibp_breaches", {})
        if isinstance(hibp, dict) and hibp.get("success"):
            if hibp.get("data", {}).get("breached"):
                score += min(hibp["data"].get("breach_count", 0) * 8, 40)

    elif entity_type == "username":
        found_count = scan_data.get("found_count", 0)
        if found_count > 15:
            score += 10
        found_platforms = [f.get("platform", "").lower() for f in scan_data.get("found", [])]
        for dp in ("telegram", "keybase"):
            if dp in found_platforms:
                score += 10

    elif entity_type == "crypto":
        blockchain = scan_data.get("blockchain", {})
        if isinstance(blockchain, dict) and blockchain.get("success"):
            bd = blockchain.get("data", {})
            if bd.get("n_tx", 0) > 100:
                score += 15
            if bd.get("final_balance_btc", 0) > 1:
                score += 20
        ident = scan_data.get("identification", {})
        if ident.get("type") == "monero":
            score += 25

    return min(score, 100)
