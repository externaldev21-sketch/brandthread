/** Web-only TouchableOpacity that honors `hitSlop` — see shims/web-hit-slop.js. */
import TouchableOpacity from 'react-native-web/dist/exports/TouchableOpacity';
import { withWebHitSlop } from './web-hit-slop';

export default withWebHitSlop(TouchableOpacity, { functionChildren: false });
