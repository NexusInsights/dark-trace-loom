-- Additive restrictive guards: earlier permissive policies combine with OR.
-- Preserve collaborator reads and legacy case-owned rows, while new writes
-- must identify the verified actor and may reference only that actor's case.
-- No records are changed. Apply only through the reviewed migration route.
CREATE POLICY "Tool result read scope guard" ON public.tool_results
  AS RESTRICTIVE FOR SELECT TO authenticated USING (
    (case_id IS NULL AND user_id = auth.uid()) OR
    (case_id IS NOT NULL AND (public.is_case_owner(auth.uid(), case_id) OR public.is_case_collaborator(auth.uid(), case_id)))
  );
CREATE POLICY "Tool result insert scope guard" ON public.tool_results
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND (case_id IS NULL OR public.is_case_owner(auth.uid(), case_id))
  );
CREATE POLICY "Tool result update scope guard" ON public.tool_results
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid() AND (case_id IS NULL OR public.is_case_owner(auth.uid(), case_id))) OR (user_id IS NULL AND case_id IS NOT NULL AND public.is_case_owner(auth.uid(), case_id)))
  WITH CHECK (user_id = auth.uid() AND (case_id IS NULL OR public.is_case_owner(auth.uid(), case_id)));
CREATE POLICY "Tool result delete scope guard" ON public.tool_results
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid() AND (case_id IS NULL OR public.is_case_owner(auth.uid(), case_id))) OR (user_id IS NULL AND case_id IS NOT NULL AND public.is_case_owner(auth.uid(), case_id)));

CREATE POLICY "Pipeline case scope guard" ON public.pipelines
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (user_id = auth.uid() AND (target_case_id IS NULL OR public.is_case_owner(auth.uid(), target_case_id)))
  WITH CHECK (user_id = auth.uid() AND (target_case_id IS NULL OR public.is_case_owner(auth.uid(), target_case_id)));
CREATE POLICY "Pipeline run scope guard" ON public.pipeline_runs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = pipeline_id AND p.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = pipeline_id AND p.user_id = auth.uid()));
CREATE POLICY "Agent run case scope guard" ON public.agent_runs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (user_id = auth.uid() AND (case_id IS NULL OR public.is_case_owner(auth.uid(), case_id)))
  WITH CHECK (user_id = auth.uid() AND (case_id IS NULL OR public.is_case_owner(auth.uid(), case_id)));
