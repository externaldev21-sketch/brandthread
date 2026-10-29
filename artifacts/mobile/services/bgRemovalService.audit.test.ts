/**
 * saveResult must create a real results *directory*. A fake filesystem that
 * behaves like the device: File#create() makes a regular file, and writing
 * beneath a regular file fails (ENOTDIR).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ files: new Map<string, string>(), dirs: new Set<string>(['file://doc']) }));

vi.mock('expo-file-system', () => {
  const join = (parts: any[]) => parts.map((p) => p?.uri ?? p).join('/');
  const parentOf = (uri: string) => uri.slice(0, uri.lastIndexOf('/'));
  class Directory {
    uri: string;
    constructor(...parts: any[]) { this.uri = join(parts); }
    get exists() { return fs.dirs.has(this.uri); }
    create() {
      if (fs.files.has(this.uri)) throw new Error('EEXIST: a file is in the way');
      fs.dirs.add(this.uri);
    }
  }
  class File {
    uri: string;
    constructor(...parts: any[]) { this.uri = join(parts); }
    get exists() { return fs.files.has(this.uri); }
    create() { fs.files.set(this.uri, ''); }
    write(value: string) {
      if (!fs.dirs.has(parentOf(this.uri))) throw new Error('ENOTDIR: parent is not a directory');
      fs.files.set(this.uri, value);
    }
    delete() { fs.files.delete(this.uri); }
  }
  return { Directory, File, Paths: { document: new Directory('file://doc') } };
});

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { storage.set(k, v); },
    removeItem: async (k: string) => { storage.delete(k); },
  },
}));

import { getResults, saveResult } from './bgRemovalService';

beforeEach(() => {
  fs.files.clear();
  fs.dirs.clear();
  fs.dirs.add('file://doc');
  storage.clear();
});

describe('bg removal results on device', () => {
  it('writes the PNG under a bg-results directory on first use', async () => {
    const result = await saveResult({
      id: 'r1', b64Json: 'iVBORw0KGgo=', originalUri: 'file://pick.jpg', storageKey: null,
      size: 8, createdAt: '2026-10-29T00:00:00.000Z', sourceScreen: 'design_studio',
    });
    expect(result.localPath).toBe('file://doc/bg-results/r1.png');
    expect(fs.files.get('file://doc/bg-results/r1.png')).toBe('iVBORw0KGgo=');
    expect((await getResults()).map((r) => r.id)).toEqual(['r1']);
  });
});
