import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(dirOrUri: string, name?: string) {
      this.uri = name === undefined ? dirOrUri : `${dirOrUri}/${name}`;
    }
    copy() {}
  }
  return { File, Paths: { document: 'file:///doc' } };
});

import { makeDurableUri } from './imageUri';

describe('makeDurableUri on native', () => {
  it('names the copy with the caller’s extension when the picker URI has none', async () => {
    const uri = await makeDurableUri('content://media/external/images/media/42', 'png');
    expect(uri).toMatch(/^file:\/\/\/doc\/img_\d+_\d+\.png$/);
  });

  it('keeps the picker file’s own extension, ignoring query strings and dotted folders', async () => {
    expect(await makeDurableUri('file:///data/user/0/com.app/cache/pick.HEIC?x=1', 'jpg')).toMatch(/\.heic$/);
    expect(await makeDurableUri('file:///data/user/0/com.app.x/cache/ImagePicker/abc', 'jpg')).toMatch(/\.jpg$/);
  });
});
