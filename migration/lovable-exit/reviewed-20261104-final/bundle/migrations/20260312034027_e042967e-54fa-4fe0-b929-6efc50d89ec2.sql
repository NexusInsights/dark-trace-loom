
-- Add user_id to tool_results for standalone saves
ALTER TABLE public.tool_results ADD COLUMN IF NOT EXISTS user_id uuid;

-- Add RLS policy for standalone tool results (no case_id)
CREATE POLICY "Users can manage own standalone tool results"
ON public.tool_results
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_tool_results_user_id ON public.tool_results(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_key_timestamp ON public.api_usage(key_id, timestamp);
