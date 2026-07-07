import { useAuth } from '@clerk/expo';
import { useMemo } from 'react';
import { createApi } from '@/lib/api';

/**
 * Returns a fully-typed API client bound to the current Clerk session token.
 * Re-creates the client only when the auth state changes.
 */
export function useApi() {
  const { getToken } = useAuth();
  return useMemo(() => createApi(() => getToken()), [getToken]);
}
