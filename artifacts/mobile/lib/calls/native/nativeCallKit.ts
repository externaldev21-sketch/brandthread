/**
 * Native call ringing — default (web, tests, any platform without a split):
 * inert. iOS and Android implementations live in nativeCallKit.ios.ts /
 * nativeCallKit.android.ts and are picked by Metro's platform extensions.
 */
import { inertNativeCallKit, type NativeCallKit } from './nativeCallCore';

export const nativeCallKit: NativeCallKit = inertNativeCallKit;
