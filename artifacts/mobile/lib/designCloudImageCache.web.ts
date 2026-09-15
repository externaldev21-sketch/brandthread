export async function cacheDesignCloudImage(
  _projectId: string,
  _objectPath: string,
  downloadUrl: string,
): Promise<string> {
  return downloadUrl;
}

const UPLOAD_DB = 'brandthread-design-uploads';
const UPLOAD_STORE = 'verified-masters';
const UPLOAD_URI_PREFIX = 'bt-design-upload:';

function openUploadDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(UPLOAD_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(UPLOAD_STORE)) {
        request.result.createObjectStore(UPLOAD_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open Design Studio upload storage.'));
  });
}

function uploadStoreRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openUploadDb().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(UPLOAD_STORE, mode);
    const request = run(transaction.objectStore(UPLOAD_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Design Studio upload storage failed.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('Design Studio upload storage failed.'));
    };
  }));
}

export async function retainDesignUploadAsset(uri: string, queueId: string, _format: 'png' | 'jpeg'): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not retain the verified Design Studio asset.');
  const blob = await response.blob();
  await uploadStoreRequest('readwrite', store => store.put(blob, queueId));
  return `${UPLOAD_URI_PREFIX}${queueId}`;
}

export async function removeRetainedDesignUploadAsset(uri: string): Promise<void> {
  if (!uri.startsWith(UPLOAD_URI_PREFIX)) return;
  await uploadStoreRequest('readwrite', store => store.delete(uri.slice(UPLOAD_URI_PREFIX.length)));
}

export async function readRetainedDesignUploadAsset(uri: string): Promise<ArrayBuffer> {
  if (!uri.startsWith(UPLOAD_URI_PREFIX)) {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read the verified Design Studio asset.');
    return response.arrayBuffer();
  }
  const blob = await uploadStoreRequest('readonly', store => store.get(uri.slice(UPLOAD_URI_PREFIX.length)));
  if (!(blob instanceof Blob)) throw new Error('Queued Design Studio upload bytes are unavailable.');
  return blob.arrayBuffer();
}