/** Unauthenticated Node boundary; session-specific suites supply their own mocks. */
import React from 'react';
const getToken = async () => null;
const signOut = async () => {};
export const useAuth = () => ({ isLoaded: true, isSignedIn: false, userId: null, sessionId: null, getToken, signOut });
export const useUser = () => ({ isLoaded: true, isSignedIn: false, user: null });
export const useClerk = () => ({ signOut, client: { sessions: [] } });
export const useSession = () => ({ isLoaded: true, session: null });
export const useSessionList = () => ({ isLoaded: true, sessions: [], setActive: async () => {} });
export const ClerkProvider = ({ children }: { children: React.ReactNode }) => children;
