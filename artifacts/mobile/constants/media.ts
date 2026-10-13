/**
 * Product photo frame (Dev's less-AI pass, item 46).
 *
 * Every product photo in the app is shown — and cropped at upload — at 4:5
 * (width : height), the portrait frame fashion apps use for product shots.
 * Width-first helpers so a fixed-width slot can size itself:
 *   height = productPhotoHeight(width)
 */
export const PRODUCT_PHOTO_ASPECT = 4 / 5;

export function productPhotoHeight(width: number): number {
  return Math.round(width / PRODUCT_PHOTO_ASPECT);
}
