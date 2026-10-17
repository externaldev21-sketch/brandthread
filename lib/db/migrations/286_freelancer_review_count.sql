-- 286: Real freelancer ratings. freelancer_reviews (021) existed but nothing
-- wrote to it, and freelancers.avg_rating_tenths was never recomputed, so
-- every freelancer read as "unrated" and sort-by-rating did nothing.
-- Adds a review count and backfills both values from reviews of completed jobs.
-- Additive only.
ALTER TABLE freelancers ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;

UPDATE freelancers f
SET avg_rating_tenths = agg.avg_tenths,
    review_count      = agg.cnt
FROM (
  SELECT r.freelancer_id,
         ROUND(AVG(r.rating_tenths))::int AS avg_tenths,
         COUNT(*)::int                    AS cnt
  FROM freelancer_reviews r
  JOIN freelancer_jobs j ON j.id = r.job_id AND j.status = 'completed'
  GROUP BY r.freelancer_id
) agg
WHERE agg.freelancer_id = f.id;
