-- 275: Draws for limited drops (Nike SNKRS draw).
-- A product with a scheduled launch can be released as a draw instead of
-- first come, first served. Entries open at product_launches.launch_at and
-- close at entry_closes_at. Each entry holds an authorised, uncaptured
-- PaymentIntent. When entries close the server picks winners at random,
-- captures their payments and cancels the rest. Every step lands in
-- product_draw_events (the audit log).
CREATE TABLE IF NOT EXISTS product_draws (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  entry_closes_at timestamptz NOT NULL,
  -- open | drawing | drawn | cancelled
  status text NOT NULL DEFAULT 'open',
  -- Secret random seed, revealed in the audit log once the draw has run.
  -- seed_hash = sha256(seed) is fixed when the draw is created, so anyone
  -- with the audit log can check the seed wasn't swapped afterwards.
  seed text NOT NULL,
  seed_hash text NOT NULL,
  drawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_draws_due_idx ON product_draws (status, entry_closes_at);

CREATE TABLE IF NOT EXISTS product_draw_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  buyer_id text NOT NULL,
  variant_id uuid NOT NULL,
  address_id uuid,
  -- pending (payment not yet authorised) | entered | won | lost | charge_failed | withdrawn | released
  status text NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id text,
  amount_cents integer NOT NULL DEFAULT 0,
  -- Server-priced snapshot (items, shipping, tax, fees, ship-to) used to
  -- build the winner's order exactly as it was authorised.
  priced jsonb NOT NULL,
  notify_result boolean NOT NULL DEFAULT false,
  draw_rank integer,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_draw_entries_product_buyer_unique UNIQUE (product_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS product_draw_entries_product_status_idx ON product_draw_entries (product_id, status);
CREATE INDEX IF NOT EXISTS product_draw_entries_buyer_idx ON product_draw_entries (buyer_id, created_at);

CREATE TABLE IF NOT EXISTS product_draw_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- created | updated | entry | withdrawn | closed | winner | charge_failed | lost | drawn | cancelled
  kind text NOT NULL,
  entry_id uuid,
  actor text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_draw_events_product_idx ON product_draw_events (product_id, created_at);

-- Off until Dev turns it on in admin (money flow; review before enabling).
INSERT INTO feature_flags (key, enabled, description)
VALUES ('productDraws', false, 'Draw mode for limited drops (authorise on entry, charge winners only)')
ON CONFLICT (key) DO NOTHING;
