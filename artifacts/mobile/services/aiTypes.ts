/**
 * Brandthread AI Brain — Type Definitions
 *
 * All types for the unified AI system: messages, context, commands,
 * brand memory, audit log, settings, and home suggestions.
 */

// ─── Core ─────────────────────────────────────────────────────────────────────

export type AIRole = 'user' | 'assistant' | 'system';

export type AIActionType =
  | 'navigate' | 'search' | 'explain' | 'recommend' | 'generate'
  | 'edit' | 'preview' | 'apply' | 'create_draft' | 'duplicate'
  | 'filter' | 'compare' | 'summarize' | 'export' | 'schedule' | 'analyze';

export type AIActionStatus = 'pending' | 'previewing' | 'confirmed' | 'applied' | 'rejected' | 'undone';

export interface AIActionCard {
  id: string;
  type: AIActionType;
  title: string;
  description: string;
  impact?: string;
  requiresConfirmation: boolean;
  isDestructive: boolean;
  /** Before/after preview strings */
  beforePreview?: string;
  afterPreview?: string;
  /** Typed payload for validated execution */
  payload: Record<string, unknown>;
  canUndo: boolean;
  status: AIActionStatus;
}

export interface AIMessage {
  id: string;
  role: AIRole;
  content: string;
  ts: number;
  /** True while AI is streaming / generating */
  isStreaming?: boolean;
  /** Structured action attached to this message */
  actionCard?: AIActionCard;
  /** Error if the request failed */
  error?: string;
  /** Snapshot of what context was active when this message was sent */
  contextLabel?: string;
}

// ─── Screen Context ────────────────────────────────────────────────────────────

export type AIScreenContext =
  | { screen: 'home' }
  | { screen: 'products' }
  | { screen: 'product_detail'; productId: string; productName: string; price?: number; inventory?: number; category?: string }
  | { screen: 'orders' }
  | { screen: 'order_detail'; orderId: string; orderNumber: string; status: string; customerName?: string; total?: number }
  | { screen: 'analytics'; metric?: string; dateRange?: string }
  | { screen: 'store_builder'; sectionId?: string; pageName?: string; themeId?: string }
  | { screen: 'design_studio'; projectId?: string; projectName?: string; garmentType?: string }
  | { screen: 'content'; postId?: string; postType?: string }
  | { screen: 'inventory'; itemId?: string; itemName?: string }
  | { screen: 'manufacturer_hub'; manufacturerId?: string; manufacturerName?: string }
  | { screen: 'marketing'; campaignId?: string; campaignName?: string }
  | { screen: 'customers'; customerId?: string; customerName?: string; segment?: string }
  | { screen: 'settings' }
  | { screen: 'general' };

export function contextLabel(ctx: AIScreenContext): string {
  switch (ctx.screen) {
    case 'home':             return 'Seller Home';
    case 'products':         return 'Products';
    case 'product_detail':   return ctx.productName ?? 'Product';
    case 'orders':           return 'Orders';
    case 'order_detail':     return `Order ${ctx.orderNumber}`;
    case 'analytics':        return 'Analytics';
    case 'store_builder':    return 'Store Builder';
    case 'design_studio':    return ctx.projectName ? `Design · ${ctx.projectName}` : 'Design Studio';
    case 'content':          return 'Content';
    case 'inventory':        return ctx.itemName ? `Inventory · ${ctx.itemName}` : 'Inventory';
    case 'manufacturer_hub': return ctx.manufacturerName ?? 'Manufacturer Hub';
    case 'marketing':        return ctx.campaignName ? `Campaign · ${ctx.campaignName}` : 'Marketing';
    case 'customers':        return ctx.customerName ?? 'Customers';
    case 'settings':         return 'Settings';
    default:                 return 'Brandthread AI';
  }
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface AISession {
  id: string;
  messages: AIMessage[];
  context: AIScreenContext;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface AIChatRequest {
  messages: { role: AIRole; content: string }[];
  context: AIScreenContext;
  brandMemory?: BrandMemorySummary;
  maxTokens?: number;
}

export interface AIChatResponse {
  content: string;
  actionCard?: Omit<AIActionCard, 'id' | 'status'>;
  tokensUsed?: number;
  isDemo?: boolean;
  error?: string;
}

// ─── Brand Memory ─────────────────────────────────────────────────────────────

export interface BrandMemoryField {
  key: string;
  label: string;
  value: string;
  enabled: boolean;
}

export interface BrandMemory {
  brandDescription: BrandMemoryField;
  brandVoice: BrandMemoryField;
  targetAudience: BrandMemoryField;
  pricePosition: BrandMemoryField;
  visualStyle: BrandMemoryField;
  marketingTone: BrandMemoryField;
  preferredWords: BrandMemoryField;
  avoidedWords: BrandMemoryField;
  productCategories: BrandMemoryField;
  manufacturerPreferences: BrandMemoryField;
  storeStyle: BrandMemoryField;
  typography: BrandMemoryField;
}

export type BrandMemorySummary = Partial<Record<keyof BrandMemory, string>>;

export const DEFAULT_BRAND_MEMORY: BrandMemory = {
  brandDescription:        { key: 'brandDescription',        label: 'Brand description',        value: '', enabled: true  },
  brandVoice:              { key: 'brandVoice',              label: 'Brand voice',              value: '', enabled: true  },
  targetAudience:          { key: 'targetAudience',          label: 'Target audience',          value: '', enabled: true  },
  pricePosition:           { key: 'pricePosition',           label: 'Price positioning',        value: '', enabled: true  },
  visualStyle:             { key: 'visualStyle',             label: 'Visual style',             value: '', enabled: true  },
  marketingTone:           { key: 'marketingTone',           label: 'Marketing tone',           value: '', enabled: true  },
  preferredWords:          { key: 'preferredWords',          label: 'Preferred words / phrases',value: '', enabled: true  },
  avoidedWords:            { key: 'avoidedWords',            label: 'Avoided words / phrases',  value: '', enabled: false },
  productCategories:       { key: 'productCategories',       label: 'Product categories',       value: '', enabled: true  },
  manufacturerPreferences: { key: 'manufacturerPreferences', label: 'Manufacturer preferences', value: '', enabled: false },
  storeStyle:              { key: 'storeStyle',              label: 'Store style',              value: '', enabled: true  },
  typography:              { key: 'typography',              label: 'Typography',               value: '', enabled: false },
};

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  ts: number;
  eventType: 'suggested' | 'approved' | 'rejected' | 'undone' | 'cancelled';
  screen: string;
  actionType: AIActionType;
  title: string;
  affectedRecord?: string;
  canUndo: boolean;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AISettings {
  enabled: boolean;
  suggestionsEnabled: boolean;
  sessionMemoryEnabled: boolean;
  brandMemoryEnabled: boolean;
  confirmSensitiveActions: boolean;
  confirmDestructiveActions: boolean;
  confirmPublishing: boolean;
  confirmSending: boolean;
  dataSources: {
    products: boolean;
    orders: boolean;
    inventory: boolean;
    analytics: boolean;
    customers: boolean;
    content: boolean;
    manufacturers: boolean;
    store: boolean;
    marketing: boolean;
  };
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: true,
  suggestionsEnabled: true,
  sessionMemoryEnabled: true,
  brandMemoryEnabled: true,
  confirmSensitiveActions: true,
  confirmDestructiveActions: true,
  confirmPublishing: true,
  confirmSending: true,
  dataSources: {
    products: true,
    orders: true,
    inventory: true,
    analytics: true,
    customers: true,
    content: true,
    manufacturers: true,
    store: true,
    marketing: true,
  },
};

// ─── Home Suggestions ─────────────────────────────────────────────────────────

export type SuggestionCategory =
  | 'inventory' | 'orders' | 'content' | 'marketing'
  | 'store' | 'customers' | 'production' | 'analytics';

export type SuggestionPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface AISuggestion {
  id: string;
  title: string;
  reason: string;
  expectedImpact: string;
  actionLabel: string;
  actionRoute?: string;
  category: SuggestionCategory;
  priority: SuggestionPriority;
  dismissedAt?: number;
  completedAt?: number;
  contextPrompt?: string;
}

// ─── Next Best Action ─────────────────────────────────────────────────────────

export interface NextBestAction {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  accentColor: string;
  route?: string;
  priority: number;
  category: SuggestionCategory;
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export type AIPermissionLevel = 'viewer' | 'editor' | 'admin';

export function canApplyAction(permission: AIPermissionLevel, card: AIActionCard): boolean {
  if (permission === 'viewer') return false;
  if (card.isDestructive && permission !== 'admin') return false;
  return true;
}

// ─── Suggested Prompts (per screen) ──────────────────────────────────────────

export const SCREEN_PROMPTS: Partial<Record<AIScreenContext['screen'], string[]>> = {
  home:             ['What should I focus on today?', 'How is my business performing?', 'What needs my attention right now?', 'Give me a weekly summary'],
  products:         ['Which product is converting best?', 'Write copy for my best seller', 'Which products need attention?', 'Suggest a pricing test'],
  product_detail:   ['Write premium copy for this product', 'What price should I test?', 'Why might this product be underperforming?', 'Create a matching product concept'],
  orders:           ['Which orders are urgent?', 'Draft a delay message', 'Summarize today\'s order activity', 'Identify fulfillment risks'],
  order_detail:     ['Summarize this order', 'Draft a customer response', 'What is the payout status?', 'Suggest a return resolution'],
  analytics:        ['Why did revenue change this week?', 'Which product made the most money?', 'What is hurting conversion?', 'Which campaign performed best?'],
  store_builder:    ['Make my homepage more luxurious', 'Improve mobile conversion', 'Move best sellers to the top', 'Make buttons more rounded'],
  design_studio:    ['Generate five colorways', 'Create a matching product', 'Suggest print placements', 'Make this more premium'],
  content:          ['Give me five hooks for this product', 'Write a premium caption', 'Create a 7-day content plan', 'Which product should I post next?'],
  inventory:        ['What should I restock?', 'Predict stockout risks', 'Identify dead stock', 'Compare my warehouse locations'],
  manufacturer_hub: ['Which quote is best value?', 'Draft a counteroffer', 'Summarize production status', 'What should I ask before accepting?'],
  marketing:        ['Generate an email campaign', 'Recommend the best segment to target', 'Create an abandoned-cart sequence', 'Write five subject lines'],
  customers:        ['Who are my VIP customers?', 'Identify at-risk customers', 'Suggest a win-back campaign', 'Summarize customer behavior'],
};
