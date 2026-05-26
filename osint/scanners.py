"""
OSINT Scanner Modules
Every function hits a real endpoint. No mock data. No simulation.
Network-dependent: validated by code review, not live sandbox testing.
"""
import aiohttp
import asyncio
import dns.resolver
import dns.exception
import hashlib
import re
import socket
import ssl
import json
from datetime import datetime, timezone

import whois as python_whois


# ===================== DOMAIN =====================

async def scan_whois(domain: str) -> dict:
    try:
        loop = asyncio.get_event_loop()
        w = await loop.run_in_executor(None, python_whois.whois, domain)
        data = {}
        for key in ("domain_name", "registrar", "whois_server", "creation_date",
                     "expiration_date", "updated_date", "name_servers", "status",
                     "emails", "name", "org", "address", "city", "state",
                     "registrant_postal_code", "country"):
            val = getattr(w, key, None)
            if val is not None:
                if isinstance(val, list):
                    val = [str(v) for v in val]
                elif hasattr(val, "isoformat"):
                    val = val.isoformat()
                else:
                    val = str(val)
                data[key] = val
        return {"success": True, "data": data, "source": "whois"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "whois"}


async def scan_dns(domain: str) -> dict:
    try:
        resolver = dns.resolver.Resolver()
        resolver.timeout = 10
        resolver.lifetime = 10
        results = {}
        for rtype in ("A", "AAAA", "MX", "NS", "TXT", "CNAME"):
            try:
                answers = resolver.resolve(domain, rtype)
                if rtype == "MX":
                    results[rtype] = [{"priority": r.preference, "exchange": str(r.exchange)} for r in answers]
                else:
                    results[rtype] = [str(r) for r in answers]
            except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers, dns.exception.Timeout):
                pass
        return {"success": True, "data": results, "source": "dns"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "dns"}


async def scan_crtsh(domain: str) -> dict:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"https://crt.sh/?q=%.{domain}&output=json",
                             timeout=aiohttp.ClientTimeout(total=30)) as r:
                if r.status != 200:
                    return {"success": False, "error": f"HTTP {r.status}", "source": "crt.sh"}
                data = await r.json(content_type=None)
                subs = set()
                for entry in data:
                    for name in entry.get("name_value", "").split("\n"):
                        name = name.strip().lower()
                        if name and "*" not in name:
                            subs.add(name)
                return {"success": True, "data": {"subdomains": sorted(subs), "cert_count": len(data)}, "source": "crt.sh"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "crt.sh"}


async def scan_ssl(domain: str) -> dict:
    try:
        loop = asyncio.get_event_loop()
        def _get():
            ctx = ssl.create_default_context()
            with ctx.wrap_socket(socket.socket(), server_hostname=domain) as sock:
                sock.settimeout(10)
                sock.connect((domain, 443))
                return sock.getpeercert()
        cert = await loop.run_in_executor(None, _get)
        subject = dict(x[0] for x in cert.get("subject", []))
        issuer = dict(x[0] for x in cert.get("issuer", []))
        san = [v for _, v in cert.get("subjectAltName", [])]
        return {"success": True, "data": {
            "subject": subject, "issuer": issuer, "serial": cert.get("serialNumber"),
            "not_before": cert.get("notBefore"), "not_after": cert.get("notAfter"),
            "san": san,
        }, "source": "ssl"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "ssl"}


async def scan_wayback(domain: str) -> dict:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"https://archive.org/wayback/available?url={domain}",
                             timeout=aiohttp.ClientTimeout(total=15)) as r:
                data = await r.json()
                return {"success": True, "data": data.get("archived_snapshots", {}), "source": "wayback"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "wayback"}


async def scan_ip_geo(ip: str) -> dict:
    try:
        async with aiohttp.ClientSession() as s:
            url = f"http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,reverse,proxy,hosting,query"
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
                data = await r.json()
                if data.get("status") == "success":
                    return {"success": True, "data": data, "source": "ip-api"}
                return {"success": False, "error": data.get("message", ""), "source": "ip-api"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "ip-api"}


async def scan_reverse_dns(ip: str) -> dict:
    try:
        loop = asyncio.get_event_loop()
        host = await loop.run_in_executor(None, lambda: socket.gethostbyaddr(ip))
        return {"success": True, "data": {"hostname": host[0], "aliases": host[1]}, "source": "rdns"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "rdns"}


async def scan_shodan(ip: str, api_key: str) -> dict:
    if not api_key:
        return {"success": False, "error": "No Shodan API key", "source": "shodan"}
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"https://api.shodan.io/shodan/host/{ip}?key={api_key}",
                             timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200:
                    return {"success": True, "data": await r.json(), "source": "shodan"}
                return {"success": False, "error": f"HTTP {r.status}", "source": "shodan"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "shodan"}


async def scan_virustotal(domain: str, api_key: str) -> dict:
    if not api_key:
        return {"success": False, "error": "No VT API key", "source": "virustotal"}
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"https://www.virustotal.com/api/v3/domains/{domain}",
                             headers={"x-apikey": api_key},
                             timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200:
                    d = await r.json()
                    return {"success": True, "data": d.get("data", {}).get("attributes", {}), "source": "virustotal"}
                return {"success": False, "error": f"HTTP {r.status}", "source": "virustotal"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "virustotal"}


# ===================== EMAIL =====================

def extract_email_metadata(email: str) -> dict:
    parts = email.split("@")
    if len(parts) != 2:
        return {"valid": False}
    local, domain = parts
    tld = domain.split(".")[-1]
    providers = {
        "gmail.com": "Google", "googlemail.com": "Google",
        "outlook.com": "Microsoft", "hotmail.com": "Microsoft", "live.com": "Microsoft",
        "yahoo.com": "Yahoo", "protonmail.com": "ProtonMail", "proton.me": "ProtonMail",
        "icloud.com": "Apple", "aol.com": "AOL", "tutanota.com": "Tutanota",
        "zoho.com": "Zoho", "fastmail.com": "FastMail",
    }
    disposable = {"guerrillamail.com", "mailinator.com", "tempmail.com", "throwaway.email",
                  "yopmail.com", "10minutemail.com", "sharklasers.com", "maildrop.cc",
                  "dispostable.com", "trashmail.com", "grr.la"}
    return {
        "valid": True, "local": local, "domain": domain, "tld": tld,
        "provider": providers.get(domain.lower(), "Custom/Unknown"),
        "is_disposable": domain.lower() in disposable,
        "is_custom_domain": domain.lower() not in providers,
    }


async def scan_mx(email: str) -> dict:
    try:
        domain = email.split("@")[1]
        resolver = dns.resolver.Resolver()
        resolver.timeout = 10
        answers = resolver.resolve(domain, "MX")
        mx = [{"priority": r.preference, "exchange": str(r.exchange)} for r in answers]
        return {"success": True, "data": {"valid_mx": True, "mx_records": mx}, "source": "dns_mx"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "dns_mx"}


async def scan_gravatar(email: str) -> dict:
    try:
        h = hashlib.md5(email.strip().lower().encode()).hexdigest()
        async with aiohttp.ClientSession() as s:
            async with s.get(f"https://en.gravatar.com/{h}.json",
                             timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status == 200:
                    data = await r.json()
                    entry = data.get("entry", [{}])[0]
                    return {"success": True, "data": {
                        "found": True, "display_name": entry.get("displayName"),
                        "profile_url": entry.get("profileUrl"),
                        "urls": entry.get("urls", []),
                        "accounts": entry.get("accounts", []),
                        "about": entry.get("aboutMe"),
                        "location": entry.get("currentLocation"),
                    }, "source": "gravatar"}
                elif r.status == 404:
                    return {"success": True, "data": {"found": False}, "source": "gravatar"}
                return {"success": False, "error": f"HTTP {r.status}", "source": "gravatar"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "gravatar"}


async def scan_hibp(email: str, api_key: str) -> dict:
    if not api_key:
        return {"success": False, "error": "No HIBP API key", "source": "hibp"}
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(
                f"https://haveibeenpwned.com/api/v3/breachedaccount/{email}?truncateResponse=false",
                headers={"hibp-api-key": api_key, "User-Agent": "DarkTraceLoom"},
                timeout=aiohttp.ClientTimeout(total=15)
            ) as r:
                if r.status == 200:
                    breaches = await r.json()
                    return {"success": True, "data": {
                        "breached": True, "breach_count": len(breaches),
                        "breaches": [{"name": b.get("Name"), "domain": b.get("Domain"),
                                      "date": b.get("BreachDate"), "count": b.get("PwnCount"),
                                      "data_classes": b.get("DataClasses", [])} for b in breaches]
                    }, "source": "hibp"}
                elif r.status == 404:
                    return {"success": True, "data": {"breached": False, "breach_count": 0}, "source": "hibp"}
                return {"success": False, "error": f"HTTP {r.status}", "source": "hibp"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "hibp"}


# ===================== USERNAME =====================

PLATFORMS = {
    "GitHub": "https://api.github.com/users/{}",
    "Reddit": "https://www.reddit.com/user/{}/about.json",
    "HackerNews": "https://hacker-news.firebaseio.com/v0/user/{}.json",
    "Keybase": "https://keybase.io/_/api/1.0/user/lookup.json?username={}",
    "DockerHub": "https://hub.docker.com/v2/users/{}/",
    "GitLab": "https://gitlab.com/api/v4/users?username={}",
    "PyPI": "https://pypi.org/user/{}/",
    "Steam": "https://steamcommunity.com/id/{}/",
    "Twitch": "https://www.twitch.tv/{}",
    "Medium": "https://medium.com/@{}",
    "DevTo": "https://dev.to/{}",
    "Replit": "https://replit.com/@{}",
    "Linktree": "https://linktr.ee/{}",
    "Behance": "https://www.behance.net/{}",
    "Dribbble": "https://dribbble.com/{}",
    "Kaggle": "https://www.kaggle.com/{}",
    "Vimeo": "https://vimeo.com/{}",
    "SoundCloud": "https://soundcloud.com/{}",
    "Patreon": "https://www.patreon.com/{}",
    "BuyMeACoffee": "https://buymeacoffee.com/{}",
    "About.me": "https://about.me/{}",
    "Telegram": "https://t.me/{}",
    "Pinterest": "https://www.pinterest.com/{}/",
    "Flickr": "https://www.flickr.com/people/{}/",
    "WordPress": "https://{}.wordpress.com",
    "Tumblr": "https://{}.tumblr.com",
    "Fiverr": "https://www.fiverr.com/{}",
    "LeetCode": "https://leetcode.com/{}/",
    "HackerRank": "https://www.hackerrank.com/{}",
    "BitBucket": "https://bitbucket.org/{}/",
    "Imgur": "https://imgur.com/user/{}",
    "npm": "https://www.npmjs.com/~{}",
    "Gravatar": "https://en.gravatar.com/{}",
}

# Platforms that return JSON and can be enriched beyond status code
JSON_PLATFORMS = {"GitHub", "Reddit", "HackerNews", "Keybase", "DockerHub", "GitLab"}


async def _check_platform(session, username, name, url_tmpl) -> dict:
    url = url_tmpl.format(username)
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    if name == "GitHub":
        headers["Accept"] = "application/vnd.github.v3+json"
    elif name == "Reddit":
        headers["User-Agent"] = "DarkTraceLoom/1.0"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=12),
                               allow_redirects=True, headers=headers) as r:
            result = {"platform": name, "url": url, "status": r.status, "exists": r.status == 200}
            # Deep enrichment for JSON platforms
            if result["exists"] and name in JSON_PLATFORMS:
                try:
                    data = await r.json(content_type=None)
                    if name == "GitHub" and isinstance(data, dict):
                        result["profile"] = {k: data.get(k) for k in
                            ("name", "bio", "company", "location", "email", "blog",
                             "twitter_username", "public_repos", "followers", "following",
                             "created_at", "updated_at")}
                    elif name == "Reddit" and isinstance(data, dict):
                        ud = data.get("data", {})
                        if not ud.get("is_suspended"):
                            result["profile"] = {
                                "karma": ud.get("total_karma"),
                                "created": datetime.fromtimestamp(ud.get("created_utc", 0), tz=timezone.utc).isoformat() if ud.get("created_utc") else None,
                                "verified_email": ud.get("has_verified_email"),
                                "is_mod": ud.get("is_mod"),
                            }
                    elif name == "HackerNews" and isinstance(data, dict) and data:
                        result["profile"] = {
                            "karma": data.get("karma"),
                            "about": data.get("about"),
                            "created": datetime.fromtimestamp(data.get("created", 0), tz=timezone.utc).isoformat() if data.get("created") else None,
                            "submissions": len(data.get("submitted", [])),
                        }
                    elif name == "Keybase" and isinstance(data, dict):
                        them = data.get("them", {})
                        if them:
                            proofs = them.get("proofs_summary", {}).get("all", [])
                            result["profile"] = {
                                "name": them.get("profile", {}).get("full_name"),
                                "bio": them.get("profile", {}).get("bio"),
                            }
                            result["verified_proofs"] = [
                                {"type": p.get("proof_type"), "username": p.get("nametag"),
                                 "url": p.get("service_url")} for p in proofs
                            ]
                            crypto = them.get("cryptocurrency_addresses", {})
                            result["crypto_addresses"] = []
                            for coin, addrs in crypto.items():
                                for a in addrs:
                                    result["crypto_addresses"].append({"coin": coin, "address": a.get("address")})
                    elif name == "DockerHub" and isinstance(data, dict):
                        result["profile"] = {
                            "full_name": data.get("full_name"),
                            "company": data.get("company"),
                            "location": data.get("location"),
                            "date_joined": data.get("date_joined"),
                        }
                    elif name == "GitLab" and isinstance(data, list) and data:
                        u = data[0]
                        result["profile"] = {
                            "name": u.get("name"),
                            "username": u.get("username"),
                            "web_url": u.get("web_url"),
                            "state": u.get("state"),
                        }
                except Exception:
                    pass  # JSON parse failed, still have exists=True
            return result
    except asyncio.TimeoutError:
        return {"platform": name, "url": url, "exists": None, "error": "timeout"}
    except Exception as e:
        return {"platform": name, "url": url, "exists": None, "error": str(e)}


async def scan_username(username: str) -> dict:
    connector = aiohttp.TCPConnector(limit=15, limit_per_host=2)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [_check_platform(session, username, name, tmpl) for name, tmpl in PLATFORMS.items()]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    found, not_found, errors = [], [], []
    for r in results:
        if isinstance(r, Exception):
            errors.append({"error": str(r)})
        elif r.get("error"):
            errors.append(r)
        elif r.get("exists"):
            found.append(r)
        elif r.get("exists") is False:
            not_found.append(r)
        else:
            errors.append(r)

    return {
        "total_checked": len(PLATFORMS), "found_count": len(found),
        "found": found, "not_found": not_found, "errors": errors,
    }


# ===================== PHONE =====================

AREA_CODES = {
    "201":"NJ","202":"DC","203":"CT","205":"AL","206":"WA","207":"ME","208":"ID",
    "209":"CA","210":"TX","212":"NY","213":"CA","214":"TX","215":"PA","216":"OH",
    "217":"IL","218":"MN","219":"IN","224":"IL","225":"LA","228":"MS","229":"GA",
    "231":"MI","234":"OH","239":"FL","240":"MD","248":"MI","251":"AL","252":"NC",
    "253":"WA","254":"TX","256":"AL","260":"IN","262":"WI","267":"PA","269":"MI",
    "270":"KY","276":"VA","281":"TX","301":"MD","302":"DE","303":"CO","304":"WV",
    "305":"FL","307":"WY","308":"NE","309":"IL","310":"CA","312":"IL","313":"MI",
    "314":"MO","315":"NY","316":"KS","317":"IN","318":"LA","319":"IA","320":"MN",
    "321":"FL","323":"CA","325":"TX","330":"OH","331":"IL","334":"AL","336":"NC",
    "337":"LA","339":"MA","346":"TX","347":"NY","351":"MA","352":"FL","360":"WA",
    "361":"TX","385":"UT","386":"FL","401":"RI","402":"NE","404":"GA","405":"OK",
    "406":"MT","407":"FL","408":"CA","409":"TX","410":"MD","412":"PA","413":"MA",
    "414":"WI","415":"CA","417":"MO","419":"OH","423":"TN","424":"CA","425":"WA",
    "430":"TX","432":"TX","434":"VA","435":"UT","440":"OH","443":"MD","458":"OR",
    "469":"TX","470":"GA","475":"CT","478":"GA","479":"AR","480":"AZ","484":"PA",
    "501":"AR","502":"KY","503":"OR","504":"LA","505":"NM","507":"MN","508":"MA",
    "509":"WA","510":"CA","512":"TX","513":"OH","515":"IA","516":"NY","517":"MI",
    "518":"NY","520":"AZ","530":"CA","539":"OK","540":"VA","541":"OR","551":"NJ",
    "559":"CA","561":"FL","562":"CA","563":"IA","567":"OH","570":"PA","571":"VA",
    "573":"MO","574":"IN","575":"NM","580":"OK","585":"NY","586":"MI","601":"MS",
    "602":"AZ","603":"NH","605":"SD","606":"KY","607":"NY","608":"WI","609":"NJ",
    "610":"PA","612":"MN","614":"OH","615":"TN","616":"MI","617":"MA","618":"IL",
    "619":"CA","620":"KS","623":"AZ","626":"CA","628":"CA","629":"TN","630":"IL",
    "631":"NY","636":"MO","646":"NY","650":"CA","651":"MN","657":"CA","661":"CA",
    "662":"MS","667":"MD","669":"CA","678":"GA","681":"WV","682":"TX","701":"ND",
    "702":"NV","703":"VA","704":"NC","706":"GA","707":"CA","708":"IL","712":"IA",
    "713":"TX","714":"CA","715":"WI","716":"NY","717":"PA","718":"NY","719":"CO",
    "720":"CO","724":"PA","727":"FL","731":"TN","732":"NJ","734":"MI","737":"TX",
    "740":"OH","747":"CA","754":"FL","757":"VA","760":"CA","762":"GA","763":"MN",
    "765":"IN","769":"MS","770":"GA","772":"FL","773":"IL","774":"MA","775":"NV",
    "779":"IL","781":"MA","785":"KS","786":"FL","801":"UT","802":"VT","803":"SC",
    "804":"VA","805":"CA","806":"TX","808":"HI","810":"MI","812":"IN","813":"FL",
    "814":"PA","815":"IL","816":"MO","817":"TX","818":"CA","828":"NC","830":"TX",
    "831":"CA","832":"TX","843":"SC","845":"NY","847":"IL","848":"NJ","850":"FL",
    "854":"SC","856":"NJ","857":"MA","858":"CA","859":"KY","860":"CT","862":"NJ",
    "863":"FL","864":"SC","865":"TN","870":"AR","872":"IL","901":"TN","903":"TX",
    "904":"FL","906":"MI","907":"AK","908":"NJ","909":"CA","910":"NC","912":"GA",
    "913":"KS","914":"NY","915":"TX","916":"CA","917":"NY","918":"OK","919":"NC",
    "920":"WI","925":"CA","928":"AZ","929":"NY","931":"TN","936":"TX","937":"OH",
    "940":"TX","941":"FL","947":"MI","949":"CA","951":"CA","952":"MN","954":"FL",
    "956":"TX","970":"CO","971":"OR","972":"TX","973":"NJ","978":"MA","979":"TX",
    "980":"NC","984":"NC","985":"LA","989":"MI",
}


def parse_phone(phone: str) -> dict:
    cleaned = re.sub(r'[^\d+]', '', phone)
    if not cleaned:
        return {"valid": False, "error": "No digits"}
    digits = cleaned.replace("+", "")
    if len(digits) < 7 or len(digits) > 15:
        return {"valid": False, "error": f"Bad length: {len(digits)}"}
    result = {"valid": True, "cleaned": cleaned, "digits": digits, "digit_count": len(digits)}

    # Try NANP
    national = digits
    if digits.startswith("1") and len(digits) == 11:
        national = digits[1:]
    if len(national) == 10:
        ac = national[:3]
        if ac in AREA_CODES:
            result.update({
                "country": "US", "country_code": "+1",
                "area_code": ac, "state": AREA_CODES[ac],
                "formatted": f"+1 ({ac}) {national[3:6]}-{national[6:]}",
            })
    return result


# ===================== CRYPTO =====================

def identify_crypto(address: str) -> dict:
    address = address.strip()
    if re.match(r'^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$', address):
        return {"type": "bitcoin", "format": "P2PKH/P2SH"}
    if re.match(r'^bc1[a-zA-HJ-NP-Z0-9]{25,62}$', address):
        return {"type": "bitcoin", "format": "Bech32"}
    if re.match(r'^0x[0-9a-fA-F]{40}$', address):
        return {"type": "ethereum", "format": "Standard"}
    if re.match(r'^4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$', address):
        return {"type": "monero", "format": "Standard"}
    if re.match(r'^r[0-9a-zA-Z]{24,34}$', address):
        return {"type": "xrp", "format": "Standard"}
    if re.match(r'^[LM][a-km-zA-HJ-NP-Z1-9]{26,33}$', address):
        return {"type": "litecoin", "format": "Standard"}
    return {"type": "unknown", "format": "unknown"}


async def scan_btc(address: str) -> dict:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"https://blockchain.info/rawaddr/{address}?limit=10",
                             timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status != 200:
                    return {"success": False, "error": f"HTTP {r.status}", "source": "blockchain.info"}
                data = await r.json()
                return {"success": True, "data": {
                    "address": data.get("address"),
                    "n_tx": data.get("n_tx"),
                    "total_received_btc": data.get("total_received", 0) / 1e8,
                    "total_sent_btc": data.get("total_sent", 0) / 1e8,
                    "final_balance_btc": data.get("final_balance", 0) / 1e8,
                    "txs": [{"hash": tx.get("hash"), "time": tx.get("time"),
                             "fee": tx.get("fee"), "result": tx.get("result")}
                            for tx in data.get("txs", [])[:10]],
                }, "source": "blockchain.info"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "blockchain.info"}


async def scan_eth(address: str, api_key: str = None) -> dict:
    key = api_key or "YourApiKeyToken"
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(
                f"https://api.etherscan.io/api?module=account&action=balance&address={address}&tag=latest&apikey={key}",
                timeout=aiohttp.ClientTimeout(total=15)
            ) as r:
                bal = await r.json()
            async with s.get(
                f"https://api.etherscan.io/api?module=account&action=txlist&address={address}&startblock=0&endblock=99999999&page=1&offset=10&sort=desc&apikey={key}",
                timeout=aiohttp.ClientTimeout(total=15)
            ) as r2:
                txd = await r2.json()
            balance_wei = int(bal.get("result", "0")) if bal.get("status") == "1" else 0
            txs = txd.get("result", []) if isinstance(txd.get("result"), list) else []
            return {"success": True, "data": {
                "balance_eth": balance_wei / 1e18,
                "tx_count": len(txs),
                "txs": [{"hash": t.get("hash"), "from": t.get("from"), "to": t.get("to"),
                         "value_eth": int(t.get("value", "0")) / 1e18,
                         "timestamp": t.get("timeStamp")} for t in txs[:10]],
            }, "source": "etherscan"}
    except Exception as e:
        return {"success": False, "error": str(e), "source": "etherscan"}
