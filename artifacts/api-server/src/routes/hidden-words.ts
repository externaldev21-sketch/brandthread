/**
 * Hidden Words (feature 71), mounted at /api/safety/hidden-words. Signed in.
 *
 * GET  /  → { hideCustom, words }
 * PUT  /  { hideCustom?, words? } → the saved settings
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { MAX_MUTED_WORDS, MAX_MUTED_WORD_LENGTH } from "../lib/contentModerator";
import { loadHiddenWords, parseWordList, saveHiddenWords } from "../lib/hiddenWords";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    res.json(await loadHiddenWords(userId));
  } catch (err) {
    req.log?.error({ err, userId }, "Hidden words load failed");
    res.status(500).json({ error: "We couldn't load your hidden words. Try again." });
  }
});

router.put("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { hideCustom, words } = (req.body ?? {}) as { hideCustom?: unknown; words?: unknown };
  if (hideCustom !== undefined && typeof hideCustom !== "boolean") {
    res.status(400).json({ error: "hideCustom must be true or false" }); return;
  }
  const parsed = words === undefined ? undefined : parseWordList(words);
  if (parsed === null) {
    res.status(400).json({ error: `Add up to ${MAX_MUTED_WORDS} words or phrases, each up to ${MAX_MUTED_WORD_LENGTH} characters.` });
    return;
  }
  try {
    const current = await loadHiddenWords(userId);
    res.json(await saveHiddenWords(userId, {
      hideCustom: hideCustom ?? current.hideCustom,
      words: parsed ?? current.words,
    }));
  } catch (err) {
    req.log?.error({ err, userId }, "Hidden words save failed");
    res.status(500).json({ error: "We couldn't save your hidden words. Try again." });
  }
});

export default router;
