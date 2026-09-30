import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { isSellerDevPreview } from '@/lib/devPreview';

export type UserRole = 'buyer' | 'seller' | null;

// Legacy, pre-multi-account key — still read once as a fallback for a device
// that has this from before per-user keys existed, never written to again.
const LEGACY_ROLE_KEY = 'user_role';
export function roleKeyForUser(userId: string): string {
  return `user_role:${userId}`;
}

interface RoleContextValue {
  role: UserRole;
  setRole: (r: UserRole) => Promise<void>;
  isLoaded: boolean;
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  setRole: async () => {},
  isLoaded: false,
});

function getDevPreviewRole(): UserRole {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return null;
  // isSellerDevPreview() reads ?bt_preview= and, once in-app navigation has dropped the query
  // string, the role the first load persisted. Reading only the URL here flipped the preview
  // seller to a buyer whenever this provider remounted after a tab switch.
  return isSellerDevPreview() ? 'seller' : 'buyer';
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const previewRole = getDevPreviewRole();
  // Clerk isn't mounted at all in some contexts (e.g. this preview branch),
  // so useAuth() is only meaningful when there's no forced preview role.
  const { userId, isLoaded: authLoaded } = useAuth();
  const [role, setRoleState] = useState<UserRole>(previewRole);
  const [isLoaded, setIsLoaded] = useState(previewRole !== null);
  // Tracks whose role is currently loaded, so a switch to a different
  // account (userId changes) re-reads that account's own role instead of
  // instantly reusing whatever the previous account had in state.
  const loadedForUserId = React.useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (previewRole) {
      setRoleState(previewRole);
      setIsLoaded(true);
      void AsyncStorage.setItem(roleKeyForUser('preview'), previewRole);
      return;
    }
    if (!authLoaded) return;
    if (!userId) {
      // Signed out: nothing to load, no role to show.
      loadedForUserId.current = null;
      setRoleState(null);
      setIsLoaded(true);
      return;
    }
    if (loadedForUserId.current === userId) return;
    setIsLoaded(false);
    (async () => {
      const scopedKey = roleKeyForUser(userId);
      let val = await AsyncStorage.getItem(scopedKey);
      if (val !== 'buyer' && val !== 'seller') {
        // One-time migration: a device that set its role before per-user
        // keys existed. Only ever consumed, never written again below.
        const legacy = await AsyncStorage.getItem(LEGACY_ROLE_KEY);
        if (legacy === 'buyer' || legacy === 'seller') {
          val = legacy;
          await AsyncStorage.setItem(scopedKey, legacy);
        }
      }
      loadedForUserId.current = userId;
      setRoleState(val === 'buyer' || val === 'seller' ? val : null);
      setIsLoaded(true);
    })();
  }, [previewRole, userId, authLoaded]);

  async function setRole(r: UserRole) {
    setRoleState(r);
    if (!r) return;
    const key = previewRole ? roleKeyForUser('preview') : userId ? roleKeyForUser(userId) : null;
    if (key) await AsyncStorage.setItem(key, r);
  }

  return (
    <RoleContext.Provider value={{ role, setRole, isLoaded }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
