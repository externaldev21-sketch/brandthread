export type SizeChartData = {
  columns: string[];
  rows: { size: string; values: string[] }[];
  unit?: 'inches' | 'cm';
  notes?: string;
};

export type SizeChartPreset = { key: string; name: string; chart: SizeChartData };

export type SizeChartTemplateSummary = {
  id: string;
  name: string;
  chart: SizeChartData;
  updatedAt: string;
  productCount?: number;
};

export type SizeChartTemplateDetail = SizeChartTemplateSummary & {
  products: { id: string; name: string; images: string[] }[];
};
