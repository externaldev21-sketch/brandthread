import { Image } from 'react-native';
import { MAX_VIDEO_SECONDS } from '@/constants/postLimits';
import { DEFAULT_SLIDE_CROP } from '@/lib/createPost/crop';
import { NO_ADJUST } from '@/lib/createPost/adjust';
import type { PickedAsset, SlideDraft } from '@/lib/createPost/types';

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve({ width: 1080, height: 1440 }));
  });
}

let counter = 0;

/** A library/camera asset → an editable slide (own crop, own look, own trim). */
export async function assetToSlide(asset: PickedAsset): Promise<SlideDraft> {
  const known = asset.width && asset.height ? { width: asset.width, height: asset.height } : null;
  const size = known ?? (asset.kind === 'photo' ? await imageSize(asset.uri) : { width: 1080, height: 1920 });
  const duration = asset.kind === 'video' ? Math.min(Math.max(0.1, asset.duration), MAX_VIDEO_SECONDS) : 0;
  counter += 1;
  return {
    id: `${asset.id}-${counter}`,
    kind: asset.kind,
    uri: asset.uri,
    mimeType: asset.mimeType,
    width: size.width,
    height: size.height,
    crop: DEFAULT_SLIDE_CROP,
    adjust: NO_ADJUST,
    duration,
    trimStart: 0,
    trimEnd: duration,
  };
}
