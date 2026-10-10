// ─── Create flow — TikTok's post-creation flow, in our palette ────────────────
//   capture (camera)  →  gallery (picker)  →  edit (crop slides / trim video)
//   →  post (caption, cover, products, visibility, Drafts / Post)
// The destination (THREAD / POST; STORY and LIVE hand off to their own flows)
// is chosen on the capture screen's mode bar and carried through every step.
// Sellers: STORY · THREAD · POST · LIVE. Buyers: STORY · POST — buyers can
// never post to Threads (the server rejects it too).
// Caps, modes and defaults live in constants/postLimits.ts. Every in-flow header is the
// shared ScreenHeader (via components/create-post/ui.tsx CreateHeader) — no divider, no subtitle.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Platform, StatusBar, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { useRole } from '@/contexts/RoleContext';
import { isSellerSetupOrigin, leaveSetupFlow } from '@/lib/setupNavigation';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';
import { getSellerPosts, updateSellerPost, type SellerThreadPost } from '@/services/socialService';
import {
  CREATE_MODES_BY_ROLE, DEFAULT_CREATE_MODE, DEFAULT_SLIDE_ASPECT, MAX_SLIDES_BY_MODE, MAX_VIDEO_SECONDS, MODE_LABEL,
  type CreateMode, type PostAspect, type PostMode,
} from '@/constants/postLimits';
import { assetToSlide } from '@/lib/createPost/slides';
import { extractHashtags } from '@/lib/createPost/caption';
import { publishCreatePost } from '@/lib/createPost/publish';
import type { MediaDraft, PickedAsset, PostDetails, SlideDraft } from '@/lib/createPost/types';
import { CP } from '@/components/create-post/ui';
import { CreateCamera } from '@/components/create-post/CreateCamera';
import { GalleryPicker } from '@/components/create-post/GalleryPicker';
import { SlideEditor } from '@/components/create-post/SlideEditor';
import { PostPicker } from '@/components/create-post/PostPicker';
import { CarouselEditor } from '@/components/create-post/CarouselEditor';
import { VideoEditor } from '@/components/create-post/VideoEditor';
import { PostScreen, type PublishState } from '@/components/create-post/PostScreen';
import { remixClipToVideoDraft, remixErrorMessage } from '@/lib/remix';

type Step = 'capture' | 'gallery' | 'edit' | 'post';

const DEFAULT_DETAILS: PostDetails = {
  caption: '',
  productTags: [],
  visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
  scheduledAt: null,
};

function confirmDiscard(onDiscard: () => void) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm('Discard this post? Your edits will be lost.')) onDiscard();
    return;
  }
  Alert.alert('Discard this post?', 'Your edits will be lost.', [
    { text: 'Keep editing', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: onDiscard },
  ]);
}

function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
    if (typeof parsed?.error === 'string') return parsed.error;
  } catch { /* not JSON */ }
  return 'Check your connection and try again — nothing was lost.';
}

export default function CreatePostScreen() {
  const router = useRouter();
  const api = useApi();
  const { role, isLoaded: roleLoaded } = useRole();
  const params = useLocalSearchParams<{ accountType?: string; editId?: string; from?: string; mode?: string; capture?: string; remixOf?: string }>();
  const isSeller = role === 'seller' && params.accountType !== 'buyer';
  const roleKey = isSeller ? 'seller' : 'buyer';
  const modes = CREATE_MODES_BY_ROLE[roleKey];
  const editId = typeof params.editId === 'string' ? params.editId : undefined;
  // `?remixOf=<postId>` (share sheet "Remix"): the source video is preloaded as the clip.
  const remixOf = !editId && typeof params.remixOf === 'string' && params.remixOf ? params.remixOf : undefined;
  const isWeb = Platform.OS === 'web';
  // Camera-first on native and web; a browser without a camera still has
  // the roll shortcut and permission placeholder. Keep a direct-gallery opt-out.
  const noCameraStep = isWeb && params.capture === '0';

  const requested = params.mode === 'schedule' ? 'thread' : (params.mode as CreateMode | undefined);
  const [mode, setMode] = useState<CreateMode>(
    requested && modes.includes(requested) && requested !== 'story' && requested !== 'live' ? requested : DEFAULT_CREATE_MODE[roleKey],
  );
  const postMode: PostMode = mode === 'thread' || mode === 'post' ? mode : DEFAULT_CREATE_MODE[roleKey] === 'thread' ? 'thread' : 'post';

  // The role resolves asynchronously on a cold deep link: re-pick the starting mode once it is known
  // (unless the person already chose one on the bar).
  const modeTouched = useRef(false);
  useEffect(() => {
    if (!roleLoaded || modeTouched.current) return;
    const want = requested && modes.includes(requested) && requested !== 'story' && requested !== 'live' ? requested : DEFAULT_CREATE_MODE[roleKey];
    setMode(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleLoaded, roleKey]);

  const [step, setStep] = useState<Step>(editId ? 'post' : remixOf ? 'edit' : noCameraStep ? 'gallery' : 'capture');
  const [media, setMedia] = useState<MediaDraft | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [details, setDetails] = useState<PostDetails>(DEFAULT_DETAILS);
  const [publishState, setPublishState] = useState<PublishState>({ phase: 'idle' });
  const [editing, setEditing] = useState<SellerThreadPost | null>(null);
  const [pickedForGallery, setPickedForGallery] = useState<PickedAsset[]>([]);
  const abort = useRef({ aborted: false });
  const isSetup = isSellerSetupOrigin(params.from);

  const leave = useCallback(() => {
    leaveSetupFlow(router, params.from);
  }, [params.from, router]);

  // A buyer can never be in a Threads flow, however the route was reached.
  useEffect(() => {
    if (!isSeller && mode === 'thread') setMode('post');
  }, [isSeller, mode]);

  // Editing an existing post: straight to the post screen with its saved details.
  useEffect(() => {
    if (!editId) return;
    let live = true;
    getSellerPosts().then((posts) => {
      if (!live) return;
      const post = posts.find((p) => p.id === editId);
      if (!post) { leave(); return; }
      setEditing(post);
      setMode((post as any).surface === 'profile' ? 'post' : isSeller ? 'thread' : 'post');
      setDetails({
        caption: post.caption,
        productTags: post.productTags.map((t) => ({ productId: t.productId, productName: t.productName, priceCents: t.priceCents })),
        visibility: { isPublic: true, ...post.visibility },
        scheduledAt: post.scheduledAt,
      });
    }).catch(() => { if (live) leave(); });
    return () => { live = false; };
  }, [editId, isSeller, leave]);

  // Remix: the server checks the author's "Allow remixes of videos" setting
  // and copies the source video into a clip this account owns; it opens in
  // the THREAD video editor (video posting is a seller capability).
  useEffect(() => {
    if (!remixOf) return;
    let live = true;
    api.remix.clip(remixOf)
      .then((clip) => {
        if (!live) return;
        modeTouched.current = true;
        setMode('thread');
        setMedia({ kind: 'video', video: remixClipToVideoDraft(clip) });
        setStep('edit');
      })
      .catch((error) => {
        if (!live) return;
        Alert.alert('Remix unavailable', remixErrorMessage(error) ?? "Couldn't load this video. Try again.");
        leave();
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remixOf]);

  // ── Back handling ──────────────────────────────────────────────────────────
  const hasWork = media !== null && step !== 'gallery' && step !== 'capture';
  const back = useCallback(() => {
    if (publishState.phase === 'running') return true;
    if (step === 'post') {
      if (editId) { leave(); return true; }
      setStep('edit'); return true;
    }
    if (step === 'edit') {
      if (postMode === 'post') { setStep('gallery'); return true; }
      if (hasWork) confirmDiscard(() => { setMedia(null); setStep(isWeb ? 'gallery' : 'gallery'); });
      return true;
    }
    if (step === 'gallery') {
      if (noCameraStep) { leave(); return true; }
      setStep('capture'); return true;
    }
    leave();
    return true;
  }, [editId, hasWork, noCameraStep, leave, postMode, publishState.phase, step]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [back]);

  // ── Mode bar ───────────────────────────────────────────────────────────────
  function changeMode(next: CreateMode) {
    if (next === 'story') { router.replace('/buyer-story-create' as never); return; }
    if (next === 'live') { router.push('/seller-go-live' as never); return; }
    modeTouched.current = true;
    setMode(next);
  }

  // ── Capture / gallery → edit ───────────────────────────────────────────────
  const buildFromAssets = useCallback(async (assets: PickedAsset[], source: 'camera' | 'gallery') => {
    setPickedForGallery(source === 'gallery' ? assets : []);
    const cap = MAX_SLIDES_BY_MODE[postMode];
    if (postMode === 'post') {
      // POST: photos and videos mixed, one carousel.
      const slides = await Promise.all(assets.slice(0, cap).map(assetToSlide));
      setMedia({ kind: 'slides', slides, aspect: '3:4', coverIndex: 0 });
      setActiveSlide(0);
      setStep('edit');
      return;
    }
    const video = assets.find((a) => a.kind === 'video');
    if (video) {
      const duration = Math.min(Math.max(0.1, video.duration), MAX_VIDEO_SECONDS);
      setMedia({ kind: 'video', video: { uri: video.uri, mimeType: video.mimeType, duration, speed: 1, trimStart: 0, trimEnd: duration, coverOffset: 0 } });
    } else {
      const slides = await Promise.all(assets.filter((a) => a.kind === 'photo').slice(0, cap).map(assetToSlide));
      setMedia({ kind: 'slides', slides, aspect: DEFAULT_SLIDE_ASPECT, coverIndex: 0 });
      setActiveSlide(0);
    }
    setStep('edit');
  }, [postMode]);

  // ── Publish ────────────────────────────────────────────────────────────────
  const submit = useCallback(async (asDraft: boolean) => {
    if (publishState.phase === 'running') return;
    if (!asDraft && details.scheduledAt && new Date(details.scheduledAt).getTime() <= Date.now()) {
      Alert.alert('Choose a future time', 'Open Schedule and pick a time in the future.');
      return;
    }
    // The signed-out web preview never calls protected upload/create APIs.
    if (isSellerDevPreview() || isBuyerDevPreview()) {
      setPublishState({ phase: 'error', message: 'Posting is turned off in the preview. Sign in to publish.', draft: asDraft });
      return;
    }
    abort.current = { aborted: false };
    setPublishState({ phase: 'running', fraction: 0, step: 'uploading', draft: asDraft });
    try {
      if (editId && editing) {
        // Media is already uploaded; only the details change.
        setPublishState({ phase: 'running', fraction: 0.5, step: 'saving', draft: asDraft });
        await updateSellerPost(editId, {
          caption: details.caption,
          hashtags: extractHashtags(details.caption),
          productTags: details.productTags.map((t) => ({ productId: t.productId, productName: t.productName, priceCents: t.priceCents })) as any,
          visibility: details.visibility,
          isDraft: asDraft,
          postStatus: asDraft ? 'draft' : details.scheduledAt ? 'scheduled' : 'published',
          scheduledAt: asDraft ? null : details.scheduledAt,
        });
      } else if (media) {
        const run = () => publishCreatePost({
          api,
          input: { mode: postMode, media, details, isDraft: asDraft, remixOfPostId: remixOf },
          onProgress: (fraction, phaseStep) => setPublishState({ phase: 'running', fraction, step: phaseStep, draft: asDraft }),
          signal: abort.current,
        });
        if (asDraft) await run(); else await completeSetupTaskAfter('first_post', run);
      } else {
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPublishState({ phase: 'idle' });
      leave();
    } catch (error) {
      if (abort.current.aborted) { setPublishState({ phase: 'idle' }); return; }
      setPublishState({ phase: 'error', message: friendlyError(error), draft: asDraft });
    }
  }, [api, details, editId, editing, leave, media, postMode, publishState.phase, remixOf]);

  const lastDraft = publishState.phase === 'error' || publishState.phase === 'running' ? publishState.draft : false;

  return (
    <View style={s.root} testID="create-post-screen">
      <StatusBar barStyle="light-content" />
      {step === 'capture' && !noCameraStep ? (
        <CreateCamera
          isBuyer={!isSeller}
          mode={postMode}
          onModeChange={changeMode}
          onClose={leave}
          onOpenLibrary={() => setStep('gallery')}
          onGoLive={isSeller ? () => changeMode('live') : undefined}
          onPhoto={(uri) => buildFromAssets([{ id: `cam-${Date.now()}`, uri, kind: 'photo', duration: 0, mimeType: 'image/jpeg' }], 'camera')}
          onVideo={(uri, duration) => buildFromAssets([{ id: `cam-${Date.now()}`, uri, kind: 'video', duration, mimeType: uri.startsWith('blob:') ? 'video/webm' : 'video/mp4' }], 'camera')}
        />
      ) : null}

      {step === 'gallery' && postMode === 'post' ? (
        <PostPicker
          modes={modes}
          mode={mode}
          onChangeMode={changeMode}
          onClose={back}
          initial={media?.kind === 'slides' ? media.slides : []}
          onOpenCamera={noCameraStep ? undefined : () => setStep('capture')}
          onNext={(slides) => { setMedia({ kind: 'slides', slides, aspect: '3:4', coverIndex: 0 }); setActiveSlide(Math.max(0, slides.length - 1)); setStep('edit'); }}
        />
      ) : null}
      {step === 'gallery' && postMode === 'thread' ? (
        <GalleryPicker
          mode={postMode}
          initialSelection={pickedForGallery}
          onClose={back}
          onNext={(sel) => buildFromAssets(sel, 'gallery')}
          destinationOptions={modes.map((m) => ({ id: m, label: MODE_LABEL[m][0] + MODE_LABEL[m].slice(1).toLowerCase() }))}
          onPickDestination={(id) => changeMode(id as CreateMode)}
        />
      ) : null}

      {step === 'edit' && media?.kind === 'slides' && postMode === 'post' ? (
        <CarouselEditor
          slides={media.slides}
          activeIndex={activeSlide}
          onActiveIndex={setActiveSlide}
          onSlides={(slides) => setMedia({ ...media, slides })}
          onBack={() => setStep('gallery')}
          onAdd={() => setStep('gallery')}
          onNext={() => setStep('post')}
        />
      ) : null}
      {step === 'edit' && media?.kind === 'slides' && postMode === 'thread' ? (
        <SlideEditor
          slides={media.slides}
          aspect={media.aspect}
          activeIndex={activeSlide}
          onActiveIndex={setActiveSlide}
          onAspect={(aspect: PostAspect) => setMedia({ ...media, aspect })}
          onSlides={(slides) => setMedia({ ...media, slides, coverIndex: Math.min(media.coverIndex, slides.length - 1) })}
          onBack={() => (media.slides.length === 0 ? setStep('gallery') : back())}
          onNext={() => setStep('post')}
        />
      ) : null}
      {step === 'edit' && media?.kind === 'video' ? (
        <VideoEditor video={media.video} onChange={(video) => setMedia({ kind: 'video', video })} onBack={back} onNext={() => setStep('post')} />
      ) : null}

      {step === 'post' ? (
        <PostScreen
          mode={postMode}
          isSeller={isSeller}
          media={media}
          onMedia={setMedia}
          details={details}
          onDetails={setDetails}
          editing={!!editId}
          existingThumb={editing?.thumbnailUri ?? editing?.mediaUris?.[0]}
          publishState={publishState}
          onSubmit={submit}
          onRetry={() => submit(lastDraft)}
          onCancelPublish={() => { abort.current.aborted = true; setPublishState({ phase: 'idle' }); }}
          onBack={back}
          onDiscard={leave}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({ root: { flex: 1, backgroundColor: CP.black } });
