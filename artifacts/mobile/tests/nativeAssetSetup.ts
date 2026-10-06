import { createRequire } from 'node:module';

// Metro resolves bundled files to asset IDs. Node renderer tests only need
// stable identities, not binary image/video decoding.
const require = createRequire(import.meta.url);
for (const extension of ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.wav', '.mp3', '.m4a']) {
  require.extensions[extension] = (module, filename) => {
    module.exports = filename;
  };
}
