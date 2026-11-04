-- Requires a real administrative database connection, not an RLS user export.
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
     OR NOT has_table_privilege(current_user, 'auth.users', 'SELECT') THEN
    RAISE EXCEPTION 'Administrative unrestricted source/target access is required; RLS user rows are not a complete export';
  END IF;
END
$guard$;
