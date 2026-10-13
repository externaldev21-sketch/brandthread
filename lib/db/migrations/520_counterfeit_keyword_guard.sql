-- Counterfeit keyword guard (feature 69): listings that name a protected brand
-- or a counterfeit term ("replica", "1:1", …) can't go live unless the seller
-- is verified. Ships ON; turning the flag off lifts the guard.
INSERT INTO feature_flags (key, enabled, description)
VALUES ('counterfeitKeywordGuard', true, 'Block publishing listings with counterfeit terms or protected brand names unless the seller is verified')
ON CONFLICT (key) DO NOTHING;
