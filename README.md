# Dark Trace Loom

Enterprise OSINT platform. Python FastAPI backend with maigret 3,125-site username scanner, SQLite WAL storage, NetworkX graph analytics, STIX 2.1 export, and an Expo / React Native mobile client.

**Operator:** TJK Security & Automation LLC — Liberty Hill, TX
**Status:** Local-deploy. Self-hosted. No cloud dependencies.

---

## Architecture

```
dark-trace-loom/
├── app.py                  FastAPI app, 24 routes
├── database.py             SQLite WAL — entities, relationships, cases, alerts, api_keys
├── requirements.txt        Python dependencies (no pip in run scripts)
├── run.sh / run.bat        Start server on 0.0.0.0:8900
├── osint/
│   ├── detection.py        Type detection + risk scoring
│   ├── scanners.py         WHOIS, DNS, crt.sh, SSL, Wayback, IP geo, HIBP, BTC/ETH
│   ├── maigret_scanner.py  soxoj/maigret wrapper — 3,125 sites, profile parsing, recursive ID extraction
│   └── engine.py           Scan orchestrator + auto-pivot + graph analytics + STIX export + AI engine
├── static/
│   ├── index.html          Desktop D3 graph UI
│   ├── mobile.html         PWA — installable to iOS home screen
│   ├── manifest.json       PWA manifest
│   └── sw.js               Service worker
└── mobile/                 Expo / React Native client (separate Node project)
    ├── app.json            Dark Trace Loom — slug: dark-trace-loom, scheme: dtl, pkg: com.tjksecurity.darktrace
    ├── package.json
    └── src/
        ├── app/(tabs)/     Scan, Graph, Cases, Settings screens
        └── lib/            api.ts, store.ts (Zustand + AsyncStorage), theme.ts
```

## Running the backend

Requires Python 3.10+. Dependencies installed via system package manager or pre-frozen environment.

```bash
# Linux/macOS
bash run.sh

# Windows
run.bat
```

Server starts at `http://0.0.0.0:8900`.

## Running the mobile app

Requires Node 20+ and the Expo CLI.

```bash
cd mobile
npm install
npx expo start
```

Configure backend URL and API keys via the Settings tab in the app.

## API key configuration

The backend stores API keys in its local SQLite database via the `/api/keys` endpoint. Configurable services:

- Anthropic — AI correlation engine
- Hunter.io — email enrichment
- VirusTotal — domain/IP reputation
- Shodan — IP intelligence
- HIBP — breach detection

Set via the Settings tab in the mobile app or POST to `/api/keys`.

## Capabilities

- **Username:** maigret across 3,125 sites (500 default by Alexa rank, 2,669 enabled, 142 tag categories). Profile page parsing via `socid_extractor` extracts names, bios, emails, numeric IDs from found profiles. Recursive — discovered IDs become new graph entities at 0.85 confidence.
- **Email:** MX validation, Gravatar lookup, HIBP breach check, Hunter.io enrichment, disposable detection
- **Domain:** WHOIS, DNS, crt.sh certificate transparency, SSL inspection, Wayback Machine history
- **IP:** Geolocation, reverse DNS, Shodan, VirusTotal
- **Phone:** NANP parsing, area-code-to-state resolution (300+ US codes)
- **Crypto:** Format ID across BTC/ETH/LTC/DOGE/XMR/XRP/SOL, blockchain.info + Etherscan queries
- **Auto-pivot:** Recursive scan from seed entity, configurable depth + entity cap + confidence threshold + type whitelist, full lineage tracking
- **Graph analytics:** NetworkX-backed PageRank, betweenness centrality, community detection, shortest paths, bridge detection
- **STIX 2.1 export:** Bundle export compatible with OpenCTI, MISP, TheHive, Maltego, Splunk SOAR

## Routes (24)

```
POST   /api/scan
GET    /api/scan/detect
GET    /api/maigret/stats
POST   /api/maigret/scan
POST   /api/autopivot
GET    /api/entities
GET    /api/entities/{eid}
DELETE /api/entities/{eid}
GET    /api/graph
GET    /api/analytics
POST   /api/ai/analyze/{eid}
POST   /api/ai/correlate
GET    /api/export/stix
GET    /api/export/stix/download
POST   /api/cases
GET    /api/cases
POST   /api/cases/add-entity
GET    /api/alerts
POST   /api/keys
GET    /api/keys
DELETE /api/keys/{service}
GET    /api/stats
GET    /                    (mobile PWA)
GET    /desktop             (desktop D3 graph UI)
```

## License

Proprietary. TJK Security & Automation LLC. All rights reserved.
