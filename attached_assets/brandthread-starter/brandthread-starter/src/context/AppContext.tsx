import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useMemo, useState } from 'react';
import { AccountType, UserProfile } from '../types';

type AppContextValue = {
  profile: UserProfile | null;
  onboardingComplete: boolean;
  accountType: AccountType | null;
  setAccountType: (type: AccountType) => void;
  completeOnboarding: (profile: UserProfile) => Promise<void>;
  signOut: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accountType, setAccountTypeState] = useState<AccountType | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  const setAccountType = (type: AccountType) => setAccountTypeState(type);

  const completeOnboarding = async (nextProfile: UserProfile) => {
    setProfile(nextProfile);
    setAccountTypeState(nextProfile.accountType);
    setOnboardingComplete(true);
    await AsyncStorage.setItem('brandthread_profile', JSON.stringify(nextProfile));
  };

  const signOut = async () => {
    await AsyncStorage.removeItem('brandthread_profile');
    setProfile(null);
    setAccountTypeState(null);
    setOnboardingComplete(false);
  };

  const value = useMemo(
    () => ({ profile, onboardingComplete, accountType, setAccountType, completeOnboarding, signOut }),
    [profile, onboardingComplete, accountType]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}
