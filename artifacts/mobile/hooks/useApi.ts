/**
 * Returns a fully-typed API client bound to the current Clerk session token.
 * Keep this compatibility path pointed at the canonical stable hook so screens
 * cannot accidentally recreate their API client on Clerk getToken identity changes.
 */
export { useApi } from '@/lib/api';
