-- Product recovery and IP case intake. Every statement is safe on retries.
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE products ADD COLUMN IF NOT EXISTS recoverable_until timestamp with time zone;
CREATE INDEX IF NOT EXISTS products_deleted_at_idx ON products (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS active_standing boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS policy_restricted boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS ip_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference text NOT NULL UNIQUE,
  status_token_hash text NOT NULL,
  claimant_name text NOT NULL,
  claimant_email text NOT NULL,
  claimant_contact text,
  listing_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  listing_url text,
  rights_type text NOT NULL,
  description text NOT NULL,
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'submitted',
  moderator_notes text,
  assigned_moderator_id text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ip_cases_reference_token_idx ON ip_cases (public_reference, status_token_hash);
CREATE INDEX IF NOT EXISTS ip_cases_moderation_idx ON ip_cases (status, created_at);
CREATE INDEX IF NOT EXISTS ip_cases_listing_idx ON ip_cases (listing_product_id);

CREATE TABLE IF NOT EXISTS ip_case_audit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES ip_cases(id) ON DELETE CASCADE,
  action text NOT NULL,
  previous_status text,
  next_status text,
  actor_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ip_case_audit_case_created_idx ON ip_case_audit_history (case_id, created_at);