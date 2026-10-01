-- 112: Tighter one-line copy for the six official communities, so the description fits its card
-- on a 393px screen without wrapping or an orphaned last word. Idempotent; official rows only.
UPDATE communities SET description = 'Logos, type, layouts and print-ready files.'  WHERE slug = 'graphic-design'          AND kind = 'official';
UPDATE communities SET description = 'Product shots, lookbooks, reels and content.'  WHERE slug = 'photography-content'     AND kind = 'official';
UPDATE communities SET description = 'What''s converting, what''s not, and why.'     WHERE slug = 'ads-marketing'           AND kind = 'official';
UPDATE communities SET description = 'Concepts, moodboards and memorable brands.'    WHERE slug = 'creative-direction'      AND kind = 'official';
UPDATE communities SET description = 'Drops, pricing and growing a label.'           WHERE slug = 'streetwear-founders'     AND kind = 'official';
UPDATE communities SET description = 'Factories, fabrics, samples and production.'   WHERE slug = 'sourcing-manufacturing'  AND kind = 'official';
