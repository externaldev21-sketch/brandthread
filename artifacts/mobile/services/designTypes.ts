// ─── Brandthread Design Studio — Type Definitions ────────────────────────────

// Enums / string unions
export type DesignProjectType = 'garment' | 'canvas' | 'mockup' | 'campaign' | 'social' | 'packaging';
export type DesignProjectStatus = 'draft' | 'saved' | 'exported' | 'sent_product' | 'sent_manufacturer' | 'archived';
export type DesignLayerType = 'drawing' | 'text' | 'image' | 'shape' | 'group';
export type GarmentType = 'tshirt' | 'hoodie' | 'sweatshirt' | 'sweatpants' | 'shorts' | 'jacket' | 'denim' | 'hat' | 'bag' | 'packaging';
export type GarmentView = 'front' | 'back' | 'side' | 'detail';
export type PlacementType = 'center_chest' | 'left_chest' | 'full_front' | 'full_back' | 'upper_back' | 'sleeve' | 'pocket' | 'neck_label' | 'hem_label' | 'custom';
export type ShapeKind = 'rect' | 'circle' | 'triangle' | 'line' | 'star';
export type BlendModeKind = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';
export type EffectKind = 'shadow' | 'blur' | 'glow' | 'outline' | 'grayscale' | 'contrast' | 'brightness' | 'saturation' | 'tint';
export type CanvasPresetId = 'square' | 'portrait' | 'landscape' | 'story' | 'post' | 'product' | 'print' | 'custom';

// AIStyleKind — union of all styles referenced across screens
export type AIStyleKind =
  | 'streetwear' | 'luxury' | 'minimal' | 'vintage' | 'y2k' | 'techwear'
  | 'handdrawn' | 'gothic' | 'athletic' | 'editorial' | 'custom'
  | 'minimalist' | 'bold' | 'athleisure' | 'avant_garde';

export type ModelStyleKind = 'male' | 'female' | 'androgynous' | 'no_face' | 'flat_lay' | 'mannequin' | 'product_only';
export type SceneStyleKind = 'studio' | 'street' | 'luxury_interior' | 'outdoor' | 'industrial' | 'minimal' | 'runway' | 'night' | 'custom';
export type LightingStyleKind = 'natural' | 'softbox' | 'dramatic' | 'flash' | 'golden_hour' | 'neon' | 'bw';

// BrandAssetTypeKind — also aliased as BrandAssetType for compat
export type BrandAssetTypeKind = 'logo' | 'icon' | 'font' | 'color' | 'pattern' | 'graphic' | 'photo' | 'mockup' | 'packaging' | 'text_style';
export type BrandAssetType = BrandAssetTypeKind;

export type ExportFormatKind = 'png' | 'jpg' | 'transparent_png' | 'pdf' | 'project';
export type ExportSizeKind = 'original' | 'web' | 'product' | 'story' | 'thread_post' | 'print';

// CampaignFormatKind — union of all formats referenced across screens
export type CampaignFormatKind =
  | 'thread_post' | 'story' | 'store_hero' | 'product_banner' | 'email_banner'
  | 'ad_creative' | 'square_post' | 'portrait_post'
  | 'ig_post' | 'ig_story' | 'ig_reel_cover' | 'twitter_post' | 'fb_post'
  | 'product_card' | 'billboard';

export type ImageRatioKind = '9:16' | '4:5' | '1:1' | '3:4';

// ─── Layer Data ───────────────────────────────────────────────────────────────

export interface DrawPath { d: string; color: string; width: number; opacity: number; tool: string; }

export interface DesignTransform {
  x: number; y: number; width: number; height: number;
  rotation: number; scaleX: number; scaleY: number; opacity?: number;
  /** Visual-only mirror flags — applied as SVG translate/scale in compositor. */
  flipX?: boolean;
  flipY?: boolean;
  transform?: { rotation?: number };
  /** Distort/Warp: serialized SVG matrix string (applied INSTEAD of standard position). */
  affineSvgMatrix?: string;
  /** Distort: serialized DistortQuad JSON string. */
  distortQuad?: string;
  /** Warp: serialized WarpMeshPoint[] JSON string. */
  warpMesh?: string;
  /** Liquify net displacement in logical units (applied as additional translate). */
  liquifyDx?: number;
  liquifyDy?: number;
}

export interface DesignEffect { type: EffectKind; value: number; color?: string; }

// DesignTextLayer — supports both canonical (text/textColor/alignment) and canvas-canvas (content/color/align)
export interface DesignTextLayer {
  kind: 'text';
  // canonical fields
  text?: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: string;
  textColor?: string;
  alignment?: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineSpacing?: number;
  outlineColor?: string;
  outlineWidth?: number;
  hasShadow?: boolean;
  hasBackground?: boolean;
  bgColor?: string;
  // canvas-editor fields (legacy compat)
  content?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
}

export interface DesignImageLayer {
  kind: 'image';
  uri: string;
  cropX?: number; cropY?: number; cropWidth?: number; cropHeight?: number;
  blendMode?: BlendModeKind;
  hasBgRemoved?: boolean;
  opacity?: number;
  fit?: string;
}

// DesignShapeLayer — supports both canonical (fillColor/strokeColor) and canvas-editor (fill/stroke/cornerRadius)
export interface DesignShapeLayer {
  kind: 'shape';
  shape: ShapeKind | 'rect' | 'circle' | 'triangle';
  // canonical
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  // canvas-editor compat
  fill?: string;
  stroke?: string;
  cornerRadius?: number;
}

export interface DesignDrawingLayer {
  kind: 'drawing';
  paths: DrawPath[];
  brushType?: string;
}

export type DesignLayerData = DesignTextLayer | DesignImageLayer | DesignShapeLayer | DesignDrawingLayer;

export interface DesignLayer {
  id: string;
  name: string;
  type: DesignLayerType;
  visible: boolean;
  locked: boolean;
  order: number;
  transform: DesignTransform;
  effects?: DesignEffect[];
  data: DesignLayerData;
  opacity: number;
  createdAt: string;
  updatedAt: string;
  /** Persisted adjustments (curves, liquify). Added by AdjustmentsTool. */
  adjustments?: import('../lib/adjustmentsModel').DesignLayerAdjustments;
}

export interface DesignCanvas {
  width: number;
  height: number;
  backgroundHex: string;
  backgroundImageUri?: string;
  backgroundOpacity?: number;
}

export interface GarmentPlacement {
  id: string;
  placementType: PlacementType;
  garmentView: GarmentView;
  x: number; y: number; width: number; height: number;
  layerIds: string[];
}

export interface DesignProject {
  id: string;
  name: string;
  type: DesignProjectType;
  status: DesignProjectStatus;
  canvas: DesignCanvas;
  layers: DesignLayer[];
  garmentType?: GarmentType;
  garmentColor?: string;
  garmentView?: GarmentView;
  placements?: GarmentPlacement[];
  linkedProductId?: string;
  linkedManufacturerId?: string;
  thumbnail?: string;
  versions?: string[];
  undoStack?: string[];
  redoStack?: string[];
  createdAt: string;
  updatedAt: string;
  /** Soft-delete: timestamp of when the project was moved to Recently Deleted. */
  deletedAt?: string;
}

// DesignVersion — canonical version with snapshot
export interface DesignVersion {
  id: string;
  projectId: string;
  snapshot: DesignProject;
  label: string;
  autoSaved: boolean;
  createdAt: string;
}

// DesignVersionMeta — alias for DesignVersion (backward compat)
export type DesignVersionMeta = DesignVersion;

export interface BrandAsset {
  id: string;
  name: string;
  type: BrandAssetTypeKind;
  uri?: string;
  color?: string;
  fontFamily?: string;
  tags: string[];
  createdAt: string;
}

export interface AIGenerationRequest {
  prompt: string;
  style: AIStyleKind;
  garmentType?: GarmentType | null;
  placement?: PlacementType | null;
  colorPalette?: string | null;
  textContent?: string | null;
  referenceUri?: string | null;
  count: number;
}

// AIGenerationResult — satisfies both canonical and existing screen usages
export interface AIGenerationResult {
  id: string;
  prompt: string;
  style?: AIStyleKind;
  imageUris: string[];
  resultUri?: string;
  createdAt: string;
  generatedAt?: string;
  // photoshoot/mockup fields
  modelStyle?: string;
  sceneStyle?: string;
}

// GenerateDesignResult — type alias used by design-text-to-design & design-upload-sketch
export type GenerateDesignResult = AIGenerationResult;

// GenerateMockupResult — type alias used by design-mockup-to-model
export type GenerateMockupResult = AIGenerationResult;

// GeneratePhotoshootResult — type alias used by design-ai-photoshoot
export type GeneratePhotoshootResult = AIGenerationResult;

export interface AIPhotoshootRequest {
  productId?: string;
  modelStyle: ModelStyleKind;
  sceneStyle?: SceneStyleKind;
  scene?: SceneStyleKind;
  lightingStyle?: LightingStyleKind;
  lighting?: LightingStyleKind;
  outputFormat?: string;
  output?: string;
  imageRatio: ImageRatioKind;
  count: number;
}

export interface CampaignAsset {
  id: string;
  format: CampaignFormatKind;
  imageUri?: string;
  resultUri?: string;
  headline?: string;
  cta?: string;
}

export interface CampaignProject {
  id: string;
  projectId?: string;
  productId?: string;
  productName?: string;
  assets: CampaignAsset[];
  headline: string;
  cta: string;
  style: AIStyleKind;
  formats?: CampaignFormatKind[];
  createdAt: string;
}

export interface DesignExport {
  id: string;
  projectId: string;
  format: ExportFormatKind;
  size: ExportSizeKind;
  uri?: string;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const GARMENT_TYPES: { value: GarmentType; label: string; icon: string }[] = [
  { value: 'tshirt',      label: 'T-Shirt',     icon: 'shirt' },
  { value: 'hoodie',      label: 'Hoodie',       icon: 'layers' },
  { value: 'sweatshirt',  label: 'Sweatshirt',   icon: 'layers' },
  { value: 'sweatpants',  label: 'Sweatpants',   icon: 'minus' },
  { value: 'shorts',      label: 'Shorts',       icon: 'minus' },
  { value: 'jacket',      label: 'Jacket',       icon: 'layers' },
  { value: 'denim',       label: 'Denim',        icon: 'layers' },
  { value: 'hat',         label: 'Hat',          icon: 'circle' },
  { value: 'bag',         label: 'Bag',          icon: 'shopping-bag' },
  { value: 'packaging',   label: 'Packaging',    icon: 'box' },
];

export const GARMENT_VIEWS: { value: GarmentView; label: string }[] = [
  { value: 'front',  label: 'Front' },
  { value: 'back',   label: 'Back' },
  { value: 'side',   label: 'Side' },
  { value: 'detail', label: 'Detail' },
];

export const PLACEMENT_TYPES: { value: PlacementType; label: string }[] = [
  { value: 'center_chest', label: 'Center Chest' },
  { value: 'left_chest',   label: 'Left Chest' },
  { value: 'full_front',   label: 'Full Front' },
  { value: 'full_back',    label: 'Full Back' },
  { value: 'upper_back',   label: 'Upper Back' },
  { value: 'sleeve',       label: 'Sleeve' },
  { value: 'pocket',       label: 'Pocket' },
  { value: 'neck_label',   label: 'Neck Label' },
  { value: 'hem_label',    label: 'Hem Label' },
  { value: 'custom',       label: 'Custom' },
];

export const AI_STYLES: { value: AIStyleKind; label: string }[] = [
  { value: 'streetwear', label: 'Streetwear' },
  { value: 'luxury',     label: 'Luxury' },
  { value: 'minimal',    label: 'Minimal' },
  { value: 'vintage',    label: 'Vintage' },
  { value: 'y2k',        label: 'Y2K' },
  { value: 'techwear',   label: 'Techwear' },
  { value: 'handdrawn',  label: 'Hand-drawn' },
  { value: 'gothic',     label: 'Gothic' },
  { value: 'athletic',   label: 'Athletic' },
  { value: 'editorial',  label: 'Editorial' },
  { value: 'custom',     label: 'Custom' },
];

export const CANVAS_PRESETS: { id: CanvasPresetId; label: string; width: number; height: number; ratio?: string }[] = [
  { id: 'square',   label: 'Square',        width: 1080, height: 1080, ratio: '1:1' },
  { id: 'portrait', label: 'Portrait',      width: 1080, height: 1350, ratio: '4:5' },
  { id: 'landscape',label: 'Landscape',     width: 1920, height: 1080, ratio: '16:9' },
  { id: 'story',    label: 'Story',         width: 1080, height: 1920, ratio: '9:16' },
  { id: 'post',     label: 'Post',          width: 1080, height: 1350, ratio: '4:5' },
  { id: 'product',  label: 'Product Image', width: 2000, height: 2000, ratio: '1:1' },
  { id: 'print',    label: 'Print',         width: 3300, height: 5100, ratio: 'Letter' },
  { id: 'custom',   label: 'Custom Size',   width: 1080, height: 1080 },
];

export const GARMENT_TEMPLATES: {
  garmentType: GarmentType;
  label: string;
  views: GarmentView[];
  hasEmbroideryArea: boolean;
  hasPrintArea: boolean;
  defaultColor: string;
}[] = [
  { garmentType: 'tshirt',     label: 'T-Shirt',       views: ['front', 'back', 'detail'],             hasEmbroideryArea: true,  hasPrintArea: true,  defaultColor: '#FFFFFF' },
  { garmentType: 'hoodie',     label: 'Hoodie',         views: ['front', 'back', 'side', 'detail'],     hasEmbroideryArea: true,  hasPrintArea: true,  defaultColor: '#1A1A2E' },
  { garmentType: 'sweatshirt', label: 'Sweatshirt',     views: ['front', 'back', 'detail'],             hasEmbroideryArea: true,  hasPrintArea: true,  defaultColor: '#2D2D2D' },
  { garmentType: 'sweatpants', label: 'Sweatpants',     views: ['front', 'back'],                       hasEmbroideryArea: false, hasPrintArea: true,  defaultColor: '#3A3A3A' },
  { garmentType: 'shorts',     label: 'Shorts',         views: ['front', 'back'],                       hasEmbroideryArea: false, hasPrintArea: true,  defaultColor: '#1E1E1E' },
  { garmentType: 'jacket',     label: 'Jacket',         views: ['front', 'back', 'side', 'detail'],     hasEmbroideryArea: true,  hasPrintArea: true,  defaultColor: '#0D0D0D' },
  { garmentType: 'denim',      label: 'Denim',          views: ['front', 'back', 'detail'],             hasEmbroideryArea: true,  hasPrintArea: false, defaultColor: '#1A237E' },
  { garmentType: 'hat',        label: 'Hat',            views: ['front', 'side', 'detail'],             hasEmbroideryArea: true,  hasPrintArea: false, defaultColor: '#212121' },
  { garmentType: 'bag',        label: 'Bag',            views: ['front', 'side', 'detail'],             hasEmbroideryArea: true,  hasPrintArea: true,  defaultColor: '#F5F5F5' },
  { garmentType: 'packaging',  label: 'Packaging',      views: ['front', 'back', 'side', 'detail'],     hasEmbroideryArea: false, hasPrintArea: true,  defaultColor: '#FAFAFA' },
  { garmentType: 'tshirt',     label: 'Crop Top',       views: ['front', 'back'],                       hasEmbroideryArea: false, hasPrintArea: true,  defaultColor: '#FFFFFF' },
  { garmentType: 'hoodie',     label: 'Zip Hoodie',     views: ['front', 'back', 'detail'],             hasEmbroideryArea: true,  hasPrintArea: true,  defaultColor: '#2C2C2C' },
  { garmentType: 'shorts',     label: 'Board Shorts',   views: ['front', 'back'],                       hasEmbroideryArea: false, hasPrintArea: true,  defaultColor: '#0A4B7A' },
  { garmentType: 'jacket',     label: 'Bomber Jacket',  views: ['front', 'back', 'detail'],             hasEmbroideryArea: true,  hasPrintArea: true,  defaultColor: '#1B1B1B' },
];

export const MODEL_STYLES: { value: ModelStyleKind; label: string }[] = [
  { value: 'male',         label: 'Male model' },
  { value: 'female',       label: 'Female model' },
  { value: 'androgynous',  label: 'Androgynous model' },
  { value: 'no_face',      label: 'No visible face' },
  { value: 'flat_lay',     label: 'Flat lay' },
  { value: 'mannequin',    label: 'Mannequin' },
  { value: 'product_only', label: 'Product only' },
];

export const SCENE_STYLES: { value: SceneStyleKind; label: string }[] = [
  { value: 'studio',           label: 'Studio' },
  { value: 'street',           label: 'Street' },
  { value: 'luxury_interior',  label: 'Luxury interior' },
  { value: 'outdoor',          label: 'Outdoor' },
  { value: 'industrial',       label: 'Industrial' },
  { value: 'minimal',          label: 'Minimal' },
  { value: 'runway',           label: 'Runway' },
  { value: 'night',            label: 'Night' },
  { value: 'custom',           label: 'Custom' },
];

export const LIGHTING_STYLES: { value: LightingStyleKind; label: string }[] = [
  { value: 'natural',      label: 'Natural' },
  { value: 'softbox',      label: 'Softbox' },
  { value: 'dramatic',     label: 'Dramatic' },
  { value: 'flash',        label: 'Flash' },
  { value: 'golden_hour',  label: 'Golden hour' },
  { value: 'neon',         label: 'Neon' },
  { value: 'bw',           label: 'Black & white' },
];

export const CAMPAIGN_FORMATS: { value: CampaignFormatKind; label: string; dims: string }[] = [
  { value: 'thread_post',    label: 'Thread Post',     dims: '4:5' },
  { value: 'story',          label: 'Story',           dims: '9:16' },
  { value: 'store_hero',     label: 'Store Hero',      dims: '16:9' },
  { value: 'product_banner', label: 'Product Banner',  dims: '3:1' },
  { value: 'email_banner',   label: 'Email Banner',    dims: '3:1' },
  { value: 'ad_creative',    label: 'Ad Creative',     dims: '1:1' },
  { value: 'square_post',    label: 'Square Post',     dims: '1:1' },
  { value: 'portrait_post',  label: 'Portrait Post',   dims: '4:5' },
];

export const BRAND_ASSET_TYPES: { value: BrandAssetTypeKind; label: string; icon: string; key: string; type: BrandAssetTypeKind }[] = [
  { value: 'logo',       label: 'Logo',        icon: 'image',     key: 'logo',       type: 'logo' },
  { value: 'icon',       label: 'Icon',        icon: 'star',      key: 'icon',       type: 'icon' },
  { value: 'font',       label: 'Font',        icon: 'type',      key: 'font',       type: 'font' },
  { value: 'color',      label: 'Color',       icon: 'droplet',   key: 'color',      type: 'color' },
  { value: 'pattern',    label: 'Pattern',     icon: 'grid',      key: 'pattern',    type: 'pattern' },
  { value: 'graphic',    label: 'Graphic',     icon: 'layers',    key: 'graphic',    type: 'graphic' },
  { value: 'photo',      label: 'Photo',       icon: 'camera',    key: 'photo',      type: 'photo' },
  { value: 'mockup',     label: 'Mockup',      icon: 'box',       key: 'mockup',     type: 'mockup' },
  { value: 'packaging',  label: 'Packaging',   icon: 'package',   key: 'packaging',  type: 'packaging' },
  { value: 'text_style', label: 'Text Style',  icon: 'align-left',key: 'text_style', type: 'text_style' },
];

export const PROJECT_STATUS_LABELS: Record<DesignProjectStatus, string> = {
  draft: 'Draft',
  saved: 'Saved',
  exported: 'Exported',
  sent_product: 'Sent to Product',
  sent_manufacturer: 'Sent to Manufacturer',
  archived: 'Archived',
};

export const PROJECT_TYPE_LABELS: Record<DesignProjectType, string> = {
  garment:   'Garment Design',
  canvas:    'Free Canvas',
  mockup:    'Product Mockup',
  campaign:  'Campaign',
  social:    'Social Content',
  packaging: 'Packaging',
};

export const DEFAULT_TRANSFORM: DesignTransform = {
  x: 50, y: 50, width: 200, height: 100,
  rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
};

// ─── Seller-specific Canvas Presets ──────────────────────────────────────────

export interface SellerCanvasPreset {
  id: string;
  label: string;
  description: string;
  width: number;
  height: number;
  dpi?: number;
  colorProfile?: 'sRGB' | 'P3' | 'CMYK';
  transparentBg?: boolean;
}

export const SELLER_CANVAS_PRESETS: SellerCanvasPreset[] = [
  {
    id: 'product_photo',
    label: 'Product Photo',
    description: '2048 x 2048 px — sRGB',
    width: 2048, height: 2048, dpi: 72, colorProfile: 'sRGB',
  },
  {
    id: 'ig_post',
    label: 'Instagram Post',
    description: '1080 x 1080 px',
    width: 1080, height: 1080, dpi: 72, colorProfile: 'sRGB',
  },
  {
    id: 'ig_story',
    label: 'Instagram Story',
    description: '1080 x 1920 px',
    width: 1080, height: 1920, dpi: 72, colorProfile: 'sRGB',
  },
  {
    id: 'tshirt_print',
    label: 'T-Shirt Print Area',
    description: '4500 x 5400 px — 300 dpi',
    width: 4500, height: 5400, dpi: 300, colorProfile: 'sRGB',
  },
  {
    id: 'poster_18x24',
    label: 'Poster 18 x 24 in',
    description: '5400 x 7200 px — 300 dpi',
    width: 5400, height: 7200, dpi: 300, colorProfile: 'sRGB',
  },
  {
    id: 'logo_sticker',
    label: 'Logo / Sticker',
    description: '1024 x 1024 px — transparent',
    width: 1024, height: 1024, dpi: 72, colorProfile: 'sRGB', transparentBg: true,
  },
];
