import React, { createContext, useContext, useCallback } from 'react';
import { useRouter, Href } from 'expo-router';

type ThreadPullContextType = {
  push: (href: Href) => void;
  replace: (href: Href) => void;
  back: () => void;
};

const ThreadPullContext = createContext<ThreadPullContextType | null>(null);

export function useThreadPull() {
  const ctx = useContext(ThreadPullContext);
  const router = useRouter();
  return ctx ?? {
    push: (href: Href) => router.push(href),
    replace: (href: Href) => router.replace(href),
    back: () => router.back(),
  };
}

export function ThreadPullProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const push = useCallback((href: Href) => {
    router.push(href);
  }, [router]);

  const replace = useCallback((href: Href) => {
    router.replace(href);
  }, [router]);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(buyer)/' as any);
  }, [router]);

  return (
    <ThreadPullContext.Provider value={{ push, replace, back }}>
      {children}
    </ThreadPullContext.Provider>
  );
}
