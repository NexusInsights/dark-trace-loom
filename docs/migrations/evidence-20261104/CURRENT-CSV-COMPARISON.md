# Fresh source CSV comparison

Read-only comparison recorded 2026-11-04T08:48:14.552421+00:00. No SQL was generated or executed.

**63 tables / 2,872 CSV rows compared:** 162 new IDs, 0 historical IDs missing, 42 changed shared rows beyond possible spreadsheet decoration.

Exact UI totals reported by root are bound to matching CSV hashes and unique row counts for 63 tables. Other tables may have separate root UI evidence; this child receipt does not assume it. Exports are separately timed, not an atomic database snapshot.

## New and changed records

- `activity_logs`: 150 new IDs; 150 new records have blank/null ambiguity.
- `entity_observations`: 1 new IDs; 0 new records have blank/null ambiguity.
- `identity_entities`: 42 changed existing records; changed-column counts (including decorations) {'entity_value': 2, 'metadata': 42, 'confidence_score': 1, 'source_tool': 1}. Existing-record updates require guarded before-images and a separately reviewed rollback.
- `persona_identifiers`: 2 new IDs; 0 new records have blank/null ambiguity.
- `personas`: 1 new IDs; 1 new records have blank/null ambiguity.
- `pipeline_runs`: 1 new IDs; 0 new records have blank/null ambiguity.
- `pipelines`: 1 new IDs; 0 new records have blank/null ambiguity.
- `tool_results`: 4 new IDs; 0 new records have blank/null ambiguity.
- `usage_metrics`: 2 new IDs; 0 new records have blank/null ambiguity.

15 rows have a possible added leading TAB before a spreadsheet-risk prefix. These remain unchanged in the raw exports and are not treated as authorized database updates. The comparator never strips values.

The earlier target-only cluster, generated artifact audit record and pipeline timestamp conflict remain preserved. Source absence does not authorize deleting target-only records.

## Fidelity and remaining work

- Blank nullable text/JSON fields can lose NULL/empty distinctions. Existing values remain preserved; no write is inferred from an ambiguous CSV field.
- Exact CSV/UI ID-set hashes and visible SQL-null markers resolve all 150 new activity IP fields and the one new persona notes field as SQL NULL.
- Typed comparisons normalize timestamps, PostgreSQL/JSON arrays, Booleans and JSON. Exact target digest comparisons are conditional on the documented blank-as-NULL representation.
- **14/14 synthetic normalization tests passed.** This is separate from export completeness and live application acceptance.
- 0 source tables remain outside this comparison. Root owns capture, completeness evidence and eventual cutover.
- Source activity grew from captured 720 to later 721 rows; the additional record is outside this captured set. This is not a current/frozen cutover snapshot.

| Table | Snapshot | CSV | New IDs | Historical IDs absent | Possible decorations | Other changed rows |
|---|---:|---:|---:|---:|---:|---:|
| activity_logs | 570 | 720 | 150 | 0 | 0 | 0 |
| agent_runs | 7 | 7 | 0 | 0 | 0 | 0 |
| agents | 5 | 5 | 0 | 0 | 0 | 0 |
| alert_notifications | 0 | 0 | 0 | 0 | 0 | 0 |
| alerts | 0 | 0 | 0 | 0 | 0 | 0 |
| analysis_reports | 4 | 4 | 0 | 0 | 0 | 0 |
| api_keys | 1 | 1 | 0 | 0 | 0 | 0 |
| api_usage | 0 | 0 | 0 | 0 | 0 | 0 |
| articles | 0 | 0 | 0 | 0 | 0 | 0 |
| artifacts | 9 | 9 | 0 | 0 | 0 | 0 |
| billing_events | 0 | 0 | 0 | 0 | 0 | 0 |
| breach_records | 8 | 8 | 0 | 0 | 0 | 0 |
| case_collaborators | 0 | 0 | 0 | 0 | 0 | 0 |
| cases | 3 | 3 | 0 | 0 | 0 | 0 |
| cluster_members | 23 | 23 | 0 | 0 | 0 | 0 |
| courses | 0 | 0 | 0 | 0 | 0 | 0 |
| cross_case_correlations | 0 | 0 | 0 | 0 | 0 | 0 |
| cross_case_links | 0 | 0 | 0 | 0 | 0 | 0 |
| email_candidates | 140 | 140 | 0 | 0 | 0 | 0 |
| entities | 10 | 10 | 0 | 0 | 0 | 0 |
| entity_monitors | 1 | 1 | 0 | 0 | 0 | 0 |
| entity_observations | 150 | 151 | 1 | 0 | 10 | 0 |
| entity_relationships | 0 | 0 | 0 | 0 | 0 | 0 |
| entity_scores | 65 | 65 | 0 | 0 | 0 | 0 |
| entity_timeline | 0 | 0 | 0 | 0 | 0 | 0 |
| events | 0 | 0 | 0 | 0 | 0 | 0 |
| evidence_logs | 9 | 9 | 0 | 0 | 0 | 0 |
| expansion_logs | 9 | 9 | 0 | 0 | 0 | 0 |
| identity_clusters | 5 | 5 | 0 | 0 | 0 | 0 |
| identity_entities | 85 | 85 | 0 | 0 | 2 | 42 |
| identity_entity_links | 10 | 10 | 0 | 0 | 0 | 0 |
| infrastructure_links | 0 | 0 | 0 | 0 | 0 | 0 |
| intelligence_executions | 7 | 7 | 0 | 0 | 0 | 0 |
| investigation_suggestions | 12 | 12 | 0 | 0 | 0 | 0 |
| investigation_templates | 6 | 6 | 0 | 0 | 0 | 0 |
| lessons | 0 | 0 | 0 | 0 | 0 | 0 |
| modules | 0 | 0 | 0 | 0 | 0 | 0 |
| organization_invitations | 0 | 0 | 0 | 0 | 0 | 0 |
| organization_members | 0 | 0 | 0 | 0 | 0 | 0 |
| organizations | 1 | 1 | 0 | 0 | 0 | 0 |
| pdl_lookups | 4 | 4 | 0 | 0 | 0 | 0 |
| persona_events | 256 | 256 | 0 | 0 | 0 | 0 |
| persona_identifiers | 185 | 187 | 2 | 0 | 3 | 0 |
| personas | 10 | 11 | 1 | 0 | 0 | 0 |
| pipeline_runs | 6 | 7 | 1 | 0 | 0 | 0 |
| pipelines | 3 | 4 | 1 | 0 | 0 | 0 |
| platform_accounts | 262 | 262 | 0 | 0 | 0 | 0 |
| profiles | 2 | 2 | 0 | 0 | 0 | 0 |
| progress | 0 | 0 | 0 | 0 | 0 | 0 |
| reports | 3 | 3 | 0 | 0 | 0 | 0 |
| similarity_scores | 339 | 339 | 0 | 0 | 0 | 0 |
| social_graph_edges | 151 | 151 | 0 | 0 | 0 | 0 |
| subjects | 4 | 4 | 0 | 0 | 0 | 0 |
| subscriptions | 2 | 2 | 0 | 0 | 0 | 0 |
| system_logs | 0 | 0 | 0 | 0 | 0 | 0 |
| tags | 0 | 0 | 0 | 0 | 0 | 0 |
| tool_marketplace | 50 | 50 | 0 | 0 | 0 | 0 |
| tool_permissions | 0 | 0 | 0 | 0 | 0 | 0 |
| tool_results | 33 | 37 | 4 | 0 | 0 | 0 |
| usage_metrics | 53 | 55 | 2 | 0 | 0 | 0 |
| user_installed_tools | 100 | 100 | 0 | 0 | 0 | 0 |
| user_roles | 1 | 1 | 0 | 0 | 0 | 0 |
| username_candidates | 106 | 106 | 0 | 0 | 0 | 0 |

Private inputs and detailed record hashes remain in `D:/CodexData/InsightNexus-Migration/2026-11-04`. No record values or credentials appear in this report.
