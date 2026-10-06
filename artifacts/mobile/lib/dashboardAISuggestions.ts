/**
 * Seller dashboard "Suggestions" card — pure helpers.
 *
 * Turns the body of GET /api/ai/suggestions (computed by the server from the
 * seller's own inventory, orders and posts) into the rows the card shows.
 * The server already applies AI Settings; these helpers apply the device's
 * copy as well so a change made in AI Settings hides the card immediately.
 */

import type { AISettings, AISuggestion, AIScreenContext, SuggestionCategory, SuggestionPriority } from '@/services/aiTypes';
import { suggestionCategoryAllowed } from '@/services/aiSettingsPolicy';

export const DASHBOARD_SUGGESTION_LIMIT = 3;

const PRIORITY_RANK: Record<SuggestionPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const CATEGORY_CONTEXT: Partial<Record<SuggestionCategory, AIScreenContext>> = {
  inventory: { screen: 'inventory' },
  orders: { screen: 'orders' },
  content: { screen: 'content' },
  marketing: { screen: 'marketing' },
  analytics: { screen: 'analytics' },
  customers: { screen: 'customers' },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** In-app routes only: "/inventory", "/(tabs)/orders" — never "//host" or a URL. */
export function safeSuggestionRoute(route: unknown): string | undefined {
  const r = str(route);
  if (!r.startsWith('/') || r.startsWith('//') || /\s/.test(r)) return undefined;
  return r;
}

/** Whether the card may appear at all under these AI Settings. */
export function dashboardSuggestionsEnabled(settings: AISettings | null): boolean {
  return Boolean(settings && settings.enabled && settings.suggestionsEnabled);
}

/**
 * Normalizes the API body into at most `limit` suggestions: malformed rows
 * dropped, duplicate ids collapsed, categories whose data source is off
 * removed, most urgent first. Returns [] when the assistant or dashboard
 * suggestions are off.
 */
export function selectDashboardSuggestions(
  body: unknown,
  settings: AISettings | null,
  limit = DASHBOARD_SUGGESTION_LIMIT,
): AISuggestion[] {
  if (!dashboardSuggestionsEnabled(settings)) return [];
  const rows = isRecord(body) && Array.isArray(body.suggestions) ? body.suggestions : [];
  const seen = new Set<string>();
  const out: AISuggestion[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = str(row.id);
    const title = str(row.title);
    if (!id || !title || seen.has(id)) continue;
    const category = str(row.category) as SuggestionCategory;
    if (!suggestionCategoryAllowed(category, settings as AISettings)) continue;
    const priority = (str(row.priority) in PRIORITY_RANK ? str(row.priority) : 'medium') as SuggestionPriority;
    seen.add(id);
    out.push({
      id,
      title,
      reason: str(row.reason),
      expectedImpact: str(row.expectedImpact),
      actionLabel: str(row.actionLabel) || 'Open',
      actionRoute: safeSuggestionRoute(row.actionRoute),
      category,
      priority,
      contextPrompt: str(row.contextPrompt) || undefined,
    });
  }
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => PRIORITY_RANK[a.s.priority] - PRIORITY_RANK[b.s.priority] || a.i - b.i)
    .slice(0, Math.max(0, limit))
    .map(({ s }) => s);
}

/** What the "Ask AI" action pre-fills in AI Brain for this suggestion. */
export function suggestionPrompt(s: Pick<AISuggestion, 'title' | 'reason' | 'contextPrompt'>): string {
  if (s.contextPrompt) return s.contextPrompt;
  return [s.title.replace(/[.!?]*$/, '.'), s.reason, 'What should I do about this?']
    .filter(Boolean)
    .join(' ');
}

/** AI Brain route params for a suggestion: screen context + pre-filled prompt. */
export function suggestionAIBrainParams(s: AISuggestion): { context: string; prompt: string } {
  const context = CATEGORY_CONTEXT[s.category] ?? { screen: 'home' as const };
  return { context: JSON.stringify(context), prompt: suggestionPrompt(s) };
}
