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

export async function retainDesignUploadAsset(
  uri: string,
  queueId: string,
  format: 'png' | 'jpeg',
): Promise<string> {
  const destination = new File(
    Paths.document,
    `design_upload_${encodeURIComponent(queueId)}.${format === 'jpeg' ? 'jpg' : 'png'}`,
  );
  if (!destination.exists) {
    const source = new File(uri);
    await source.copy(destination);
  }
  return destination.uri;
}

export async function removeRetainedDesignUploadAsset(uri: string): Promise<void> {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function readRetainedDesignUploadAsset(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read the verified Design Studio asset.');
  return response.arrayBuffer();
}