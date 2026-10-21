const fs = require('fs');
const path = require('path');

const INTER_FILES = {
  400: '400Regular/Inter_400Regular.ttf',
  500: '500Medium/Inter_500Medium.ttf',
  600: '600SemiBold/Inter_600SemiBold.ttf',
  700: '700Bold/Inter_700Bold.ttf',
};

function headFor(faces) {
  return faces.map(({ weight, uri }) =>
    `<link data-bt-text-font="${weight}" rel="preload" href="${uri}" as="font" type="font/ttf" crossorigin="anonymous">`,
  ).join('\n') + '<style>' + faces.map(({ weight, uri }) =>
    `@font-face{font-family:"Inter";src:url(${JSON.stringify(uri)}) format("truetype");font-weight:${weight};font-style:normal;font-display:swap;}`,
  ).join('\n') + '</style>';
}

function createDevTextFontHead(projectRoot) {
  return headFor(Object.entries(INTER_FILES).map(([weight, file]) => {
    const resolved = require.resolve(`@expo-google-fonts/inter/${file}`);
    const folder = './' + path.relative(projectRoot, path.dirname(resolved)).split(path.sep).join('/');
    return { weight, uri: `/assets/?unstable_path=${encodeURIComponent(folder)}/${path.basename(file)}` };
  }));
}

function addTextFontPreloads(outputDir, basePath = '') {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push(file);
    }
  }
  walk(outputDir);
  const faces = Object.entries(INTER_FILES).map(([weight, name]) => {
    const stem = path.basename(name, '.ttf');
    const file = files.find(file => {
      const base = path.basename(file);
      return base === `${stem}.ttf` || (base.startsWith(`${stem}.`) && base.endsWith('.ttf'));
    });
    if (!file) throw new Error(`Missing bundled Inter font: ${stem}`);
    return { weight, uri: `${basePath}/${encodeURI(path.relative(outputDir, file).split(path.sep).join('/'))}` };
  });
  const index = path.join(outputDir, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  if (!html.includes('data-bt-text-font=')) {
    fs.writeFileSync(index, html.replace('</head>', `${headFor(faces)}\n</head>`));
  }
  return faces.length;
}

module.exports = { INTER_FILES, createDevTextFontHead, addTextFontPreloads };
