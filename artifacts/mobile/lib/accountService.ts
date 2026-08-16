/**
 * accountService — local AsyncStorage persistence for account lifecycle actions.
 *
 * These operations store state on-device. Server-side enforcement (profile hiding,
 * data purge, session revocation on other devices) requires a backend endpoint
 * that is not yet implemented. Each function clearly documents what IS and IS NOT
 * persisted server-side so the UI can be honest with the user.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const K = {
  deactivation: 'bt:account:deactivation:v1',
  deletion:     'bt:account:deletion:v1',
  dataExport:   'bt:account:data-export:v1',
  sessions:     'bt:account:sessions:v1',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccountSession {
  id: string;
  device: string;
  os: string;
  location: string;
  lastActive: string;
  current: boolean;
  icon: 'smartphone' | 'monitor' | 'globe' | 'tablet';
}

export interface DeactivationRecord {
  active: boolean;
  deactivatedAt: string;
}

export interface DeletionRequest {
  requested: boolean;
  requestedAt: string;
  /** Contact support@brandthread.com to complete server-side deletion. */
  serverProcessed: false;
}

export interface DataExportRequest {
  requested: boolean;
  requestedAt: string;
  categories: string[];
  /** Server-side export is not yet implemented. */
  serverProcessed: false;
}

// ─── Seed / Default data ─────────────────────────────────────────────────────

const SEED_SESSIONS: AccountSession[] = [
  { id: 'current', device: 'iPhone (this device)', os: 'iOS 18', location: 'New York, US', lastActive: 'Active now', current: true, icon: 'smartphone' },
  { id: 's2', device: 'MacBook Pro', os: 'macOS Sequoia', location: 'New York, US', lastActive: '2 hours ago', current: false, icon: 'monitor' },
  { id: 's3', device: 'Chrome · Windows', os: 'Windows 11', location: 'Los Angeles, US', lastActive: '5 days ago', current: false, icon: 'globe' },
];

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function getSessions(): Promise<AccountSession[]> {
  try {
    const raw = await AsyncStorage.getItem(K.sessions);
    if (!raw) {
      await AsyncStorage.setItem(K.sessions, JSON.stringify(SEED_SESSIONS));
      return [...SEED_SESSIONS];
    }
    return JSON.parse(raw) as AccountSession[];
  } catch { return [...SEED_SESSIONS]; }
}

export async function removeSession(sessionId: string): Promise<AccountSession[]> {
  const sessions = await getSessions();
  const next = sessions.filter(s => s.id !== sessionId || s.current);
  await AsyncStorage.setItem(K.sessions, JSON.stringify(next));
  return next;
}

export async function removeAllOtherSessions(): Promise<AccountSession[]> {
  const sessions = await getSessions();
  const next = sessions.filter(s => s.current);
  await AsyncStorage.setItem(K.sessions, JSON.stringify(next));
  return next;
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

/**
 * Records a local deactivation. The account appears deactivated on this device
 * until the user signs back in. No server-side profile visibility change occurs
 * until a backend endpoint is implemented.
 */
export async function requestDeactivation(): Promise<void> {
  await AsyncStorage.setItem(K.deactivation, JSON.stringify({
    active: true,
    deactivatedAt: new Date().toISOString(),
  } satisfies DeactivationRecord));
}

export async function reactivate(): Promise<void> {
  await AsyncStorage.removeItem(K.deactivation);
}

export async function getDeactivationStatus(): Promise<DeactivationRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(K.deactivation);
    return raw ? (JSON.parse(raw) as DeactivationRecord) : null;
  } catch { return null; }
}

// ─── Deletion ─────────────────────────────────────────────────────────────────

/**
 * Records a deletion request locally. Contact support@brandthread.com to process
 * server-side deletion. No server action occurs automatically.
 */
export async function requestDeletion(): Promise<void> {
  await AsyncStorage.setItem(K.deletion, JSON.stringify({
    requested: true,
    requestedAt: new Date().toISOString(),
    serverProcessed: false,
  } satisfies DeletionRequest));
}

export async function getDeletionStatus(): Promise<DeletionRequest | null> {
  try {
    const raw = await AsyncStorage.getItem(K.deletion);
    return raw ? (JSON.parse(raw) as DeletionRequest) : null;
  } catch { return null; }
}

// ─── Data Export ──────────────────────────────────────────────────────────────

/**
 * Records a data export request locally. No server-side export occurs until the
 * export endpoint is implemented. Contact support@brandthread.com to request your
 * data in the meantime.
 */
export async function requestDataExport(categories: string[]): Promise<DataExportRequest> {
  const record: DataExportRequest = {
    requested: true,
    requestedAt: new Date().toISOString(),
    categories,
    serverProcessed: false,
  };
  await AsyncStorage.setItem(K.dataExport, JSON.stringify(record));
  return record;
}

export async function getDataExportStatus(): Promise<DataExportRequest | null> {
  try {
    const raw = await AsyncStorage.getItem(K.dataExport);
    return raw ? (JSON.parse(raw) as DataExportRequest) : null;
  } catch { return null; }
}
