-- Run on source and target with administrative access; compare every row.
-- Unknown production drift is detected separately by source-audit.sql.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
-- Requires a real administrative database connection, not an RLS user export.
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
     OR NOT has_table_privilege(current_user, 'auth.users', 'SELECT') THEN
    RAISE EXCEPTION 'Administrative unrestricted source/target access is required; RLS user rows are not a complete export';
  END IF;
END
$guard$;

SELECT 'public.activity_logs'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.activity_logs
UNION ALL
SELECT 'public.agent_runs'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.agent_runs
UNION ALL
SELECT 'public.agents'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.agents
UNION ALL
SELECT 'public.alert_notifications'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.alert_notifications
UNION ALL
SELECT 'public.alerts'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.alerts
UNION ALL
SELECT 'public.analysis_reports'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.analysis_reports
UNION ALL
SELECT 'public.api_keys'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.api_keys
UNION ALL
SELECT 'public.api_usage'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.api_usage
UNION ALL
SELECT 'public.articles'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.articles
UNION ALL
SELECT 'public.artifacts'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.artifacts
UNION ALL
SELECT 'public.billing_events'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.billing_events
UNION ALL
SELECT 'public.breach_records'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.breach_records
UNION ALL
SELECT 'public.case_collaborators'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.case_collaborators
UNION ALL
SELECT 'public.cases'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.cases
UNION ALL
SELECT 'public.cluster_members'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.cluster_members
UNION ALL
SELECT 'public.courses'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.courses
UNION ALL
SELECT 'public.cross_case_correlations'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.cross_case_correlations
UNION ALL
SELECT 'public.cross_case_links'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.cross_case_links
UNION ALL
SELECT 'public.email_candidates'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.email_candidates
UNION ALL
SELECT 'public.entities'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.entities
UNION ALL
SELECT 'public.entity_monitors'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.entity_monitors
UNION ALL
SELECT 'public.entity_observations'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.entity_observations
UNION ALL
SELECT 'public.entity_relationships'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.entity_relationships
UNION ALL
SELECT 'public.entity_scores'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.entity_scores
UNION ALL
SELECT 'public.entity_timeline'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.entity_timeline
UNION ALL
SELECT 'public.events'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.events
UNION ALL
SELECT 'public.evidence_logs'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.evidence_logs
UNION ALL
SELECT 'public.expansion_logs'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.expansion_logs
UNION ALL
SELECT 'public.identity_clusters'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.identity_clusters
UNION ALL
SELECT 'public.identity_entities'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.identity_entities
UNION ALL
SELECT 'public.identity_entity_links'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.identity_entity_links
UNION ALL
SELECT 'public.infrastructure_links'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.infrastructure_links
UNION ALL
SELECT 'public.intelligence_executions'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.intelligence_executions
UNION ALL
SELECT 'public.investigation_suggestions'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.investigation_suggestions
UNION ALL
SELECT 'public.investigation_templates'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.investigation_templates
UNION ALL
SELECT 'public.lessons'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.lessons
UNION ALL
SELECT 'public.modules'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.modules
UNION ALL
SELECT 'public.organization_invitations'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.organization_invitations
UNION ALL
SELECT 'public.organization_members'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.organization_members
UNION ALL
SELECT 'public.organizations'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.organizations
UNION ALL
SELECT 'public.pdl_lookups'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.pdl_lookups
UNION ALL
SELECT 'public.persona_events'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.persona_events
UNION ALL
SELECT 'public.persona_identifiers'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.persona_identifiers
UNION ALL
SELECT 'public.personas'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.personas
UNION ALL
SELECT 'public.pipeline_runs'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.pipeline_runs
UNION ALL
SELECT 'public.pipelines'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.pipelines
UNION ALL
SELECT 'public.platform_accounts'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.platform_accounts
UNION ALL
SELECT 'public.profiles'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.profiles
UNION ALL
SELECT 'public.progress'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.progress
UNION ALL
SELECT 'public.reports'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.reports
UNION ALL
SELECT 'public.similarity_scores'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.similarity_scores
UNION ALL
SELECT 'public.social_graph_edges'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.social_graph_edges
UNION ALL
SELECT 'public.subjects'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.subjects
UNION ALL
SELECT 'public.subscriptions'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.subscriptions
UNION ALL
SELECT 'public.system_logs'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.system_logs
UNION ALL
SELECT 'public.tags'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.tags
UNION ALL
SELECT 'public.tool_marketplace'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.tool_marketplace
UNION ALL
SELECT 'public.tool_permissions'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.tool_permissions
UNION ALL
SELECT 'public.tool_results'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.tool_results
UNION ALL
SELECT 'public.usage_metrics'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.usage_metrics
UNION ALL
SELECT 'public.user_installed_tools'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.user_installed_tools
UNION ALL
SELECT 'public.user_roles'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.user_roles
UNION ALL
SELECT 'public.username_candidates'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.username_candidates
UNION ALL
SELECT 'auth.users', count(*)::bigint, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) FROM auth.users
UNION ALL
SELECT 'auth.identities', count(*)::bigint, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) FROM auth.identities
ORDER BY relation;
COMMIT;
