import { File, Paths } from 'expo-file-system';

export async function cacheDesignCloudImage(
  projectId: string,
  objectPath: string,
  downloadUrl: string,
): Promise<string> {
  const fileName = `design_${encodeURIComponent(projectId)}_${encodeURIComponent(objectPath)}.img`;
  const file = new File(Paths.document, fileName);
  if (!file.exists) {
    const response = await fetch(downloadUrl);
    if (!response.ok) return downloadUrl;
    file.write(new Uint8Array(await response.arrayBuffer()));
  }
  return file.uri;
}