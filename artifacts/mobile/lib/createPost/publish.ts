/**
 * Runs the real publish pipeline for the create flow:
 *   slides: crop each photo (from its original) → upload → compose at the chosen ratio
 *   video : chunked/resumable upload → compose (trim/speed) → cover frame
 * then creates (or updates) the post. Progress is a single 0–1 number tied to
 * actual bytes/requests, not a timer. Nothing here touches React state, so the
 * same function backs both "Post" and "Drafts".
 */
import { applyCropRect } from '@/lib/mediaCrop';
import { ASPECT_RATIO_VALUE, SURFACE_BY_MODE } from '@/constants/postLimits';
import { slideCropToRect } from '@/lib/createPost/crop';
import { extractHashtags } from '@/lib/createPost/caption';
import type { PublishInput } from '@/lib/createPost/types';
import { createSellerPost, updateSellerPost, type SellerThreadPost } from '@/services/socialService';
import type { useApi } from '@/lib/api';

type Api = ReturnType<typeof useApi>;

export interface PublishOptions {
  api: Api;
  input: PublishInput;
  editId?: string;
  onProgress: (fraction: number, phase: 'uploading' | 'processing' | 'saving') => void;
  signal?: { aborted: boolean };
}

const UPLOAD_SHARE = 0.78;
const COMPOSE_END = 0.92;

export async function publishCreatePost({ api, input, editId, onProgress, signal }: PublishOptions): Promise<SellerThreadPost> {
  const { media, details, mode, isDraft } = input;
  const surface = SURFACE_BY_MODE[mode];

  let mediaUrls: string[] = [];
  let mediaPaths: string[] = [];
  let mediaUrl: string | undefined;
  let mediaPath: string | undefined;
  let thumbnailUri: string | undefined;
  let thumbnailPath: string | undefined;
  let aspectRatio: '9:16' | '3:4' | '1:1' = '9:16';
  let contentType: 'video' | 'slideshow' = 'video';

  let slidesPayload: Array<{ kind: 'photo' | 'video'; path: string; thumbnailPath: string; duration?: number }> | undefined;

  if (media.kind === 'slides' && mode === 'post') {
    // POST carousel: photos and videos, fixed 3:4, per-slide crop + look.
    contentType = 'slideshow';
    aspectRatio = '3:4';
    const ratio = ASPECT_RATIO_VALUE['3:4'];
    const count = media.slides.length;
    const items: Array<Parameters<Api['posts']['composeCarousel']>[0]['items'][number]> = [];
    for (let i = 0; i < count; i += 1) {
      if (signal?.aborted) throw new Error('Upload cancelled');
      const slide = media.slides[i];
      const rect = slideCropToRect(slide.crop, slide.width, slide.height, ratio);
      const base = (i / count) * UPLOAD_SHARE;
      const span = UPLOAD_SHARE / count;
      if (slide.kind === 'photo') {
        const croppedUri = await applyCropRect(slide.uri, rect);
        const up = await api.posts.uploadPhotoSlide(croppedUri, croppedUri === slide.uri ? slide.mimeType : 'image/jpeg');
        // Photos are cropped on-device (orientation-safe); the server only scales and applies the look.
        items.push({ kind: 'photo', objectPath: up.objectPath, adjust: slide.adjust });
      } else {
        const up = await api.posts.uploadVideoChunked(
          { uri: slide.uri, mimeType: slide.mimeType },
          { signal, onProgress: (f) => onProgress(base + f * span, 'uploading') },
        );
        items.push({
          kind: 'video', objectPath: up.objectPath, adjust: slide.adjust,
          crop: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          trimStart: slide.trimStart, trimEnd: slide.trimEnd,
        });
      }
      onProgress(((i + 1) / count) * UPLOAD_SHARE, 'uploading');
    }
    onProgress(UPLOAD_SHARE, 'processing');
    const composed = await api.posts.composeCarousel({ items });
    slidesPayload = composed.items.map((it) => ({ kind: it.kind, path: it.mediaPath, thumbnailPath: it.thumbnailPath, duration: it.duration }));
    mediaUrls = composed.items.map((it) => it.mediaUrl);
    mediaPaths = composed.items.map((it) => it.mediaPath);
    mediaUrl = composed.items[0].kind === 'video' ? composed.items[0].thumbnailUrl : composed.items[0].mediaUrl;
    thumbnailUri = composed.items[0].thumbnailUrl;
    thumbnailPath = composed.items[0].thumbnailPath;
    if (count === 1 && composed.items[0].kind === 'video') contentType = 'video';
  } else if (media.kind === 'slides') {
    contentType = 'slideshow';
    aspectRatio = media.aspect;
    const ratio = ASPECT_RATIO_VALUE[media.aspect];
    const uploaded: string[] = [];
    for (let i = 0; i < media.slides.length; i += 1) {
      if (signal?.aborted) throw new Error('Upload cancelled');
      const slide = media.slides[i];
      const rect = slideCropToRect(slide.crop, slide.width, slide.height, ratio);
      const croppedUri = await applyCropRect(slide.uri, rect);
      const result = await api.posts.uploadPhotoSlide(croppedUri, croppedUri === slide.uri ? slide.mimeType : 'image/jpeg');
      uploaded.push(result.objectPath);
      onProgress(((i + 1) / media.slides.length) * UPLOAD_SHARE, 'uploading');
    }
    onProgress(UPLOAD_SHARE, 'processing');
    const composed = await api.posts.composeSlideshow({
      slides: uploaded.map((objectPath) => ({ objectPath })),
      aspectRatio: media.aspect,
      surface,
      coverIndex: media.coverIndex,
    });
    mediaUrls = composed.mediaUrls;
    mediaPaths = composed.mediaPaths;
    mediaUrl = composed.mediaUrls[0];
    thumbnailUri = composed.thumbnailUrl;
    thumbnailPath = composed.thumbnailPath;
  } else {
    const { video } = media;
    // A remix's source clip was already copied into this account's storage.
    const uploadedClip = video.objectPath
      ? { objectPath: video.objectPath }
      : await api.posts.uploadVideoChunked(
        { uri: video.uri, mimeType: video.mimeType },
        { signal, onProgress: (f) => onProgress(f * UPLOAD_SHARE, 'uploading') },
      );
    onProgress(UPLOAD_SHARE, 'processing');
    const composed = await api.posts.composeVideo({
      clips: [{ objectPath: uploadedClip.objectPath, duration: video.duration, speed: video.speed, filter: 'none' }],
      trimStart: video.trimStart,
      trimEnd: video.trimEnd,
    });
    mediaUrl = composed.mediaUrl;
    mediaPath = composed.mediaPath;
    mediaUrls = [composed.mediaUrl];
    thumbnailUri = composed.thumbnailUrl;
    thumbnailPath = composed.thumbnailPath;
    if (video.coverOffset > 0.05) {
      try {
        const cover = await api.posts.composeVideoThumbnail(composed.mediaPath, video.coverOffset);
        thumbnailUri = cover.thumbnailUrl;
        thumbnailPath = cover.thumbnailPath;
      } catch { /* keep the default first-frame cover rather than failing the post */ }
    }
  }

  onProgress(COMPOSE_END, 'saving');
  const values = {
    contentType,
    caption: details.caption,
    hashtags: extractHashtags(details.caption),
    mediaUris: mediaUrls,
    mediaUrl,
    mediaPath,
    thumbnailPath,
    thumbnailUri,
    aspectRatio,
    surface,
    mediaPaths,
    slides: slidesPayload,
    productTags: details.productTags.map((t) => ({ productId: t.productId, productName: t.productName, priceCents: t.priceCents })),
    visibility: details.visibility,
    isDraft,
    scheduledAt: isDraft ? null : details.scheduledAt,
    ...(!editId && contentType === 'video' && input.remixOfPostId ? { remixOfPostId: input.remixOfPostId } : {}),
  };
  const post = editId
    ? await updateSellerPost(editId, {
        ...values,
        postStatus: isDraft ? 'draft' : details.scheduledAt ? 'scheduled' : 'published',
      })
    : await createSellerPost(values);
  onProgress(1, 'saving');
  return post;
}
