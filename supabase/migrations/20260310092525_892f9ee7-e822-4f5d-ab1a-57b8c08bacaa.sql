
-- Create artifacts storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('artifacts', 'artifacts', false);

-- RLS: Only artifact owners can upload (owner_id folder structure: owner_id/case_id/filename)
CREATE POLICY "Owners can upload artifacts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS: Only artifact owners can read their files
CREATE POLICY "Owners can read own artifacts"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS: Only artifact owners can delete their files
CREATE POLICY "Owners can delete own artifacts"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
