import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const DEBOUNCE_MS = 450;

/**
 * Live @username availability check for the onboarding auth step, called
 * before a Clerk account exists (hits the unauthenticated
 * /api/public/username-check endpoint — the authenticated variant needs a
 * signed-in session this step doesn't have yet). Debounced so it doesn't
 * fire on every keystroke, and never overrides a local format error.
 */
export function useUsernameLiveCheck(username: string): {
  error: string;
  checking: boolean;
} {
  const api = useApi();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = username.trim();
    if (trimmed.length === 0) { setError(''); setChecking(false); return; }
    if (!USERNAME_REGEX.test(trimmed)) {
      // Local format validation (length, allowed characters) owns this case;
      // don't hit the network for something already known to be invalid.
      setError('');
      setChecking(false);
      return;
    }

    const id = ++requestId.current;
    setChecking(true);
    const timer = setTimeout(() => {
      api.auth.checkUsernamePublic(trimmed)
        .then((result) => {
          if (id !== requestId.current) return; // stale response
          setError(result.available ? '' : (result.error ?? 'Username is already taken.'));
        })
        .catch(() => {
          if (id !== requestId.current) return;
          // Fail open — don't block typing on a transient network error.
          setError('');
        })
        .finally(() => {
          if (id === requestId.current) setChecking(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [username, api]);

  return { error, checking };
}
