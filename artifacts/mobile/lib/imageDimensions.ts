/** Neutral fallback for Node/Vitest; native and web builds resolve suffix files. */
export async function getImageDimensions(_uri: string): Promise<{ width: number; height: number }> {
  throw new Error('Image dimension inspection is unavailable on this platform.');
}