/**
 * Brandthread Design Studio — Service Layer
 * All AsyncStorage CRUD + mock AI functions.
 * No dynamic await import(). All types from './designTypes'.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '@/lib/serviceConfig';
import {
  DesignProject, DesignProjectType, DesignProjectStatus, DesignCanvas,
  DesignLayer, DesignVersion, DesignVersionMeta, BrandAsset, BrandAssetTypeKind,
  AIGenerationRequest, AIGenerationResult, AIPhotoshootRequest,
  GenerateDesignResult, GenerateMockupResult, GeneratePhotoshootResult,
  AIStyleKind, CampaignFormatKind, CampaignProject, CampaignAsset,
  DesignExport, ExportFormatKind, ExportSizeKind, GarmentType,
} from './designTypes';

// ─── Storage Keys ─────────────────────────────────────────────────────────────
const DS_PROJECTS_KEY = 'bt:design:projects:v1';
const DS_ASSETS_KEY   = 'bt:design:brand-assets:v1';
const DS_VERSIONS_KEY = 'bt:design:versions:v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────
let _idCounter = 0;
function uid(prefix = 'id'): string {
  _idCounter += 1;
  return `${prefix}_${Date.now()}_${_idCounter}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function saveProjects(arr: DesignProject[]): Promise<void> {
  await AsyncStorage.setItem(DS_PROJECTS_KEY, JSON.stringify(arr));
}

async function loadProjects(): Promise<DesignProject[]> {
  const raw = await AsyncStorage.getItem(DS_PROJECTS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as DesignProject[]; } catch { return []; }
}

async function saveVersions(arr: DesignVersion[]): Promise<void> {
  await AsyncStorage.setItem(DS_VERSIONS_KEY, JSON.stringify(arr));
}

async function loadVersions(): Promise<DesignVersion[]> {
  const raw = await AsyncStorage.getItem(DS_VERSIONS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as DesignVersion[]; } catch { return []; }
}

async function saveAssets(arr: BrandAsset[]): Promise<void> {
  await AsyncStorage.setItem(DS_ASSETS_KEY, JSON.stringify(arr));
}

async function loadAssets(): Promise<BrandAsset[]> {
  const raw = await AsyncStorage.getItem(DS_ASSETS_KEY);
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

async function seedIfEmpty(): Promise<DesignProject[]> {
  const existing = await loadProjects();
  if (existing.length > 0) return existing;
  const seeds: DesignProject[] = [
    makeSeedProject('Spring Drop Hoodie', 'garment', 'saved', {
      garmentType: 'hoodie',
      garmentColor: '#1A1A2E',
    }),
    makeSeedProject('Product Launch Mockup', 'mockup', 'draft'),
    makeSeedProject('Campaign Assets', 'campaign', 'exported'),
  ];
  await saveProjects(seeds);
  return seeds;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

/**
 * Returns only non-deleted projects (normal navigation).
 */
export async function getProjects(): Promise<DesignProject[]> {
  const all = await seedIfEmpty();
  return all.filter(p => !p.deletedAt);
}

/**
 * Returns a project by id regardless of soft-delete state.
 * The canvas editor uses this so an id in the URL always resolves.
 */
export async function getProject(id: string): Promise<DesignProject | null> {
  const projects = await loadProjects();
  return projects.find(p => p.id === id) ?? null;
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
  const projects = await seedIfEmpty();
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
  await saveProjects([...projects, project]);
  return project;
}

export async function updateProject(id: string, partial: Partial<DesignProject>): Promise<DesignProject> {
  const projects = await loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) throw new Error(`Project ${id} not found`);
  const updated: DesignProject = { ...projects[idx], ...partial, id, updatedAt: new Date().toISOString() };
  projects[idx] = updated;
  await saveProjects(projects);
  return updated;
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
  const projects = await loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) throw new Error(`Project ${id} not found`);
  const { deletedAt: _removed, ...rest } = projects[idx];
  const updated: DesignProject = { ...rest, updatedAt: new Date().toISOString() };
  projects[idx] = updated;
  await saveProjects(projects);
  return updated;
}

/**
 * Permanently delete — removes from storage with no recovery path.
 */
export async function deleteProject(id: string): Promise<void> {
  const projects = await loadProjects();
  await saveProjects(projects.filter(p => p.id !== id));
}

/**
 * Permanently delete all soft-deleted projects.
 */
export async function purgeDeletedProjects(): Promise<void> {
  const projects = await loadProjects();
  await saveProjects(projects.filter(p => !p.deletedAt));
}

export async function duplicateProject(id: string): Promise<DesignProject> {
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
  const projects = await loadProjects();
  await saveProjects([...projects, copy]);
  return copy;
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
export async function generateMockupToModel(req: {
  mockupUri: string;
  modelStyle?: string;
  sceneStyle?: string;
  lightingStyle?: string;
  imageRatio?: string;
  count?: number;
}): Promise<GenerateMockupResult> {
  const count = req.count ?? 4;
  const prompt = `Fashion model wearing the uploaded garment design. Model: ${req.modelStyle ?? 'female'}. Scene: ${req.sceneStyle ?? 'studio'}. Lighting: ${req.lightingStyle ?? 'natural'}. Professional clothing photography.`;
  const referenceImage = await imageUriToDataUrl(req.mockupUri);
  const imageUris = await generateN('/photography/generate', {
    images: [referenceImage],
    prompt,
    mode: 'mockup_to_model',
  }, count);
  return makeResult(prompt, 'minimal' as AIStyleKind, imageUris);
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
