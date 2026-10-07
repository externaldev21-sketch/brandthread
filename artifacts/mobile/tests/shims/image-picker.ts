// Node-only device boundary: no real OS permission or media selection.
export const MediaTypeOptions = { All: "All", Images: "Images", Videos: "Videos" };
export const CameraType = { front: "front", back: "back" };
const denied = { status: "denied", granted: false, canAskAgain: true, expires: "never" };
export async function requestMediaLibraryPermissionsAsync() { return denied; }
export async function getMediaLibraryPermissionsAsync() { return denied; }
export async function requestCameraPermissionsAsync() { return denied; }
export async function getCameraPermissionsAsync() { return denied; }
export async function launchImageLibraryAsync() { return { canceled: true, assets: [] }; }
export async function launchCameraAsync() { return { canceled: true, assets: [] }; }
