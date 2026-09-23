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
};

// ─── Types ────────────────────────────────────────────────────────────────────

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

/** Remove account-scoped lifecycle flags after a server-confirmed erasure. */
export async function clearAccountLifecycleState(): Promise<void> {
  await AsyncStorage.multiRemove([
    K.deactivation,
    K.deletion,
    K.dataExport,
    // Legacy on-device session list (replaced by real Clerk sessions).
    'bt:account:sessions:v1',
    '@brandthread/onboarding_complete',
  ]);
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
