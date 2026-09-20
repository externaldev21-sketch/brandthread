import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type UserRole = 'buyer' | 'seller' | null;

export const ROLE_KEY = 'user_role';

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
  const value = new URLSearchParams(window.location.search).get('bt_preview');
  return value === 'seller' ? 'seller' : 'buyer';
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const previewRole = getDevPreviewRole();
  const [role, setRoleState] = useState<UserRole>(previewRole);
  const [isLoaded, setIsLoaded] = useState(previewRole !== null);

  useEffect(() => {
    if (previewRole) {
      setRoleState(previewRole);
      setIsLoaded(true);
      void AsyncStorage.setItem(ROLE_KEY, previewRole);
      return;
    }
    AsyncStorage.getItem(ROLE_KEY).then((val) => {
      if (val === 'buyer' || val === 'seller') {
        setRoleState(val);
      }
      setIsLoaded(true);
    });
  }, [previewRole]);

  async function setRole(r: UserRole) {
    setRoleState(r);
    if (r) await AsyncStorage.setItem(ROLE_KEY, r);
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
