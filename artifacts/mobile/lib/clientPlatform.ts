/**
 * Which app build is running, without importing react-native (api.ts must
 * stay importable from plain unit tests). Metro picks the .ios / .android
 * variant on native; web (and tests) get null.
 */
export const CLIENT_PLATFORM: 'ios' | 'android' | null = null;
