const fs = require('fs');
const path = require('path');

// Match the existing static requires in lib/iconFontAssets.ts. Do not preload
// FA6 regular/solid or any of the other vector-icons families exported by Expo.
const USED_FONT_FILES = {
  Feather: 'feather',
  MaterialIcons: 'material',
  Ionicons: 'ionicons',
  MaterialCommunityIcons: 'material-community',
  FontAwesome: 'FontAwesome',
  FontAwesome6_Brands: 'FontAwesome6Brands-Regular',
};

function findFonts(dir, found = new Map()) {
  if (!fs.existsSync(dir)) return found;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) findFonts(file, found);
    else if (item.name.endsWith('.ttf')) {
      const stem = item.name.split('.')[0];
      if (Object.hasOwn(USED_FONT_FILES, stem)) found.set(stem, file);
    }
  }
  return found;
}

function addIconFontPreloads(outputDir, basePath = '') {
  const index = path.join(outputDir, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  if (html.includes('data-bt-icon-font=')) return 0;
  const assets = findFonts(path.join(outputDir, 'assets'));
  const missing = Object.keys(USED_FONT_FILES).filter(stem => !assets.has(stem));
  if (missing.length) throw new Error(`Missing bundled icon font assets: ${missing.join(', ')}`);
  const faces = Object.entries(USED_FONT_FILES).map(([stem, family]) => ({
    family,
    uri: `${basePath}/${encodeURI(path.relative(outputDir, assets.get(stem)).split(path.sep).join('/'))}`,
  }));
  const links = faces.map(({ family, uri }) =>
    `<link data-bt-icon-font="${family}" rel="preload" href="${uri}" as="font" type="font/ttf" crossorigin="anonymous">`,
  ).join('\n');
  const css = faces.map(({ family, uri }) =>
    `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(uri)}) format("truetype");font-display:block;font-weight:normal;font-style:normal;}`,
  ).join('\n');
  // The production/fast previews are single-output SPAs, where Expo does not
  // render app/+html.tsx. Inject only the app shell, not marketing pages.
  fs.writeFileSync(index, html.replace('</head>', `${links}\n<style>${css}</style>\n</head>`));
  return faces.length;
}

module.exports = { addIconFontPreloads, USED_FONT_FILES };

function createDevIconFontHead(projectRoot) {
  const faces = Object.entries(USED_FONT_FILES).map(([file, family]) => {
    const resolved = require.resolve(`@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/${file}.ttf`);
    // Match Expo Asset's dev URL exactly, so the preloaded request is reused
    // by Font.loadAsync instead of downloading a second copy.
    const folder = './' + path.relative(projectRoot, path.dirname(resolved)).split(path.sep).join('/');
    return { family, uri: `/assets/?unstable_path=${encodeURIComponent(folder)}/${file}.ttf` };
  });
  return faces.map(({ family, uri }) =>
    `<link data-bt-icon-font="${family}" rel="preload" href="${uri}" as="font" type="font/ttf" crossorigin="anonymous">`,
  ).join('\n') + '<style>' + faces.map(({ family, uri }) =>
    `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(uri)}) format("truetype");font-display:block;font-weight:normal;font-style:normal;}`,
  ).join('\n') + '</style>';
}

function withDevIconFontHead(middleware, projectRoot) {
  const head = createDevIconFontHead(projectRoot);
  return (req, res, next) => {
    const end = res.end;
    res.end = function (chunk, ...args) {
      if (!res.headersSent && String(res.getHeader('Content-Type') || '').includes('text/html') &&
          (typeof chunk === 'string' || Buffer.isBuffer(chunk))) {
        const html = chunk.toString();
        if (html.includes('</head>') && !html.includes('data-bt-icon-font=')) {
          res.removeHeader('Content-Length');
          chunk = html.replace('</head>', `${head}</head>`);
        }
      }
      return end.call(res, chunk, ...args);
    };
    return middleware(req, res, next);
  };
}

module.exports.createDevIconFontHead = createDevIconFontHead;
module.exports.withDevIconFontHead = withDevIconFontHead;
