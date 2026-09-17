/**
 * Feather icon name type alias.
 * Narrow type pulled from @expo/vector-icons so EngagementButton
 * gets proper prop validation without importing the full icon set.
 */
import type { ComponentProps } from 'react';
import { Feather } from '@expo/vector-icons';

export type FeatherNames = ComponentProps<typeof Feather>['name'];
