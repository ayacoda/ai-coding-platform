import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kuzptrzpacesdneogmaq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1enB0cnpwYWNlc2RuZW9nbWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTkxMjIsImV4cCI6MjA4NTk5NTEyMn0.yjrT7gcIryOVrv89ooSGsfrnz6wJwsdh3Pss87NX-bY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface DbProject {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  files: Record<string, string>;
  messages: Record<string, unknown>[] | null;
  prompt_queue: Record<string, unknown>[] | null;
  queue_paused: boolean | null;
  storage_mode: 'localstorage' | 'supabase';
  project_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
