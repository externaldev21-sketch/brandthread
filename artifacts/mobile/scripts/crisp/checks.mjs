/**
 * The in-page half of the crispness crawl: runs inside the browser (passed to
 * page.evaluate) after a screen has settled, and returns every element that
 * would paint soft. Self-contained on purpose — it is serialised into the page.
 *
 * Rules (all "at rest", i.e. after the screen's entry transition):
 *   blur             backdrop-filter or filter: blur() on a visible element
 *   text-opacity     visible text whose opacity (own × every ancestor) < 1
 *   text-faded       visible text whose colour has alpha < 1 (faded white)
 *   text-scale       text inside a scale transform
 *   text-subpixel    text inside a transform that is not on a whole device pixel
 *   will-change      text inside an element left with will-change
 *   font-fraction    a fractional font size
 *   image-upscaled   an image painted larger than its source pixels
 *   border-subpixel  a border that is not a whole number of device pixels
 *   smear-shadow     a box-shadow with blur radius >= 6px
 *
 * Elements inside `[data-crisp-allow]`, or inside the tab bars (which this
 * pass does not touch), are reported as `allowed` instead.
 */
export function crispChecks({ dpr, allowSelectors }) {
  const findings = [];
  const allowed = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const allowSel = allowSelectors.join(',');

  const label = (el) => {
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ');
    const id = el.closest('[data-testid]')?.getAttribute('data-testid');
    return `${text.slice(0, 48)}${id ? ` <${id}>` : ''}`.trim() || el.tagName.toLowerCase();
  };
  const visible = (el, cs) => {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return false;
    return true;
  };
  const report = (el, rule, detail) => {
    const entry = { rule, detail, el: label(el) };
    if (allowSel && el.closest(allowSel)) {
      entry.allow = el.closest('[data-crisp-allow]')?.getAttribute('data-crisp-allow') || el.closest(allowSel).getAttribute('data-testid') || 'allow-list';
      allowed.push(entry);
    } else findings.push(entry);
  };
  const ancestorsOf = (el) => {
    const out = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) out.push(node);
    return out;
  };
  const effectiveOpacity = (el) => ancestorsOf(el).reduce((acc, node) => acc * Number(getComputedStyle(node).opacity), 1);
  const alphaOf = (color) => {
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (!m) return 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length >= 4 ? Number(parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parts[3]) : 1;
  };
  const isWhole = (value) => Math.abs(value - Math.round(value)) < 0.02;

  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (!visible(el, cs)) continue;

    const backdrop = cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : cs.webkitBackdropFilter;
    if (backdrop && backdrop !== 'none' && /blur/.test(backdrop)) report(el, 'blur', `backdrop-filter: ${backdrop}`);
    if (cs.filter && /blur\(/.test(cs.filter) && !/blur\(0(px)?\)/.test(cs.filter)) report(el, 'blur', `filter: ${cs.filter}`);

    const shadow = cs.boxShadow;
    if (shadow && shadow !== 'none') {
      for (const part of shadow.split(/,(?![^(]*\))/)) {
        const lengths = part.replace(/rgba?\([^)]*\)/, '').trim().split(/\s+/).map(parseFloat).filter((n) => !Number.isNaN(n));
        const color = /rgba?\([^)]*\)/.exec(part)?.[0] ?? '';
        if ((lengths[2] ?? 0) >= 6 && alphaOf(color) > 0.02 && !/inset/.test(part)) {
          report(el, 'smear-shadow', `box-shadow ${part.trim()}`);
          break;
        }
      }
    }

    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const width = parseFloat(cs[`border${side}Width`]);
      if (width > 0 && cs[`border${side}Style`] !== 'none' && alphaOf(cs[`border${side}Color`]) > 0 && !isWhole(width * dpr)) {
        report(el, 'border-subpixel', `border-${side.toLowerCase()} ${width}px`);
        break;
      }
    }

    if (el.tagName === 'IMG' && el.naturalWidth > 0) {
      const r = el.getBoundingClientRect();
      const src = el.currentSrc || el.src || '';
      if (r.width >= 24 && r.height >= 24 && !src.startsWith('data:image/svg') && !/\.svg(\?|$)/.test(src)) {
        // The painted box is the image's own rect, or its parent's when the
        // <img> is react-native-web's hidden measuring copy.
        const box = cs.opacity === '0' && el.parentElement ? el.parentElement.getBoundingClientRect() : r;
        const fit = cs.objectFit || 'fill';
        const sx = (box.width * dpr) / el.naturalWidth;
        const sy = (box.height * dpr) / el.naturalHeight;
        const scale = fit === 'contain' || fit === 'scale-down' ? Math.min(sx, sy) : Math.max(sx, sy);
        if (scale > 1.15 && effectiveOpacity(el.parentElement || el) > 0.05) {
          report(el, 'image-upscaled', `${el.naturalWidth}×${el.naturalHeight} source painted at ${Math.round(box.width * dpr)}×${Math.round(box.height * dpr)} device px (${scale.toFixed(2)}×) ${src.slice(0, 80)}`);
        }
      }
    }

    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText) continue;
    const opacity = effectiveOpacity(el);
    if (opacity < 0.02) continue; // invisible text is not blurry text
    if (opacity < 0.995) report(el, 'text-opacity', `opacity ${opacity.toFixed(2)}`);
    if (alphaOf(cs.color) < 0.995 && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') report(el, 'text-faded', `color ${cs.color}`);
    const size = parseFloat(cs.fontSize);
    if (!isWhole(size)) report(el, 'font-fraction', `font-size ${cs.fontSize}`);

    for (const node of ancestorsOf(el)) {
      const ns = getComputedStyle(node);
      if (ns.willChange && ns.willChange !== 'auto') {
        report(el, 'will-change', `will-change: ${ns.willChange} on <${node.tagName.toLowerCase()}>`);
        break;
      }
    }
    for (const node of ancestorsOf(el)) {
      const t = getComputedStyle(node).transform;
      if (!t || t === 'none') continue;
      const m = /matrix\(([^)]+)\)/.exec(t);
      if (!m) {
        report(el, 'text-scale', `3d transform ${t.slice(0, 40)}`);
        break;
      }
      const [a, b, c, d, e, f] = m[1].split(',').map(Number);
      const sx = Math.hypot(a, b);
      const sy = Math.hypot(c, d);
      if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
        report(el, 'text-scale', `scale ${sx.toFixed(3)}×${sy.toFixed(3)} on <${node.tagName.toLowerCase()}>`);
        break;
      }
      if (!isWhole(e * dpr) || !isWhole(f * dpr)) {
        report(el, 'text-subpixel', `translate ${e.toFixed(2)},${f.toFixed(2)} on <${node.tagName.toLowerCase()}>`);
        break;
      }
    }
  }
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((f) => {
      const key = `${f.rule}|${f.el}|${f.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return { findings: dedupe(findings), allowed: dedupe(allowed) };
}
