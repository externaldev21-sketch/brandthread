import { Platform, useWindowDimensions } from 'react-native';
import { computeProfileLayout, type ProfileLayout } from './profileGeometry';

/**
 * Geometry shared by every profile (buyer + seller, own + public) so the one
 * profile shell lays out identically everywhere.
 *
 *  - Phones: full width, 3-column 9:16 video grid.
 *  - iPad / tablet: a wider grid (4–5 columns) capped at GRID_MAX_WIDTH.
 *  - Desktop web: a centered app column so nothing stretches across a
 *    1440px browser (tiles and hero keep their phone proportions).
 */
export {
  PROFILE_GRID_GAP, PROFILE_WEB_COLUMN, SHOP_PILL_HEIGHT, computeProfileLayout,
  type ProfileLayout,
} from './profileGeometry';

export function useProfileLayout(): ProfileLayout {
  const { width, height } = useWindowDimensions();
  return computeProfileLayout(width, height, Platform.OS);
}
