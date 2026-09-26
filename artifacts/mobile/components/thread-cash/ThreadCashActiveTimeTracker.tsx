/**
 * Daily Thread Cash reward, earned by active time rather than a button tap.
 * While a signed-in buyer has the app in the foreground, this headless
 * component accumulates seconds (persisted per buyer-local calendar day, so
 * relaunching the app continues the same day's count). It pings the server
 * roughly once a minute (a heartbeat — the abuse guard the server checks
 * before paying out) and, once the day's cumulative active time reaches 7
 * minutes, calls the claim endpoint once. A successful claim plays the
 * money-burst celebration; there is no countdown or any other UI — the
 * timer is entirely silent.
 *
 * Paused whenever the app is backgrounded (native) or the tab is hidden
 * (web) — `AppState` covers both via react-native-web.
 */
import React, { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { randomUUID } from 'expo-crypto';
import { useApi } from '@/lib/api';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { useCelebrateThreadCash } from './CelebrationHost';

export const THREAD_CASH_ACTIVE_SECONDS_GOAL = 420; // 7 minutes
const HEARTBEAT_INTERVAL_SECONDS = 60;
const TICK_MS = 1000;
const PERSIST_EVERY_TICKS = 5;

const STATE_KEY_PREFIX = 'bt:thread-cash:active-time:v1';
const DEVICE_ID_KEY = 'bt:thread-cash:device-id:v1';

type PersistedDayState = {
  localDate: string;
  activeSeconds: number;
  lastHeartbeatSeconds: number;
  claimed: boolean;
};

function localDateString(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function ThreadCashActiveTimeTracker() {
  const { userId } = useAuth();
  const api = useApi();
  const threadCashEnabled = useFeatureFlag('threadCash');
  const celebrateThreadCash = useCelebrateThreadCash();

  const dayStateRef = useRef<PersistedDayState | null>(null);
  const tickCountRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const claimingRef = useRef(false);

  useEffect(() => {
    if (!threadCashEnabled || !userId) return;
    let active = true;
    const storageKey = `${STATE_KEY_PREFIX}:${userId}`;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    async function loadDayState(): Promise<PersistedDayState> {
      const today = localDateString(new Date(), timezone);
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as PersistedDayState;
          if (parsed.localDate === today) return parsed;
        }
      } catch {
        // Corrupt/missing persisted state — start fresh for today.
      }
      return { localDate: today, activeSeconds: 0, lastHeartbeatSeconds: 0, claimed: false };
    }

    async function persist(state: PersistedDayState) {
      try { await AsyncStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* best-effort */ }
    }

    async function sendHeartbeatIfDue(state: PersistedDayState) {
      if (state.activeSeconds - state.lastHeartbeatSeconds < HEARTBEAT_INTERVAL_SECONDS) return;
      state.lastHeartbeatSeconds = state.activeSeconds;
      try {
        await api.threadCash.dailyHeartbeat({ timezone, activeSeconds: state.activeSeconds });
      } catch {
        // Offline/transient — the next tick will retry once the threshold is crossed again.
      }
    }

    async function tryClaim(state: PersistedDayState) {
      if (state.claimed || claimingRef.current || state.activeSeconds < THREAD_CASH_ACTIVE_SECONDS_GOAL) return;
      claimingRef.current = true;
      try {
        const deviceId = await getOrCreateDeviceId();
        const result = await api.threadCash.dailyClaim({ timezone, deviceId, activeSeconds: state.activeSeconds });
        state.claimed = true;
        await persist(state);
        const totalEarned = result.earnedCents + result.streakBonusCents;
        if (totalEarned > 0 && active) {
          celebrateThreadCash({ amount: totalEarned, from: 'Daily reward' });
        }
      } catch (error: any) {
        // Already claimed today (409) — treat as claimed so we stop trying.
        // Not enough heartbeats yet, or offline — leave claimed=false and
        // retry on a later tick once more heartbeats have landed.
        if (error?.code === 'THREAD_CASH_ALREADY_CHECKED_IN') {
          state.claimed = true;
          await persist(state);
        }
      } finally {
        claimingRef.current = false;
      }
    }

    function stopInterval() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function startInterval() {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(() => {
        void (async () => {
          if (!active) return;
          const today = localDateString(new Date(), timezone);
          let state = dayStateRef.current;
          if (!state || state.localDate !== today) {
            state = await loadDayState();
          }
          if (!state.claimed) {
            state.activeSeconds += TICK_MS / 1000;
          }
          dayStateRef.current = state;
          tickCountRef.current += 1;

          if (tickCountRef.current % PERSIST_EVERY_TICKS === 0) {
            await persist(state);
          }
          await sendHeartbeatIfDue(state);
          await tryClaim(state);
        })();
      }, TICK_MS);
    }

    void (async () => {
      dayStateRef.current = await loadDayState();
      if (!active) return;
      if (AppState.currentState === 'active') startInterval();
    })();

    const onChange = (status: AppStateStatus) => {
      if (status === 'active') {
        startInterval();
      } else {
        stopInterval();
        if (dayStateRef.current) void persist(dayStateRef.current);
      }
    };
    const subscription = AppState.addEventListener('change', onChange);

    return () => {
      active = false;
      stopInterval();
      subscription.remove();
      if (dayStateRef.current) void persist(dayStateRef.current);
    };
  }, [api, celebrateThreadCash, threadCashEnabled, userId]);

  return null;
}
