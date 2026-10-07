// OS capabilities are absent in the Node renderer; authentication tests replace
// this boundary with explicit success/failure fixtures.
export const hasHardwareAsync = async () => false;
export const isEnrolledAsync = async () => false;
export const supportedAuthenticationTypesAsync = async () => [];
export const authenticateAsync = async () => ({ success: false, error: 'not_available' });
export const cancelAuthenticate = async () => {};
export const AuthenticationType = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 };
