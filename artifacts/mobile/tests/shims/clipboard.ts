// Node-only OS boundary. Runtime builds continue to use Expo's clipboard.
let text = "";
export const isPasteButtonAvailable = false;
export async function setStringAsync(value: string) { text = value; return true; }
export async function getStringAsync() { return text; }
export async function hasStringAsync() { return text.length > 0; }
export const setUrlAsync = setStringAsync;
export async function getUrlAsync() { return text || null; }
export async function hasUrlAsync() { return /^https?:\/\//.test(text); }
export function addClipboardListener() { return { remove() {} }; }
export function removeClipboardListener(listener: { remove(): void }) { listener.remove(); }
