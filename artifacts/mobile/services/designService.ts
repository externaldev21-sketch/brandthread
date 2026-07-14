/**
 * Brandthread Design Studio — Service Layer
 * All AsyncStorage CRUD + mock AI functions.
 * No dynamic await import(). All types from './designTypes'.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
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

export async function getProjects(): Promise<DesignProject[]> {
  return seedIfEmpty();
}

export async function getProject(id: string): Promise<DesignProject | null> {
  const projects = await loadProjects();
  return projects.find(p => p.id === id) ?? null;
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

export async function deleteProject(id: string): Promise<void> {
  const projects = await loadProjects();
  await saveProjects(projects.filter(p => p.id !== id));
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

// ─── Mock AI Functions ────────────────────────────────────────────────────────

function makeResult(prompt: string, style: AIStyleKind, prefix: string, count = 4): AIGenerationResult {
  const uris = Array.from({ length: count }, (_, i) => `mock://${prefix}/${i + 1}`);
  const now = new Date().toISOString();
  return {
    id: uid('gen'),
    prompt,
    style,
    imageUris: uris,
    resultUri: uris[0],
    createdAt: now,
    generatedAt: now,
  };
}

// Export type aliases so existing files can import them from this module
export type { GenerateDesignResult } from './designTypes';
export type { GenerateMockupResult } from './designTypes';
export type { GeneratePhotoshootResult } from './designTypes';

export async function generateDesignFromText(req: AIGenerationRequest): Promise<GenerateDesignResult> {
  await delay(1500);
  return makeResult(req.prompt, req.style, 'generated', req.count);
}

// generateSketchToDesign — accepts an object (used by design-upload-sketch.tsx)
export async function generateSketchToDesign(req: {
  sketchUri: string;
  style: AIStyleKind;
  colorPalette?: string;
  count?: number;
}): Promise<GenerateDesignResult> {
  await delay(2000);
  return makeResult(`Sketch to design — ${req.sketchUri}`, req.style, 'sketch', req.count ?? 4);
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
  await delay(2000);
  return makeResult(`Mockup to model — ${req.mockupUri}`, 'minimal', 'mockup-model', req.count ?? 4);
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
  await delay(2500);
  return makeResult(
    `Photoshoot — ${req.sceneStyle ?? 'studio'} ${req.lightingStyle ?? 'natural'}`,
    'editorial',
    'photoshoot',
    req.count ?? 4,
  );
}

// applyPromptEdit — accepts an object (used by design-prompt-edit.tsx)
export async function applyPromptEdit(req: {
  imageUri: string;
  prompt: string;
  preserveProduct?: boolean;
  preserveLogo?: boolean;
  preserveGarmentColor?: boolean;
}): Promise<AIGenerationResult> {
  await delay(1500);
  return makeResult(req.prompt, 'custom', 'edited');
}

// removeBackgroundFromImage — returns a string URI (used by design-bg-removal.tsx)
export async function removeBackgroundFromImage(imageUri: string): Promise<string> {
  await delay(1200);
  return `mock://bg-removed/${Date.now()}`;
}

// replaceBackground — accepts an object (used by design-bg-replace.tsx)
export async function replaceBackground(req: {
  imageUri: string;
  bgType?: string;
  color?: string;
  prompt?: string;
}): Promise<{ resultUri: string }> {
  await delay(1200);
  return { resultUri: `mock://bg-replaced/${Date.now()}` };
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
