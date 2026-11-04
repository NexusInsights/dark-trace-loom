
-- Tighten tags insert: require non-empty name (the USING(true) for INSERT is intentional for shared tags)
DROP POLICY "Authenticated users can insert tags" ON public.tags;
CREATE POLICY "Authenticated users can insert tags" ON public.tags FOR INSERT TO authenticated
  WITH CHECK (length(trim(name)) > 0);
