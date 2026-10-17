import { describe, expect, it } from 'vitest';
import { buildDesignPdfHtml, exportFileName, resolveExportDimensions, MAX_EXPORT_SIDE } from './designExport';

describe('design export helpers', () => {
  it('keeps the canvas size for Original', () => {
    expect(resolveExportDimensions(1080, 1350, 'original')).toEqual({ width: 1080, height: 1350 });
  });

  it('fits presets into their box without stretching', () => {
    // Square canvas into a 1080×1920 story: limited by width.
    expect(resolveExportDimensions(1080, 1080, 'story')).toEqual({ width: 1080, height: 1080 });
    // Portrait canvas into the 2000 product box: limited by height.
    expect(resolveExportDimensions(1000, 2000, 'product')).toEqual({ width: 1000, height: 2000 });
    expect(resolveExportDimensions(4000, 2000, 'web')).toEqual({ width: 1200, height: 600 });
    expect(resolveExportDimensions(1080, 1080, 'thread')).toEqual({ width: 1080, height: 1080 });
  });

  it('scales print up but never past the hard ceiling', () => {
    expect(resolveExportDimensions(1000, 500, 'print')).toEqual({ width: 3000, height: 1500 });
    const big = resolveExportDimensions(3000, 3000, 'print');
    expect(Math.max(big.width, big.height)).toBe(MAX_EXPORT_SIDE);
  });

  it('falls back to 1080 for a canvas without dimensions', () => {
    expect(resolveExportDimensions(0, 0, 'original')).toEqual({ width: 1080, height: 1080 });
  });

  it('builds safe file names per format', () => {
    expect(exportFileName('Summer Drop / Hoodie', 'png')).toBe('Summer_Drop_Hoodie.png');
    expect(exportFileName('Logo', 'tpng')).toBe('Logo_transparent.png');
    expect(exportFileName('', 'project')).toBe('design.json');
    expect(exportFileName(null, 'pdf')).toBe('design.pdf');
    expect(exportFileName('Tee', 'jpg')).toBe('Tee.jpg');
  });

  it('embeds the image in a page sized to it', () => {
    const html = buildDesignPdfHtml('data:image/png;base64,AAAA', 300, 200);
    expect(html).toContain('size: 300px 200px');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });
});
