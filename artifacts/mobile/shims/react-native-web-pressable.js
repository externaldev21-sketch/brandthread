/** Web-only Pressable that honors `hitSlop` — see shims/web-hit-slop.js. */
import Pressable from 'react-native-web/dist/exports/Pressable';
import { withWebHitSlop } from './web-hit-slop';

export default withWebHitSlop(Pressable, { functionChildren: true });
