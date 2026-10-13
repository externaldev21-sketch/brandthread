/**
 * Legacy route. It used to be a local-only mock (toggles in useState, never
 * saved, seller-only rows) reached from buyer Settings (QA-0057). The real,
 * persisted preferences live on /notifications-settings, which shows buyer or
 * seller toggles for the signed-in role plus the promotional opt-in.
 */
import { Redirect } from 'expo-router';

import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';

import { useColors } from '@/hooks/useColors';

import { ScreenHeader } from '@/components/ScreenHeader';

import { ListRow } from '@/components/ui/ListRow';

import { Card } from '@/components/ui/Card';

import { TYPE_SCALE } from '@/constants/typography';

import { SPACING } from '@/constants/spacing';

import { FONT } from '@/lib/theme';

export default function PushNotificationsRedirect() {
  return <Redirect href="/notifications-settings" />;
}
