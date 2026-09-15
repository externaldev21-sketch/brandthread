/** Neutral fallback for tests and unsupported platforms. */
export async function cacheDesignCloudImage(
  _projectId: string,
  _objectPath: string,
  downloadUrl: string,
): Promise<string> {
  return downloadUrl;
}