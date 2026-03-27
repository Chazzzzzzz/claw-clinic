import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  _client = createClient(url, key);
  return _client;
}

export interface CaseRecord {
  id: string;
  icd_ai_code: string;
  disease_name: string;
  symptoms_text: string;
  evidence_summary: string | null;
  treatment_steps: Array<{ label: string; command?: string; description: string }>;
  outcome: "cured" | "partial" | "failed";
  source: "system" | "community";
  framework: string | null;
  created_by: string | null;
  created_at: string;
  success_count: number;
  last_verified_at: string | null;
}
