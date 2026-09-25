/**
 * Brandthread Design Studio — Service Layer
 * All AsyncStorage CRUD + mock AI functions.
 * No dynamic await import(). All types from './designTypes'.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { serviceRequest } from '@/lib/serviceConfig';
import { masterUploadMetadata, type MasterExportAsset } from '@/lib/designExportPolicy';
import { getImageDimensions } from '@/lib/imageDimensions';
import {
  cacheDesignCloudImage,
  readRetainedDesignUploadAsset,
  removeRetainedDesignUploadAsset,
  retainDesignUploadAsset,
} from '@/lib/designCloudImageCache';
import { ApiError } from '@/lib/networkNotice';
import {
  DesignProject, DesignProjectType, DesignProjectStatus, DesignCanvas,
  DesignLayer, DesignVersion, DesignVersionMeta, BrandAsset, BrandAssetTypeKind,
  AIGenerationRequest, AIGenerationResult, AIPhotoshootRequest,
  GenerateDesignResult, GenerateMockupResult, GeneratePhotoshootResult,
  MockupToModelBatchResult,
  AIStyleKind, CampaignFormatKind, CampaignProject, CampaignAsset,
  DesignExport, ExportFormatKind, ExportSizeKind, GarmentType,
} from './designTypes';

// ─── Storage Keys ─────────────────────────────────────────────────────────────
let _designUserId = 'anon';
let _designStoreContext = 'joined';
let _designScopeGeneration = 0;
const LEGACY_PROJECTS_KEY = 'bt:design:projects:v1';

export function initDesignService(userId: string | null, storeContext: string | null = null): void {
  const nextUser = userId ?? 'anon';
  const nextStore = storeContext ?? 'joined';
  if (nextUser !== _designUserId || nextStore !== _designStoreContext) _designScopeGeneration += 1;
  _designUserId = nextUser;
  _designStoreContext = nextStore;
  if (nextUser !== 'anon') void drainVerifiedUploadQueue(captureSyncContext());
}

function K(userId = _designUserId, storeContext = _designStoreContext) {
  const scope = `${userId}:${storeContext}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
  return {
    projects: `bt:design:${scope}:projects:v2`,
    assets: `bt:design:${scope}:brand-assets:v2`,
    versions: `bt:design:${scope}:versions:v2`,
    sourceMap: `bt:design:${scope}:cloud-source-map:v2`,
    syncState: `bt:design:${scope}:sync-state:v2`,
    uploadQueue: `bt:design:${scope}:verified-upload-queue:v1`,
    legacyRecovery: `bt:design:${scope}:legacy-recovery:v1`,
    colorPicker: `bt:design:${scope}:color-picker-state:v1`,
  };
}

type DesignSyncContext = {
  generation: number;
  storeContext: string;
  keys: ReturnType<typeof K>;
};

function captureSyncContext(): DesignSyncContext {
  return {
    generation: _designScopeGeneration,
    storeContext: _designStoreContext,
    keys: K(),
  };
}

function assertCurrentContext(context: DesignSyncContext): void {
  if (context.generation !== _designScopeGeneration) {
    throw new Error('Design Studio store context changed during sync.');
  }
}

function syncHeaders(context: DesignSyncContext, revision?: number): Record<string, string> {
  return {
    'X-Store-Context': context.storeContext,
    ...(revision == null ? {} : { 'X-Design-Revision': String(revision) }),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
let _idCounter = 0;
function uid(prefix = 'id'): string {
  _idCounter += 1;
  return `${prefix}_${Date.now()}_${_idCounter}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function saveProjects(arr: DesignProject[], key = K().projects): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

async function loadProjects(key = K().projects): Promise<DesignProject[]> {
  let raw = await AsyncStorage.getItem(key);
  // Only anonymous preview mode may adopt the legacy device-global cache.
  // Authenticated accounts must never guess ownership of those old records.
  if (!raw && _designUserId === 'anon') raw = await AsyncStorage.getItem(LEGACY_PROJECTS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as DesignProject[]; } catch { return []; }
}

async function pushProjectToCloud(
  project: DesignProject,
  context = captureSyncContext(),
): Promise<DesignProject> {
  assertCurrentContext(context);
  let revision = project.cloudRevision;
  // New projects must exist before their separately stored source assets.
  if (revision == null) {
    const created = await serviceRequest<{ project: DesignProject }>(
      `/api/design-studio/projects/${encodeURIComponent(project.id)}`,
      { method: 'PUT', body: JSON.stringify(project), headers: syncHeaders(context) },
    );
    revision = created.project.cloudRevision;
    if (revision == null) throw new Error('Design Studio cloud did not return a project revision.');
    await persistProvisionalCloudRevision(project.id, revision, context);
    project = { ...project, cloudRevision: revision };
  }
  assertCurrentContext(context);
  const cloudProject = await prepareCloudProject(project, context);
  const response = await serviceRequest<{ project: DesignProject }>(
    `/api/design-studio/projects/${encodeURIComponent(project.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(cloudProject),
      headers: syncHeaders(context, revision),
    },
  );
  assertCurrentContext(context);
  return response.project;
}

async function persistProvisionalCloudRevision(
  projectId: string,
  revision: number,
  context: DesignSyncContext,
): Promise<void> {
  assertCurrentContext(context);
  const projects = await loadProjects(context.keys.projects);
  await saveProjects(
    projects.map(project => project.id === projectId ? { ...project, cloudRevision: revision } : project),
    context.keys.projects,
  );
  const state = await loadSyncState(context.keys.syncState);
  if (state.upserts[projectId]) {
    state.upserts[projectId] = { ...state.upserts[projectId], cloudRevision: revision };
    await AsyncStorage.setItem(context.keys.syncState, JSON.stringify(state));
  }
}

type DesignSyncState = {
  upserts: Record<string, DesignProject>;
  deletedIds: string[];
};

const syncStateLocks = new Map<string, Promise<void>>();
const projectOperationEpochs = new Map<string, number>();

function projectEpochKey(context: DesignSyncContext, projectId: string): string {
  return `${context.keys.syncState}:${projectId}`;
}

function captureProjectEpoch(context: DesignSyncContext, projectId: string): number {
  return projectOperationEpochs.get(projectEpochKey(context, projectId)) ?? 0;
}

function invalidateProjectOperations(context: DesignSyncContext, projectId: string): void {
  const key = projectEpochKey(context, projectId);
  projectOperationEpochs.set(key, (projectOperationEpochs.get(key) ?? 0) + 1);
}

function assertProjectEpoch(context: DesignSyncContext, projectId: string, epoch: number): void {
  assertCurrentContext(context);
  if (captureProjectEpoch(context, projectId) !== epoch) {
    throw new Error('Design Studio project was deleted during sync.');
  }
}

async function withSyncLock<T>(context: DesignSyncContext, operation: () => Promise<T>): Promise<T> {
  const key = context.keys.syncState;
  const previous = syncStateLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  syncStateLocks.set(key, tail);
  await previous;
  try {
    assertCurrentContext(context);
    return await operation();
  } finally {
    release();
    if (syncStateLocks.get(key) === tail) syncStateLocks.delete(key);
  }
}

async function loadSyncState(key = K().syncState): Promise<DesignSyncState> {
  try {
    const parsed = JSON.parse(await AsyncStorage.getItem(key) ?? '{}') as Partial<DesignSyncState>;
    return { upserts: parsed.upserts ?? {}, deletedIds: parsed.deletedIds ?? [] };
  } catch {
    return { upserts: {}, deletedIds: [] };
  }
}

async function queueProjectSync(project: DesignProject, context: DesignSyncContext): Promise<void> {
  await withSyncLock(context, async () => {
    await queueProjectSyncLocked(project, context);
  });
}

async function queueProjectSyncLocked(
  project: DesignProject,
  context: DesignSyncContext,
): Promise<void> {
  const state = await loadSyncState(context.keys.syncState);
  if (state.deletedIds.includes(project.id)) return;
  const local = (await loadProjects(context.keys.projects)).find(item => item.id === project.id);
  state.upserts[project.id] = {
    ...project,
    cloudRevision: local?.cloudRevision ?? project.cloudRevision,
  };
  await AsyncStorage.setItem(context.keys.syncState, JSON.stringify(state));
}

async function drainProjectSync(context = captureSyncContext()): Promise<void> {
  await withSyncLock(context, async () => {
    const state = await loadSyncState(context.keys.syncState);
    for (const project of Object.values(state.upserts)) {
      const epoch = captureProjectEpoch(context, project.id);
      try {
        assertProjectEpoch(context, project.id, epoch);
        const synced = await pushProjectToCloud(project, context);
        assertProjectEpoch(context, project.id, epoch);
        const projects = await loadProjects(context.keys.projects);
        assertProjectEpoch(context, project.id, epoch);
        await saveProjects(
          projects.map(item => item.id === synced.id ? { ...item, cloudRevision: synced.cloudRevision } : item),
          context.keys.projects,
        );
        delete state.upserts[project.id];
        await AsyncStorage.setItem(context.keys.syncState, JSON.stringify(state));
      } catch (error) {
        if (captureProjectEpoch(context, project.id) !== epoch) {
          delete state.upserts[project.id];
          await AsyncStorage.setItem(context.keys.syncState, JSON.stringify(state));
          continue;
        }
        if (error instanceof ApiError && error.status === 409) {
          await reconcileProjectConflict(project, state, context);
          continue;
        }
        return;
      }
    }
  });
}

async function deleteProjectsSerialized(
  projectIds: string[],
  context: DesignSyncContext,
): Promise<void> {
  await discardVerifiedUploadsForProjects(projectIds, context);
  await withSyncLock(context, async () => {
    const ids = new Set(projectIds);
    const projects = await loadProjects(context.keys.projects);
    await saveProjects(projects.filter(project => !ids.has(project.id)), context.keys.projects);

    const state = await loadSyncState(context.keys.syncState);
    const tombstones = new Set(state.deletedIds);
    for (const id of ids) {
      tombstones.add(id);
      delete state.upserts[id];
    }
    state.deletedIds = [...tombstones];
    await AsyncStorage.setItem(context.keys.syncState, JSON.stringify(state));

    const remainingTargets = new Set<string>();
    for (const id of ids) {
      try {
        await serviceRequest(`/api/design-studio/projects/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: syncHeaders(context),
        });
        assertCurrentContext(context);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) remainingTargets.add(id);
      }
    }
    state.deletedIds = state.deletedIds.filter(id => !ids.has(id) || remainingTargets.has(id));
    await AsyncStorage.setItem(context.keys.syncState, JSON.stringify(state));
  });
}

async function drainProjectDeletes(context: DesignSyncContext): Promise<void> {
  await withSyncLock(context, async () => {
    const state = await loadSyncState(context.keys.syncState);
    const remaining: string[] = [];
    for (const id of state.deletedIds) {
      try {
        await serviceRequest(`/api/design-studio/projects/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: syncHeaders(context),
        });
        assertCurrentContext(context);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) remaining.push(id);
      }
    }
    state.deletedIds = remaining;
    await AsyncStorage.setItem(context.keys.syncState, JSON.stringify(state));
  });
}

async function pushProjectSerialized(
  project: DesignProject,
  context: DesignSyncContext,
  epoch = captureProjectEpoch(context, project.id),
): Promise<DesignProject> {
  return withSyncLock(context, () => {
    assertProjectEpoch(context, project.id, epoch);
    return pushProjectToCloud(project, context);
  });
}

async function reconcileProjectConflict(
  local: DesignProject,
  state: DesignSyncState,
  context: DesignSyncContext,
  knownCloud?: DesignProject,
): Promise<void> {
  const cloudProject = knownCloud ?? (await serviceRequest<{ project: DesignProject }>(
      `/api/design-studio/projects/${encodeURIComponent(local.id)}`,
      { headers: syncHeaders(context) },
    )).project;
  assertCurrentContext(context);
  const cloud = await cacheCloudImages(cloudProject);
  const now = new Date().toISOString();
  const conflict: DesignProject = {
    ...local,
    id: uid('proj'),
    name: `${local.name} (conflict copy)`,
    cloudRevision: undefined,
    createdAt: now,
    updatedAt: now,
  };
  delete (conflict as DesignProject & { thumbnailObjectPath?: string }).thumbnailObjectPath;
  delete (conflict.canvas as DesignCanvas & { backgroundImageObjectPath?: string }).backgroundImageObjectPath;
  for (const layer of conflict.layers) {
    if (layer.data.kind === 'image') {
      delete (layer.data as typeof layer.data & { cloudObjectPath?: string }).cloudObjectPath;
    }
  }
  const projects = await loadProjects(context.keys.projects);
  await saveProjects(
    [...projects.filter(project => project.id !== local.id), cloud, conflict],
    context.keys.projects,
  );
  delete state.upserts[local.id];
  state.upserts[conflict.id] = conflict;
  await AsyncStorage.setItem(context.keys.syncState, JSON.stringify(state));
}

async function sourceMap(key = K().sourceMap): Promise<Record<string, string>> {
  try { return JSON.parse(await AsyncStorage.getItem(key) ?? '{}') as Record<string, string>; }
  catch { return {}; }
}

async function uploadProjectImage(
  projectId: string,
  uri: string,
  kind: 'source' | 'thumbnail',
  context: DesignSyncContext,
): Promise<string> {
  assertCurrentContext(context);
  const mapKey = context.keys.sourceMap;
  const cached = await sourceMap(mapKey);
  const cacheKey = `${projectId}:${kind}:${uri}`;
  if (cached[cacheKey]) return cached[cacheKey];
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read a Design Studio source image.');
  const blob = await response.blob();
  const bytes = await blob.arrayBuffer();
  const dimensions = await getImageDimensions(uri);
  const normalizedType = blob.type.toLowerCase();
  const path = uri.split('?')[0].toLowerCase();
  const candidates = ['png', 'jpeg', 'gif', 'webp'] as const;
  const format = candidates.find(candidate => {
    const mime = candidate === 'jpeg' ? 'image/jpeg' : `image/${candidate}`;
    const extensions = candidate === 'jpeg' ? ['.jpg', '.jpeg'] : [`.${candidate}`];
    return normalizedType === mime || uri.startsWith(`data:${mime}`) ||
      extensions.some(extension => path.endsWith(extension));
  });
  if (!format) throw new Error('Unsupported Design Studio source image type.');
  const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}` as const;
  const raw = new Uint8Array(bytes);
  let webpLossless = false;
  for (let index = 12; format === 'webp' && index + 3 < raw.length; index += 1) {
    if (raw[index] === 0x56 && raw[index + 1] === 0x50 &&
        raw[index + 2] === 0x38 && raw[index + 3] === 0x4c) {
      webpLossless = true;
      break;
    }
  }
  const lossless = format === 'png' || format === 'gif' || webpLossless;
  const uploaded = await serviceRequest<{ asset: SyncedDesignAsset }>(
    `/api/design-studio/projects/${encodeURIComponent(projectId)}/assets/${kind}`,
    {
      method: 'POST',
      body: bytes,
      headers: {
        ...syncHeaders(context),
        'Content-Type': mimeType,
        'X-Design-Width': String(dimensions.width),
        'X-Design-Height': String(dimensions.height),
        'X-Design-Format': format,
        'X-Design-Lossless': String(lossless),
      },
    },
  );
  assertCurrentContext(context);
  cached[cacheKey] = uploaded.asset.objectPath;
  await AsyncStorage.setItem(mapKey, JSON.stringify(cached));
  return uploaded.asset.objectPath;
}

async function cacheCloudImages(project: DesignProject): Promise<DesignProject> {
  const cached = JSON.parse(JSON.stringify(project)) as DesignProject;
  async function localCopy(uri: string, objectPath: string): Promise<string> {
    return cacheDesignCloudImage(project.id, objectPath, uri);
  }
  const canvas = cached.canvas as DesignCanvas & { backgroundImageObjectPath?: string };
  if (canvas.backgroundImageUri && canvas.backgroundImageObjectPath) {
    canvas.backgroundImageUri = await localCopy(canvas.backgroundImageUri, canvas.backgroundImageObjectPath);
  }
  for (const layer of cached.layers) {
    if (layer.data.kind !== 'image') continue;
    const image = layer.data as typeof layer.data & { uri: string; cloudObjectPath?: string };
    if (image.uri && image.cloudObjectPath) image.uri = await localCopy(image.uri, image.cloudObjectPath);
  }
  return cached;
}

async function prepareCloudProject(project: DesignProject, context: DesignSyncContext): Promise<DesignProject> {
  const snapshot = JSON.parse(JSON.stringify(project)) as DesignProject;
  const snapshotWithCloud = snapshot as DesignProject & { thumbnailObjectPath?: string };
  const canvas = snapshot.canvas as DesignCanvas & { backgroundImageObjectPath?: string };
  if (canvas.backgroundImageObjectPath) {
    canvas.backgroundImageUri = canvas.backgroundImageObjectPath;
  } else if (canvas.backgroundImageUri) {
    canvas.backgroundImageObjectPath = await uploadProjectImage(project.id, canvas.backgroundImageUri, 'source', context);
    canvas.backgroundImageUri = canvas.backgroundImageObjectPath;
  }
  for (const layer of snapshot.layers) {
    if (layer.data.kind !== 'image') continue;
    const image = layer.data as typeof layer.data & { uri: string; cloudObjectPath?: string };
    if (image.cloudObjectPath) {
      image.uri = image.cloudObjectPath;
    } else if (image.uri) {
      image.cloudObjectPath = await uploadProjectImage(project.id, image.uri, 'source', context);
      image.uri = image.cloudObjectPath;
    }
  }
  if (snapshotWithCloud.thumbnailObjectPath) {
    snapshot.thumbnail = snapshotWithCloud.thumbnailObjectPath;
  } else if (snapshot.thumbnail) {
    snapshotWithCloud.thumbnailObjectPath = await uploadProjectImage(project.id, snapshot.thumbnail, 'thumbnail', context);
    snapshot.thumbnail = snapshotWithCloud.thumbnailObjectPath;
  }
  return snapshot;
}

async function loadCloudProjects(context: DesignSyncContext): Promise<DesignProject[]> {
  const response = await serviceRequest<{ projects: DesignProject[] }>(
    '/api/design-studio/projects',
    { headers: syncHeaders(context) },
  );
  assertCurrentContext(context);
  return response.projects;
}

async function saveVersions(arr: DesignVersion[], key = K().versions): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

async function loadVersions(key = K().versions): Promise<DesignVersion[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try { return JSON.parse(raw) as DesignVersion[]; } catch { return []; }
}

async function saveAssets(arr: BrandAsset[], key = K().assets): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

async function loadAssets(key = K().assets): Promise<BrandAsset[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try { return JSON.parse(raw) as BrandAsset[]; } catch { return []; }
}

// ─── Seed Data ────────────────────────────────────────────────────────────────
function makeSeedProject(
  name: string,
  type: DesignProjectType,
  status: DesignProjectStatus,
  extra: Partial<DesignProject> = {},
): DesignProject {
  const now = new Date().toISOString();
  return {
    id: uid('proj'),
    name,
    type,
    status,
    canvas: { width: 1080, height: 1080, backgroundHex: '#000000' },
    layers: [],
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

async function seedIfEmpty(projectsKey = K().projects): Promise<DesignProject[]> {
  const existing = await loadProjects(projectsKey);
  if (existing.length > 0) return existing;
  const seeds: DesignProject[] = [
    makeSeedProject('Spring Drop Hoodie', 'garment', 'saved', {
      garmentType: 'hoodie',
      garmentColor: '#1A1A2E',
    }),
    makeSeedProject('Product Launch Mockup', 'mockup', 'draft'),
    makeSeedProject('Campaign Assets', 'campaign', 'exported'),
  ];
  await saveProjects(seeds, projectsKey);
  return seeds;
}

function parseLegacyProjects(raw: string | null): DesignProject[] {
  if (!raw) return [];
  try {
    const values = JSON.parse(raw) as unknown[];
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is DesignProject => {
      if (!value || typeof value !== 'object') return false;
      const project = value as Partial<DesignProject>;
      return typeof project.id === 'string' && typeof project.name === 'string' &&
        Array.isArray(project.layers) && !!project.canvas &&
        Number.isSafeInteger(project.canvas.width) && Number.isSafeInteger(project.canvas.height);
    });
  } catch {
    return [];
  }
}

export async function getRecoverableLegacyProjectCount(): Promise<number> {
  if (_designUserId === 'anon') return 0;
  const keys = K();
  if (await AsyncStorage.getItem(keys.legacyRecovery)) return 0;
  return parseLegacyProjects(await AsyncStorage.getItem(LEGACY_PROJECTS_KEY)).length;
}

export async function recoverLegacyDesignProjects(): Promise<number> {
  if (_designUserId === 'anon') throw new Error('Sign in before recovering Design Studio projects.');
  const context = captureSyncContext();
  const recovered = await withSyncLock(context, async () => {
    if (await AsyncStorage.getItem(context.keys.legacyRecovery)) return [] as DesignProject[];
    const legacy = parseLegacyProjects(await AsyncStorage.getItem(LEGACY_PROJECTS_KEY));
    const current = await loadProjects(context.keys.projects);
    const currentIds = new Set(current.map(project => project.id));
    const additions = legacy.filter(project => !currentIds.has(project.id))
      .map(project => ({ ...project, cloudRevision: undefined }));
    const state = await loadSyncState(context.keys.syncState);
    for (const project of additions) {
      if (!state.deletedIds.includes(project.id)) state.upserts[project.id] = project;
    }
    await saveProjects([...current, ...additions], context.keys.projects);
    await AsyncStorage.setItem(context.keys.syncState, JSON.stringify(state));
    await AsyncStorage.setItem(context.keys.legacyRecovery, new Date().toISOString());
    return additions;
  });
  void drainProjectSync(context);
  return recovered.length;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

/**
 * Returns only non-deleted projects (normal navigation).
 */
export async function getProjects(): Promise<DesignProject[]> {
  const context = captureSyncContext();
  const keys = context.keys;
  await drainProjectDeletes(context);
  const pendingDeletes = new Set((await loadSyncState(keys.syncState)).deletedIds);
  let all: DesignProject[];
  try {
    const cloud = (await loadCloudProjects(context)).filter(project => !pendingDeletes.has(project.id));
    all = await withSyncLock(context, async () => {
      const local = await loadProjects(keys.projects);
      const state = await loadSyncState(keys.syncState);
      const cloudIds = new Set(cloud.map(project => project.id));
      const merged = new Map<string, DesignProject>();
      for (const project of local) {
        if (pendingDeletes.has(project.id)) continue;
        if (cloudIds.has(project.id) || project.cloudRevision == null) {
          merged.set(project.id, project);
        } else {
          delete state.upserts[project.id];
          invalidateProjectOperations(context, project.id);
        }
      }
      for (const project of cloud) {
        const localProject = merged.get(project.id);
        const isPending = Boolean(state.upserts[project.id]);
        const cloudRevision = project.cloudRevision ?? 0;
        const localRevision = localProject?.cloudRevision ?? 0;
        if (!localProject || cloudRevision > localRevision ||
            (!isPending && new Date(project.updatedAt).getTime() >= new Date(localProject.updatedAt).getTime())) {
          merged.set(project.id, await cacheCloudImages(project));
        }
      }
      const reconciled = [...merged.values()];
      await saveProjects(reconciled, keys.projects);
      await AsyncStorage.setItem(keys.syncState, JSON.stringify(state));
      return reconciled;
    });
  } catch {
    all = await seedIfEmpty(keys.projects);
  }
  if (context.generation !== _designScopeGeneration) return [];
  void drainProjectSync(context);
  return all.filter(p => !p.deletedAt);
}

/**
 * Returns a project by id regardless of soft-delete state.
 * The canvas editor uses this so an id in the URL always resolves.
 */
export async function getProject(id: string): Promise<DesignProject | null> {
  const context = captureSyncContext();
  const keys = context.keys;
  const projects = await loadProjects(keys.projects);
  const local = projects.find(p => p.id === id) ?? null;
  try {
    const response = await serviceRequest<{ project: DesignProject }>(
      `/api/design-studio/projects/${encodeURIComponent(id)}`,
      { headers: syncHeaders(context) },
    );
    assertCurrentContext(context);
    const state = await loadSyncState(keys.syncState);
    const pending = Boolean(state.upserts[id]);
    const cloudRevision = response.project.cloudRevision ?? 0;
    const localRevision = local?.cloudRevision ?? 0;
    if (local && pending && cloudRevision > localRevision) {
      await withSyncLock(context, () =>
        reconcileProjectConflict(local, state, context, response.project));
      return (await loadProjects(keys.projects)).find(project => project.id === id) ?? null;
    }
    const cloudWins = !local ||
      cloudRevision > localRevision ||
      (!pending && cloudRevision === localRevision &&
       new Date(response.project.updatedAt).getTime() >= new Date(local.updatedAt).getTime());
    if (cloudWins) {
      const cachedProject = await cacheCloudImages(response.project);
      await saveProjects([...projects.filter(project => project.id !== id), cachedProject], keys.projects);
      return cachedProject;
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && local?.cloudRevision != null) {
      invalidateProjectOperations(context, id);
      await withSyncLock(context, async () => {
        const current = await loadProjects(keys.projects);
        await saveProjects(current.filter(project => project.id !== id), keys.projects);
        const state = await loadSyncState(keys.syncState);
        delete state.upserts[id];
        await AsyncStorage.setItem(keys.syncState, JSON.stringify(state));
      });
      return null;
    }
    // Local editing remains available while offline or before auth is ready.
  }
  return local;
}

/**
 * Returns only soft-deleted projects for the Recently Deleted view.
 */
export async function getDeletedProjects(): Promise<DesignProject[]> {
  const all = await loadProjects();
  return all.filter(p => !!p.deletedAt).sort((a, b) =>
    new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime(),
  );
}

export async function createProject(
  type: DesignProjectType,
  name: string,
  canvas: Partial<DesignCanvas>,
  garmentType?: GarmentType,
  garmentColor?: string,
): Promise<DesignProject> {
  const context = captureSyncContext();
  const keys = context.keys;
  const projects = await seedIfEmpty(keys.projects);
  const now = new Date().toISOString();
  const fullCanvas: DesignCanvas = {
    width: canvas.width ?? 1080,
    height: canvas.height ?? 1080,
    backgroundHex: canvas.backgroundHex ?? '#000000',
    backgroundImageUri: canvas.backgroundImageUri,
    backgroundOpacity: canvas.backgroundOpacity,
  };
  const project: DesignProject = {
    id: uid('proj'),
    name,
    type,
    status: 'draft',
    canvas: fullCanvas,
    layers: [],
    garmentType,
    garmentColor,
    createdAt: now,
    updatedAt: now,
  };
  await saveProjects([...projects, project], keys.projects);
  try {
    const synced = await pushProjectSerialized(project, context);
    const localSynced = { ...project, cloudRevision: synced.cloudRevision };
    await saveProjects([...projects, localSynced], keys.projects);
    return localSynced;
  } catch {
    await queueProjectSync(project, context);
    return (await loadProjects(keys.projects)).find(item => item.id === project.id) ?? project;
  }
}

export async function updateProject(id: string, partial: Partial<DesignProject>): Promise<DesignProject> {
  const context = captureSyncContext();
  const epoch = captureProjectEpoch(context, id);
  return withSyncLock(context, async () => {
    assertProjectEpoch(context, id, epoch);
    const projects = await loadProjects(context.keys.projects);
    const idx = projects.findIndex(p => p.id === id);
    if (idx === -1) throw new Error(`Project ${id} not found`);
    const updated: DesignProject = {
      ...projects[idx],
      ...partial,
      cloudRevision: projects[idx].cloudRevision,
      id,
      updatedAt: new Date().toISOString(),
    };
    projects[idx] = updated;
    await saveProjects(projects, context.keys.projects);
    try {
      assertProjectEpoch(context, id, epoch);
      const synced = await pushProjectToCloud(updated, context);
      assertProjectEpoch(context, id, epoch);
      projects[idx] = { ...updated, cloudRevision: synced.cloudRevision };
      await saveProjects(projects, context.keys.projects);
      return projects[idx];
    } catch {
      if (captureProjectEpoch(context, id) === epoch) await queueProjectSyncLocked(updated, context);
      return (await loadProjects(context.keys.projects)).find(item => item.id === id) ?? updated;
    }
  });
}

export interface SyncedDesignAsset {
  id: string;
  projectId: string;
  kind: 'master' | 'thumbnail' | 'source';
  objectPath: string;
  downloadUrl: string;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  format: 'png' | 'jpeg' | 'gif' | 'webp';
  lossless: boolean;
  quality: number | null;
  byteSize: number;
}

interface VerifiedUploadQueueEntry {
  id: string;
  projectId: string;
  kind: 'master' | 'thumbnail';
  asset: MasterExportAsset;
  queuedAt: string;
}

const verifiedUploadLocks = new Map<string, Promise<void>>();
const verifiedUploadRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function withVerifiedUploadLock<T>(
  context: DesignSyncContext,
  operation: () => Promise<T>,
): Promise<T> {
  const key = context.keys.uploadQueue;
  const previous = verifiedUploadLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  verifiedUploadLocks.set(key, tail);
  await previous;
  try {
    assertCurrentContext(context);
    return await operation();
  } finally {
    release();
    if (verifiedUploadLocks.get(key) === tail) verifiedUploadLocks.delete(key);
  }
}

async function loadVerifiedUploadQueue(key: string): Promise<VerifiedUploadQueueEntry[]> {
  try {
    const value = JSON.parse(await AsyncStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? value as VerifiedUploadQueueEntry[] : [];
  } catch {
    return [];
  }
}

async function uploadVerifiedDesignAsset(
  projectId: string,
  asset: MasterExportAsset,
  kind: 'master' | 'thumbnail',
  context: DesignSyncContext,
  uploadId: string,
): Promise<SyncedDesignAsset> {
  assertCurrentContext(context);
  const metadata = masterUploadMetadata(asset);
  const bytes = await readRetainedDesignUploadAsset(asset.uri);
  assertCurrentContext(context);
  const response = await serviceRequest<{ asset: SyncedDesignAsset }>(
    `/api/design-studio/projects/${encodeURIComponent(projectId)}/assets/${kind}`,
    {
      method: 'POST',
      body: bytes,
      headers: {
        ...syncHeaders(context),
        'Content-Type': metadata.mimeType,
        'X-Design-Width': String(metadata.width),
        'X-Design-Height': String(metadata.height),
        'X-Design-Format': metadata.format,
        'X-Design-Lossless': String(metadata.lossless),
        'X-Design-Upload-Id': uploadId,
        ...(metadata.quality == null ? {} : { 'X-Design-Quality': String(Math.round(metadata.quality * 100)) }),
      },
    },
  );
  assertCurrentContext(context);
  return response.asset;
}

function scheduleVerifiedUploadRetry(context: DesignSyncContext): void {
  const key = context.keys.uploadQueue;
  if (verifiedUploadRetryTimers.has(key)) return;
  const timer = setTimeout(() => {
    verifiedUploadRetryTimers.delete(key);
    void drainVerifiedUploadQueue(context);
  }, 30_000);
  verifiedUploadRetryTimers.set(key, timer);
}

async function queueVerifiedUpload(
  id: string,
  projectId: string,
  asset: MasterExportAsset,
  kind: 'master' | 'thumbnail',
  context: DesignSyncContext,
): Promise<void> {
  const retainedUri = await retainDesignUploadAsset(asset.uri, id, asset.format);
  try {
    await withVerifiedUploadLock(context, async () => {
      const queue = await loadVerifiedUploadQueue(context.keys.uploadQueue);
      queue.push({
        id,
        projectId,
        kind,
        asset: { ...asset, uri: retainedUri },
        queuedAt: new Date().toISOString(),
      });
      await AsyncStorage.setItem(context.keys.uploadQueue, JSON.stringify(queue));
    });
  } catch (error) {
    await removeRetainedDesignUploadAsset(retainedUri).catch(() => {});
    throw error;
  }
  scheduleVerifiedUploadRetry(context);
}

async function discardVerifiedUploadsForProjects(
  projectIds: string[],
  context: DesignSyncContext,
): Promise<void> {
  const ids = new Set(projectIds);
  await withVerifiedUploadLock(context, async () => {
    const queue = await loadVerifiedUploadQueue(context.keys.uploadQueue);
    const discarded = queue.filter(entry => ids.has(entry.projectId));
    if (discarded.length === 0) return;
    await AsyncStorage.setItem(
      context.keys.uploadQueue,
      JSON.stringify(queue.filter(entry => !ids.has(entry.projectId))),
    );
    await Promise.all(discarded.map(entry =>
      removeRetainedDesignUploadAsset(entry.asset.uri).catch(() => {})));
  });
}

export async function drainVerifiedUploadQueue(
  context = captureSyncContext(),
): Promise<void> {
  if (_designUserId === 'anon') return;
  await withVerifiedUploadLock(context, async () => {
    const queue = await loadVerifiedUploadQueue(context.keys.uploadQueue);
    while (queue.length > 0) {
      const entry = queue[0];
      try {
        await uploadVerifiedDesignAsset(entry.projectId, entry.asset, entry.kind, context, entry.id);
      } catch (error) {
        // Auth expiry, a project that has not synced yet, conflicts, and rate
        // limits can all recover. Only reject bytes the server cannot accept.
        if (error instanceof ApiError && [400, 413, 415, 422].includes(error.status)) {
          queue.shift();
          await AsyncStorage.setItem(context.keys.uploadQueue, JSON.stringify(queue));
          await removeRetainedDesignUploadAsset(entry.asset.uri).catch(() => {});
          continue;
        }
        scheduleVerifiedUploadRetry(context);
        return;
      }
      queue.shift();
      await AsyncStorage.setItem(context.keys.uploadQueue, JSON.stringify(queue));
      await removeRetainedDesignUploadAsset(entry.asset.uri).catch(() => {});
    }
  }).catch(() => {});
}

/** Uploads already-verified bytes without resize or re-encoding; failures are durably queued. */
export async function syncVerifiedDesignAsset(
  projectId: string,
  asset: MasterExportAsset,
  kind: 'master' | 'thumbnail' = 'master',
): Promise<SyncedDesignAsset | null> {
  const context = captureSyncContext();
  const uploadId = randomUUID();
  // Persist before the first network attempt. Every upload then flows through
  // one FIFO lock, so an older retry cannot overtake and replace a newer master.
  await queueVerifiedUpload(uploadId, projectId, asset, kind, context);
  void drainVerifiedUploadQueue(context);
  return null;
}

export async function getSyncedDesignAssets(projectId: string): Promise<SyncedDesignAsset[]> {
  const response = await serviceRequest<{ assets: SyncedDesignAsset[] }>(
    `/api/design-studio/projects/${encodeURIComponent(projectId)}/assets`,
  );
  return response.assets;
}

// autosaveProject — accepts a full DesignProject (used by design-canvas.tsx)
export async function autosaveProject(project: DesignProject): Promise<DesignProject> {
  return updateProject(project.id, { ...project, status: project.status ?? 'saved' });
}

/**
 * Soft-delete: moves project to Recently Deleted by setting deletedAt.
 * Normal gallery and getProjects() will no longer return it.
 */
export async function softDeleteProject(id: string): Promise<void> {
  await updateProject(id, { deletedAt: new Date().toISOString() });
}

/**
 * Restore a soft-deleted project back to the main gallery.
 */
export async function restoreDeletedProject(id: string): Promise<DesignProject> {
  const context = captureSyncContext();
  const epoch = captureProjectEpoch(context, id);
  return withSyncLock(context, async () => {
    assertProjectEpoch(context, id, epoch);
    const projects = await loadProjects(context.keys.projects);
    const idx = projects.findIndex(p => p.id === id);
    if (idx === -1) throw new Error(`Project ${id} not found`);
    const { deletedAt: _removed, ...rest } = projects[idx];
    const updated: DesignProject = { ...rest, updatedAt: new Date().toISOString() };
    projects[idx] = updated;
    await saveProjects(projects, context.keys.projects);
    try {
      assertProjectEpoch(context, id, epoch);
      const synced = await pushProjectToCloud(updated, context);
      assertProjectEpoch(context, id, epoch);
      projects[idx] = { ...updated, cloudRevision: synced.cloudRevision };
      await saveProjects(projects, context.keys.projects);
      return projects[idx];
    } catch {
      if (captureProjectEpoch(context, id) === epoch) await queueProjectSyncLocked(updated, context);
      return updated;
    }
  });
}

/**
 * Permanently delete — removes from storage with no recovery path.
 */
export async function deleteProject(id: string): Promise<void> {
  const context = captureSyncContext();
  invalidateProjectOperations(context, id);
  await deleteProjectsSerialized([id], context);
}

/**
 * Permanently delete all soft-deleted projects.
 */
export async function purgeDeletedProjects(): Promise<void> {
  const context = captureSyncContext();
  const keys = context.keys;
  const projects = await loadProjects(keys.projects);
  const deletedIds = projects.filter(p => !!p.deletedAt).map(p => p.id);
  for (const id of deletedIds) invalidateProjectOperations(context, id);
  await deleteProjectsSerialized(deletedIds, context);
}

export async function duplicateProject(id: string): Promise<DesignProject> {
  const context = captureSyncContext();
  const project = await getProject(id);
  if (!project) throw new Error(`Project ${id} not found`);
  const now = new Date().toISOString();
  const copy: DesignProject = {
    ...project,
    id: uid('proj'),
    name: `${project.name} (copy)`,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    deletedAt: undefined,
  };
  const copyCloud = copy as DesignProject & { thumbnailObjectPath?: string };
  delete copyCloud.thumbnailObjectPath;
  const copyCanvas = copy.canvas as DesignCanvas & { backgroundImageObjectPath?: string };
  delete copyCanvas.backgroundImageObjectPath;
  for (const layer of copy.layers) {
    if (layer.data.kind === 'image') delete (layer.data as typeof layer.data & { cloudObjectPath?: string }).cloudObjectPath;
  }
  assertCurrentContext(context);
  const keys = context.keys;
  const projects = await loadProjects(keys.projects);
  await saveProjects([...projects, copy], keys.projects);
  try {
    const synced = await pushProjectSerialized(copy, context);
    const localSynced = { ...copy, cloudRevision: synced.cloudRevision };
    await saveProjects([...projects, localSynced], keys.projects);
    return localSynced;
  } catch {
    await queueProjectSync(copy, context);
    return copy;
  }
}

export async function archiveProject(id: string): Promise<DesignProject> {
  return updateProject(id, { status: 'archived' });
}

export async function linkProjectToProduct(projectId: string, productId: string): Promise<DesignProject> {
  return updateProject(projectId, { linkedProductId: productId, status: 'sent_product' });
}

export async function sendProjectToManufacturer(projectId: string, manufacturerId: string): Promise<DesignProject> {
  return updateProject(projectId, { linkedManufacturerId: manufacturerId, status: 'sent_manufacturer' });
}

// ─── Layers ───────────────────────────────────────────────────────────────────

export async function addLayer(projectId: string, layer: DesignLayer): Promise<DesignProject> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  return updateProject(projectId, { layers: [...project.layers, layer] });
}

export async function updateLayer(
  projectId: string,
  layerId: string,
  partial: Partial<DesignLayer>,
): Promise<DesignProject> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const layers = project.layers.map(l =>
    l.id === layerId ? { ...l, ...partial, id: layerId, updatedAt: new Date().toISOString() } : l,
  );
  return updateProject(projectId, { layers });
}

export async function deleteLayer(projectId: string, layerId: string): Promise<DesignProject> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  return updateProject(projectId, { layers: project.layers.filter(l => l.id !== layerId) });
}

export async function reorderLayers(projectId: string, layerIds: string[]): Promise<DesignProject> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const layerMap = new Map(project.layers.map(l => [l.id, l]));
  const reordered = layerIds
    .map((id, idx) => {
      const l = layerMap.get(id);
      return l ? { ...l, order: idx } : null;
    })
    .filter((l): l is DesignLayer => l !== null);
  return updateProject(projectId, { layers: reordered });
}

export async function toggleLayerVisibility(projectId: string, layerId: string): Promise<DesignProject> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const layer = project.layers.find(l => l.id === layerId);
  if (!layer) throw new Error(`Layer ${layerId} not found`);
  return updateLayer(projectId, layerId, { visible: !layer.visible });
}

export async function toggleLayerLock(projectId: string, layerId: string): Promise<DesignProject> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const layer = project.layers.find(l => l.id === layerId);
  if (!layer) throw new Error(`Layer ${layerId} not found`);
  return updateLayer(projectId, layerId, { locked: !layer.locked });
}

export async function duplicateLayer(projectId: string, layerId: string): Promise<DesignProject> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const layer = project.layers.find(l => l.id === layerId);
  if (!layer) throw new Error(`Layer ${layerId} not found`);
  const now = new Date().toISOString();
  const copy: DesignLayer = {
    ...layer,
    id: uid('layer'),
    name: `${layer.name} (copy)`,
    order: layer.order + 0.5,
    createdAt: now,
    updatedAt: now,
    transform: { ...layer.transform, x: layer.transform.x + 12, y: layer.transform.y + 12 },
  };
  return updateProject(projectId, { layers: [...project.layers, copy] });
}

// ─── Versions ─────────────────────────────────────────────────────────────────

// createVersion — accepts projectId and optional label (design-canvas calls with 1 arg)
export async function createVersion(
  projectId: string,
  label = 'Manual save',
  autoSaved = false,
): Promise<DesignVersion> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const versions = await loadVersions();
  const version: DesignVersion = {
    id: uid('ver'),
    projectId,
    snapshot: { ...project },
    label,
    autoSaved,
    createdAt: new Date().toISOString(),
  };
  await saveVersions([...versions, version]);
  return version;
}

// getVersions — returns DesignVersionMeta[] (DesignVersion extends DesignVersionMeta)
export async function getVersions(projectId: string): Promise<DesignVersionMeta[]> {
  const versions = await loadVersions();
  return versions.filter(v => v.projectId === projectId);
}

export async function restoreVersion(versionId: string): Promise<DesignProject> {
  const versions = await loadVersions();
  const version = versions.find(v => v.id === versionId);
  if (!version) throw new Error(`Version ${versionId} not found`);
  return updateProject(version.projectId, { ...version.snapshot });
}

// ─── Brand Assets ─────────────────────────────────────────────────────────────

export async function getBrandAssets(): Promise<BrandAsset[]> {
  return loadAssets();
}

// addBrandAsset — alias for createBrandAsset (used by design-brand-assets.tsx)
export async function addBrandAsset(
  asset: Omit<BrandAsset, 'id' | 'createdAt'>,
): Promise<BrandAsset> {
  const assets = await loadAssets();
  const newAsset: BrandAsset = {
    ...asset,
    id: uid('asset'),
    createdAt: new Date().toISOString(),
  };
  await saveAssets([...assets, newAsset]);
  return newAsset;
}

export async function createBrandAsset(
  asset: Omit<BrandAsset, 'id' | 'createdAt'>,
): Promise<BrandAsset> {
  return addBrandAsset(asset);
}

// renameBrandAsset — used by design-brand-assets.tsx
export async function renameBrandAsset(id: string, name: string): Promise<BrandAsset> {
  const assets = await loadAssets();
  const idx = assets.findIndex(a => a.id === id);
  if (idx === -1) throw new Error(`Asset ${id} not found`);
  const updated: BrandAsset = { ...assets[idx], name };
  assets[idx] = updated;
  await saveAssets(assets);
  return updated;
}

export async function updateBrandAsset(id: string, partial: Partial<BrandAsset>): Promise<BrandAsset> {
  const assets = await loadAssets();
  const idx = assets.findIndex(a => a.id === id);
  if (idx === -1) throw new Error(`Asset ${id} not found`);
  const updated: BrandAsset = { ...assets[idx], ...partial, id };
  assets[idx] = updated;
  await saveAssets(assets);
  return updated;
}

export async function deleteBrandAsset(id: string): Promise<void> {
  const assets = await loadAssets();
  await saveAssets(assets.filter(a => a.id !== id));
}

// ─── Color picker state (recents + brand palettes) ────────────────────────────
// Persisted the same way as brand assets: one JSON blob per user/store scope.

export interface ColorPickerState {
  recentColors: string[];
  palettes: import('../lib/colorModel').BrandPalette[];
}

const DEFAULT_COLOR_PICKER_STATE: ColorPickerState = { recentColors: [], palettes: [] };

export async function getColorPickerState(): Promise<ColorPickerState> {
  try {
    const raw = await AsyncStorage.getItem(K().colorPicker);
    if (!raw) return { ...DEFAULT_COLOR_PICKER_STATE };
    const parsed = JSON.parse(raw) as Partial<ColorPickerState>;
    return {
      recentColors: Array.isArray(parsed.recentColors) ? parsed.recentColors : [],
      palettes: Array.isArray(parsed.palettes) ? parsed.palettes : [],
    };
  } catch {
    return { ...DEFAULT_COLOR_PICKER_STATE };
  }
}

export async function saveColorPickerState(state: ColorPickerState): Promise<void> {
  await AsyncStorage.setItem(K().colorPicker, JSON.stringify(state));
}

// ─── Export ───────────────────────────────────────────────────────────────────

// exportProject — accepts 2 args (format as string) used by design-canvas.tsx
export async function exportProject(
  projectId: string,
  format: string,
  size: ExportSizeKind = 'original',
): Promise<DesignExport> {
  await delay(800);
  return {
    id: uid('export'),
    projectId,
    format: format as ExportFormatKind,
    size,
    uri: `mock://export/${projectId}/${format}/${size}`,
    createdAt: new Date().toISOString(),
  };
}

// ─── AI API helpers ───────────────────────────────────────────────────────────

async function callGenerateAPI(endpoint: string, body: object): Promise<string> {
  // AI design actions require an authenticated seller. Never silently retry
  // without auth because that can disconnect generated assets from their owner.
  const data = await serviceRequest<{ b64_json: string }>(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return `data:image/png;base64,${data.b64_json}`;
}

function inferImageMime(uri: string, reportedMime?: string): string {
  const normalized = (reportedMime ?? '').toLowerCase();
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp') return normalized;
  const path = uri.split('?')[0].toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/** Read a local, blob, data, or remote image URI into the API's data-URL contract. */
async function imageUriToDataUrl(uri: string): Promise<string> {
  if (!uri || uri.startsWith('mock://')) {
    throw new Error('A real source image is required.');
  }
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(uri)) {
    return uri;
  }

  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read the selected image.');
  const sourceBlob = await response.blob();
  if (sourceBlob.size <= 0) throw new Error('The selected image is empty.');
  if (sourceBlob.size > 8 * 1024 * 1024) throw new Error('Each reference image must be under 8MB.');
  const mime = inferImageMime(uri, sourceBlob.type);
  const typedBlob = sourceBlob.type === mime ? sourceBlob : sourceBlob.slice(0, sourceBlob.size, mime);

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not convert the selected image.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not convert the selected image.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(typedBlob);
  });
}

/** Generate N real images in parallel. Provider failures are surfaced to the UI. */
async function generateN(
  endpoint: string,
  body: object,
  count: number,
): Promise<string[]> {
  const jobs = Array.from({ length: count }, () => callGenerateAPI(endpoint, body));
  return Promise.all(jobs);
}

function makeResult(prompt: string, style: AIStyleKind, imageUris: string[]): AIGenerationResult {
  const now = new Date().toISOString();
  return {
    id: uid('gen'),
    prompt,
    style,
    imageUris,
    resultUri: imageUris[0] ?? '',
    createdAt: now,
    generatedAt: now,
  };
}

// Export type aliases so existing files can import them from this module
export type { GenerateDesignResult } from './designTypes';
export type { GenerateMockupResult } from './designTypes';
export type { GeneratePhotoshootResult } from './designTypes';
export type {
  MockupToModelBatchResult,
  MockupToModelRefResult,
  MockupToModelRefError,
} from './designTypes';

export async function generateDesignFromText(req: AIGenerationRequest): Promise<GenerateDesignResult> {
  const count = req.count ?? 4;
  const prompt = [
    req.prompt,
    req.style ? `Style: ${req.style}` : '',
    req.garmentType ? `Garment type: ${req.garmentType}` : '',
    req.placement ? `Placement: ${req.placement}` : '',
    req.colorPalette ? `Color palette: ${req.colorPalette}` : '',
    req.textContent ? `Include text: "${req.textContent}"` : '',
  ].filter(Boolean).join('. ');
  const referenceImage = req.referenceUri ? await imageUriToDataUrl(req.referenceUri) : undefined;
  const imageUris = await generateN('/mockup/generate', {
    prompt,
    mode: 'text_to_design',
    ...(referenceImage ? { referenceImage } : {}),
  }, count);
  return makeResult(req.prompt, req.style, imageUris);
}

// generateSketchToDesign — accepts an object (used by design-upload-sketch.tsx)
export async function generateSketchToDesign(req: {
  sketchUri: string;
  style: AIStyleKind;
  colorPalette?: string;
  count?: number;
}): Promise<GenerateDesignResult> {
  const count = req.count ?? 4;
  const prompt = `Convert this sketch to a garment design. Style: ${req.style}${req.colorPalette ? `. Colors: ${req.colorPalette}` : ''}.`;
  const referenceImage = await imageUriToDataUrl(req.sketchUri);
  const imageUris = await generateN('/mockup/generate', {
    prompt,
    referenceImage,
    mode: 'sketch_to_design',
  }, count);
  return makeResult(prompt, req.style, imageUris);
}

// generateMockupToModel — accepts an object (used by design-mockup-to-model.tsx)
// New contract: one mockup + 1–5 references → one output per reference.
// Returns per-reference results with stable indices; surfaces partial failures.
export async function generateMockupToModel(req: {
  mockupUri: string;
  referenceUris: string[];
  prompt?: string;
}): Promise<MockupToModelBatchResult> {
  if (!req.mockupUri) throw new Error('A garment mockup image is required.');
  if (!Array.isArray(req.referenceUris) || req.referenceUris.length === 0) {
    throw new Error('At least one reference model image is required.');
  }
  if (req.referenceUris.length > 5) {
    throw new Error('You can upload at most 5 reference images.');
  }

  const mockup = await imageUriToDataUrl(req.mockupUri);
  const references = await Promise.all(req.referenceUris.map(imageUriToDataUrl));

  const data = await serviceRequest<{
    results: Array<{ refIndex: number; b64_json: string }>;
    errors?: Array<{ refIndex: number; error: string; retryable: boolean }>;
  }>('/photography/mockup-to-model', {
    method: 'POST',
    body: JSON.stringify({
      mockup,
      references,
      ...(req.prompt ? { prompt: req.prompt } : {}),
    }),
  });

  return {
    results: data.results.map(r => ({
      refIndex: r.refIndex,
      imageUri: `data:image/png;base64,${r.b64_json}`,
    })),
    errors: data.errors ?? [],
  };
}

// retryMockupToModelRef — retry a single failed reference index
export async function retryMockupToModelRef(req: {
  mockupUri: string;
  referenceUri: string;
  refIndex: number;
  prompt?: string;
}): Promise<{ refIndex: number; imageUri: string }> {
  const mockup = await imageUriToDataUrl(req.mockupUri);
  const reference = await imageUriToDataUrl(req.referenceUri);
  const data = await serviceRequest<{ refIndex: number; b64_json: string }>(
    '/photography/mockup-to-model/retry',
    {
      method: 'POST',
      body: JSON.stringify({
        mockup,
        reference,
        refIndex: req.refIndex,
        ...(req.prompt ? { prompt: req.prompt } : {}),
      }),
    },
  );
  return { refIndex: data.refIndex, imageUri: `data:image/png;base64,${data.b64_json}` };
}

// generatePhotoshoot — accepts an object (used by design-ai-photoshoot.tsx)
export async function generatePhotoshoot(req: {
  productId?: string;
  modelStyle?: string;
  sceneStyle?: string;
  lightingStyle?: string;
  outputFormat?: string;
  imageRatio?: string;
  count?: number;
}): Promise<GeneratePhotoshootResult> {
  if (!req.productId) throw new Error('Choose a product with at least one photo.');
  const count = req.count ?? 4;
  const prompt = `Professional product photography. Scene: ${req.sceneStyle ?? 'studio'}. Model: ${req.modelStyle ?? 'female'}. Lighting: ${req.lightingStyle ?? 'natural'}. Format: ${req.outputFormat ?? 'product_page'}. Clean, commercial fashion shoot.`;
  const product = await serviceRequest<{ images?: unknown }>(
    `/api/products/${encodeURIComponent(req.productId)}`,
  );
  const productImageUris = Array.isArray(product.images)
    ? product.images.filter((uri): uri is string => typeof uri === 'string' && uri.length > 0).slice(0, 4)
    : [];
  if (productImageUris.length === 0) throw new Error('This product does not have any photos to use.');
  const referenceImages = await Promise.all(productImageUris.map(imageUriToDataUrl));
  const imageUris = await generateN('/photography/generate', {
    images: referenceImages,
    prompt,
    mode: 'photoshoot',
  }, count);
  return makeResult(prompt, 'editorial' as AIStyleKind, imageUris);
}

// applyPromptEdit — accepts an object (used by design-prompt-edit.tsx)
export async function applyPromptEdit(req: {
  imageUri: string;
  prompt: string;
  preserveProduct?: boolean;
  preserveLogo?: boolean;
  preserveGarmentColor?: boolean;
}): Promise<AIGenerationResult> {
  const prompt = `Edit garment design: ${req.prompt}. ${req.preserveProduct ? 'Keep product shape.' : ''} ${req.preserveLogo ? 'Keep the original logo and artwork unless explicitly changed.' : ''} ${req.preserveGarmentColor ? 'Keep original colors.' : ''}`.trim();
  const referenceImage = await imageUriToDataUrl(req.imageUri);
  const imageUris = await generateN('/mockup/generate', {
    prompt,
    referenceImage,
    mode: 'prompt_edit',
  }, 1);
  return makeResult(req.prompt, 'custom' as AIStyleKind, imageUris);
}

// removeBackgroundFromImage — returns a string URI (used by design-bg-removal.tsx)
export async function removeBackgroundFromImage(imageUri: string): Promise<string> {
  const image = await imageUriToDataUrl(imageUri);
  return callGenerateAPI('/bg-removal/remove', { image });
}

// replaceBackground — accepts an object (used by design-bg-replace.tsx)
export async function replaceBackground(req: {
  imageUri: string;
  bgType?: string;
  color?: string;
  prompt?: string;
  backgroundImageUri?: string;
}): Promise<{ resultUri: string }> {
  const image = await imageUriToDataUrl(req.imageUri);
  const backgroundImage = req.backgroundImageUri
    ? await imageUriToDataUrl(req.backgroundImageUri)
    : undefined;
  const resultUri = await callGenerateAPI('/bg-removal/replace', {
    image,
    ...(backgroundImage ? { backgroundImage } : {}),
    bgType: req.bgType,
    color: req.color,
    prompt: req.prompt,
  });
  return { resultUri };
}

export async function generateCampaign(
  productId: string | undefined,
  style: AIStyleKind,
  headline: string,
  cta: string,
  formats: CampaignFormatKind[],
): Promise<CampaignProject> {
  await delay(2000);
  const now = new Date().toISOString();
  const assets: CampaignAsset[] = formats.map(format => ({
    id: uid('asset'),
    format,
    imageUri: `mock://campaign/${format}`,
    resultUri: `mock://campaign/${format}`,
    headline,
    cta,
  }));
  return {
    id: uid('campaign'),
    projectId: uid('proj'),
    productId,
    assets,
    headline,
    cta,
    style,
    formats,
    createdAt: now,
  };
}
