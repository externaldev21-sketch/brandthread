/** Isolated in-memory filesystem for Node screen tests, never device storage. */
const files = new Map<string, string | Uint8Array>();
export class Directory {
  uri: string;
  constructor(...parts: any[]) { this.uri = parts.map(p => p?.uri ?? p).join('/'); }
  create() {}
}
export class File {
  uri: string;
  constructor(...parts: any[]) { this.uri = parts.map(p => p?.uri ?? p).join('/'); }
  get exists() { return files.has(this.uri); }
  write(value: string | Uint8Array) { files.set(this.uri, value); }
  create() { files.set(this.uri, ''); }
  delete() { files.delete(this.uri); }
  async text() { const v = files.get(this.uri); if (v === undefined) throw new Error('File does not exist'); return typeof v === 'string' ? v : new TextDecoder().decode(v); }
  async bytes() { const v = files.get(this.uri); if (v === undefined) throw new Error('File does not exist'); return typeof v === 'string' ? new TextEncoder().encode(v) : v; }
  async base64() { return Buffer.from(await this.bytes()).toString('base64'); }
}
export const Paths = { cache: new Directory('file://test-cache'), document: new Directory('file://test-documents') };
