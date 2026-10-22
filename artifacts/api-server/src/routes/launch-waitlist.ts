import { Router } from 'express';
import { JoinLaunchWaitlistBody } from '@workspace/api-zod';
import { db, launchWaitlistSignups } from '@workspace/db';
import { rateLimit } from '../middlewares/rateLimit';

const router = Router();
const bodySchema = JoinLaunchWaitlistBody.strict();

/** Public, email-only launch notifications. Never reveals existing membership. */
router.post('/', rateLimit('launch-waitlist'), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? { ...req.body, email: typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email }
    : req.body;
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid email address.', code: 'INVALID_WAITLIST_EMAIL' });
    return;
  }
  try {
    await db.insert(launchWaitlistSignups).values(parsed.data).onConflictDoNothing();
    res.json({ ok: true, message: "You're on the list." });
  } catch {
    // Don't log the body/email: waitlist consent is personal data.
    res.status(503).json({ error: 'Unable to join right now. Please try again.', code: 'WAITLIST_UNAVAILABLE' });
  }
});

export default router;
