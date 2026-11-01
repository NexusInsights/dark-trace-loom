import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { publicBackendConfig } from '@/lib/backendConfig';

const backend = publicBackendConfig(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(backend.url, backend.key, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
  }
});
