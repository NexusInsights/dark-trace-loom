-- Pre-launch wipe of fabricated OSINT data from simulated pipeline runs.
-- Real dispatcher ships in this same deploy.
DELETE FROM public.entity_observations;
DELETE FROM public.breach_records;
DELETE FROM public.identity_entities;
DELETE FROM public.tool_results;

-- breach_records: add real-API columns (no-op if already exist)
ALTER TABLE public.breach_records
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS identifier text,
  ADD COLUMN IF NOT EXISTS breach_name text,
  ADD COLUMN IF NOT EXISTS data_classes jsonb,
  ADD COLUMN IF NOT EXISTS raw_response jsonb;

-- Allow non-exposure / not_configured rows that aren't tied to a specific entity
ALTER TABLE public.breach_records ALTER COLUMN entity_id DROP NOT NULL;
ALTER TABLE public.breach_records ALTER COLUMN breach_source DROP NOT NULL;

-- Old uniqueness was (entity_id, breach_source); drop so identifier-scoped rows don't conflict
ALTER TABLE public.breach_records DROP CONSTRAINT IF EXISTS breach_records_entity_id_breach_source_key;

-- tool_results: status column for honest provenance
ALTER TABLE public.tool_results
  ADD COLUMN IF NOT EXISTS status text;