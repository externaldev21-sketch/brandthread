import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { products } from './index';

export type SizeChartData = {
  columns: string[];
  rows: { size: string; values: string[] }[];
  unit?: 'inches' | 'cm';
  notes?: string;
};

export const sizeChartTemplates = pgTable('size_chart_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  chart: jsonb('chart').$type<SizeChartData>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  ownerNameIdx: uniqueIndex('size_chart_templates_owner_name_uidx').on(t.ownerId, sql`lower(${t.name})`),
}));

export const productSizeChartLinks = pgTable('product_size_chart_links', {
  productId: uuid('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  templateId: uuid('template_id').notNull().references(() => sizeChartTemplates.id, { onDelete: 'cascade' }),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  templateIdx: index('product_size_chart_links_template_idx').on(t.templateId),
}));
