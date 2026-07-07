import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type UserRole = 'buyer' | 'seller' | 'both' | null;

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

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<UserRole>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ROLE_KEY).then((val) => {
      if (val === 'buyer' || val === 'seller' || val === 'both') {
        setRoleState(val);
      }
      setIsLoaded(true);
    });
  }, []);

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
