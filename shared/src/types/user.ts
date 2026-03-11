export interface User {
  id: string;
  email: string;
  name?: string;
  image?: string;
  stripe_customer_id?: string;
  default_payment_method_id?: string;
  plan: "free" | "pro" | "team";
  free_treatments_remaining: number;
  free_treatments_reset_at: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  last_used_at?: string;
  requests_today: number;
  requests_this_month: number;
  created_at: string;
  revoked_at?: string;
}
