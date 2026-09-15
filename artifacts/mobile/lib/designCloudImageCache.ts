/** Neutral fallback for tests and unsupported platforms. */
export async function cacheDesignCloudImage(
  _projectId: string,
  _objectPath: string,
  downloadUrl: string,
): Promise<string> {
  return downloadUrl;
}

/** Neutral/test fallback. Native replaces this with an app-owned document copy. */
export async function retainDesignUploadAsset(uri: string, _queueId: string, _format: 'png' | 'jpeg'): Promise<string> {
  return uri;
}

export async function removeRetainedDesignUploadAsset(_uri: string): Promise<void> {}

export async function readRetainedDesignUploadAsset(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read the verified Design Studio asset.');
  return response.arrayBuffer();
}