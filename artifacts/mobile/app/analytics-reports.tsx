/**
 * Reports — every seller analytics report, one route. Analytics (the
 * Shopify Analytics pattern: range on top, key metrics, a Reports list at the
 * bottom) opens a report here with ?report=<key>; each report keeps its own
 * header, range pills and layout (components/analytics/reports/*).
 */
import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import ProductStatsReport from '@/components/analytics/reports/ProductStatsReport';
import ContentReport from '@/components/analytics/reports/ContentReport';
import AudienceReport from '@/components/analytics/reports/AudienceReport';
import GoalsReport from '@/components/analytics/reports/GoalsReport';
import ExportReport from '@/components/analytics/reports/ExportReport';
import AdvancedAnalyticsReport from '@/components/analytics/reports/AdvancedReport';
import CohortsReport from '@/components/analytics/reports/CohortsReport';

export const ANALYTICS_REPORT_SCREENS = {
  'product-stats': ProductStatsReport,
  content: ContentReport,
  audience: AudienceReport,
  goals: GoalsReport,
  export: ExportReport,
  advanced: AdvancedAnalyticsReport,
  cohorts: CohortsReport,
} as const;

export type AnalyticsReportKey = keyof typeof ANALYTICS_REPORT_SCREENS;

export default function AnalyticsReportScreen() {
  const { report } = useLocalSearchParams<{ report?: string }>();
  const Report = report && Object.prototype.hasOwnProperty.call(ANALYTICS_REPORT_SCREENS, report)
    ? ANALYTICS_REPORT_SCREENS[report as AnalyticsReportKey]
    : null;
  if (!Report) return <Redirect href="/(tabs)/analytics" />;
  return <Report key={report} />;
}
