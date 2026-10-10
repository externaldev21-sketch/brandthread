export type ImportIssue = {
  severity: 'error' | 'warning';
  line: number;
  product: string;
  field: string | null;
  message: string;
};

export type ImportProviders = {
  csv: boolean;
  shopify: { publicUrl: boolean; oauth: boolean; connected: boolean; shopDomain: string | null };
  etsy: { enabled: boolean; connected: boolean; shopName?: string | null; reason?: string };
};

export type ImportPreview = {
  layout: 'shopify' | 'etsy' | 'generic';
  layoutLabel: string;
  source: string;
  delimiter?: string;
  rowCount: number;
  counts: { products: number; variants: number; create: number; update: number; unchanged: number; errors: number; warnings: number };
  capacity: { limit: number | null; used: number; remaining: number | null; newProducts: number; wouldExceed: boolean };
  issues: ImportIssue[];
  issuesTruncated: boolean;
  sample: Array<{
    name: string; category: string; imageCount: number; firstImage: string | null; action: 'create' | 'update' | 'unchanged';
    variantCount: number; priceFromCents: number;
  }>;
  ignoredColumns: string[];
  notes: string[];
};

export type ImportCommitResult = {
  runId: string;
  source: string;
  counts: { created: number; updated: number; unchanged: number; failed: number; skipped: number; invalid: number };
  planLimitReached: boolean;
  results: Array<{ name: string; action: string; productId?: string; reason?: string; notes?: string[] }>;
  issues: ImportIssue[];
};

export type ImportRun = {
  id: string; source: string; filename: string | null; createdAt: string;
  created: number; updated: number; unchanged: number; failed: number; skipped: number;
};
