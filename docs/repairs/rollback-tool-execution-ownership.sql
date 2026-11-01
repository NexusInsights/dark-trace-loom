-- Reviewed rollback reference only. This removes the additive guards and
-- restores the earlier permissive-policy exposure; no row data is removed.
-- Do not execute on a live backend without the separate release approval.
DROP POLICY IF EXISTS "Tool result read scope guard" ON public.tool_results;
DROP POLICY IF EXISTS "Tool result insert scope guard" ON public.tool_results;
DROP POLICY IF EXISTS "Tool result update scope guard" ON public.tool_results;
DROP POLICY IF EXISTS "Tool result delete scope guard" ON public.tool_results;
DROP POLICY IF EXISTS "Pipeline case scope guard" ON public.pipelines;
DROP POLICY IF EXISTS "Pipeline run scope guard" ON public.pipeline_runs;
DROP POLICY IF EXISTS "Agent run case scope guard" ON public.agent_runs;
