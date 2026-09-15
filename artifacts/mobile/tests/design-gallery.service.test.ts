/**
 * Gallery & Service tests for:
 * - soft delete, restore, permanent delete
 * - multi-select actions (duplicate, bulk soft delete)
 * - preset creation
 * - route / project integrity (getProject still works after soft delete)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── AsyncStorage mock ────────────────────────────────────────────────────────

const store: Record<string, string> = {};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); return Promise.resolve(); },
  },
}));

vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest: vi.fn(),
}));

// ─── imports after mocks ──────────────────────────────────────────────────────

import {
  getProjects,
  getProject,
  getDeletedProjects,
  createProject,
  softDeleteProject,
  restoreDeletedProject,
  deleteProject,
  purgeDeletedProjects,
  duplicateProject,
  updateProject,
} from '../services/designService';
import { SELLER_CANVAS_PRESETS } from '../services/designTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearStorage() {
  Object.keys(store).forEach(k => delete store[k]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('designService — soft delete', () => {
  beforeEach(clearStorage);

  it('softDeleteProject sets deletedAt and removes from getProjects()', async () => {
    const proj = await createProject('canvas', 'Test', { width: 1080, height: 1080 });
    await softDeleteProject(proj.id);

    const active = await getProjects();
    expect(active.find(p => p.id === proj.id)).toBeUndefined();

    const deleted = await getDeletedProjects();
    const found = deleted.find(p => p.id === proj.id);
    expect(found).toBeDefined();
    expect(found!.deletedAt).toBeDefined();
  });

  it('getProject() still resolves a soft-deleted project by id', async () => {
    const proj = await createProject('canvas', 'Canvas A', {});
    await softDeleteProject(proj.id);

    const resolved = await getProject(proj.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(proj.id);
    expect(resolved!.deletedAt).toBeDefined();
  });

  it('normal getProjects() never includes soft-deleted items', async () => {
    const p1 = await createProject('canvas', 'Keep', {});
    const p2 = await createProject('canvas', 'Delete', {});
    await softDeleteProject(p2.id);

    const active = await getProjects();
    expect(active.some(p => p.id === p1.id)).toBe(true);
    expect(active.some(p => p.id === p2.id)).toBe(false);
  });

  it('getDeletedProjects() returns only soft-deleted, sorted newest-first', async () => {
    const p1 = await createProject('canvas', 'First', {});
    const p2 = await createProject('canvas', 'Second', {});
    await softDeleteProject(p1.id);
    await new Promise(r => setTimeout(r, 5));
    await softDeleteProject(p2.id);

    const deleted = await getDeletedProjects();
    expect(deleted[0].id).toBe(p2.id);
    expect(deleted[1].id).toBe(p1.id);
  });
});

describe('designService — restore', () => {
  beforeEach(clearStorage);

  it('restoreDeletedProject removes deletedAt and re-adds to getProjects()', async () => {
    const proj = await createProject('canvas', 'Restore Me', {});
    await softDeleteProject(proj.id);
    await restoreDeletedProject(proj.id);

    const active = await getProjects();
    const found = active.find(p => p.id === proj.id);
    expect(found).toBeDefined();
    expect(found!.deletedAt).toBeUndefined();

    const deleted = await getDeletedProjects();
    expect(deleted.find(p => p.id === proj.id)).toBeUndefined();
  });

  it('restored project retains original name and canvas dimensions', async () => {
    const proj = await createProject('canvas', 'My Art', { width: 2048, height: 2048 });
    await softDeleteProject(proj.id);
    const restored = await restoreDeletedProject(proj.id);

    expect(restored.name).toBe('My Art');
    expect(restored.canvas.width).toBe(2048);
    expect(restored.canvas.height).toBe(2048);
  });
});

describe('designService — permanent delete', () => {
  beforeEach(clearStorage);

  it('deleteProject removes the project entirely — not in getProjects or getDeletedProjects', async () => {
    const proj = await createProject('canvas', 'Gone', {});
    await softDeleteProject(proj.id);
    await deleteProject(proj.id);

    const active = await getProjects();
    const deleted = await getDeletedProjects();
    expect(active.find(p => p.id === proj.id)).toBeUndefined();
    expect(deleted.find(p => p.id === proj.id)).toBeUndefined();
    expect(await getProject(proj.id)).toBeNull();
  });

  it('purgeDeletedProjects removes all soft-deleted but keeps active projects', async () => {
    const keep = await createProject('canvas', 'Keep', {});
    const trash1 = await createProject('canvas', 'Trash1', {});
    const trash2 = await createProject('canvas', 'Trash2', {});
    await softDeleteProject(trash1.id);
    await softDeleteProject(trash2.id);

    await purgeDeletedProjects();

    const active = await getProjects();
    const deleted = await getDeletedProjects();
    expect(active.some(p => p.id === keep.id)).toBe(true);
    expect(deleted.length).toBe(0);
    expect(await getProject(trash1.id)).toBeNull();
    expect(await getProject(trash2.id)).toBeNull();
  });
});

describe('designService — multi-select actions', () => {
  beforeEach(clearStorage);

  it('bulk duplicate creates copies and originals remain active', async () => {
    const p1 = await createProject('canvas', 'Art A', {});
    const p2 = await createProject('canvas', 'Art B', {});

    await duplicateProject(p1.id);
    await duplicateProject(p2.id);

    const active = await getProjects();
    expect(active.filter(p => p.name === 'Art A (copy)').length).toBe(1);
    expect(active.filter(p => p.name === 'Art B (copy)').length).toBe(1);
    expect(active.some(p => p.id === p1.id)).toBe(true);
    expect(active.some(p => p.id === p2.id)).toBe(true);
  });

  it('bulk soft delete moves multiple projects to Recently Deleted', async () => {
    const p1 = await createProject('canvas', 'Del 1', {});
    const p2 = await createProject('canvas', 'Del 2', {});
    const keep = await createProject('canvas', 'Keep', {});

    await softDeleteProject(p1.id);
    await softDeleteProject(p2.id);

    const active = await getProjects();
    expect(active.some(p => p.id === p1.id)).toBe(false);
    expect(active.some(p => p.id === p2.id)).toBe(false);
    expect(active.some(p => p.id === keep.id)).toBe(true);

    const deleted = await getDeletedProjects();
    expect(deleted.some(p => p.id === p1.id)).toBe(true);
    expect(deleted.some(p => p.id === p2.id)).toBe(true);
  });

  it('rename updates project name without affecting other fields', async () => {
    const proj = await createProject('canvas', 'Old Name', { width: 1920, height: 1080 });
    await updateProject(proj.id, { name: 'New Name' });

    const updated = await getProject(proj.id);
    expect(updated!.name).toBe('New Name');
    expect(updated!.canvas.width).toBe(1920);
    expect(updated!.canvas.height).toBe(1080);
  });
});

describe('designService — preset creation', () => {
  beforeEach(clearStorage);

  it('all SELLER_CANVAS_PRESETS can create valid projects', async () => {
    for (const preset of SELLER_CANVAS_PRESETS) {
      const proj = await createProject('canvas', preset.label, {
        width: preset.width,
        height: preset.height,
        backgroundHex: preset.transparentBg ? 'transparent' : '#000000',
      });
      expect(proj.id).toBeTruthy();
      expect(proj.canvas.width).toBe(preset.width);
      expect(proj.canvas.height).toBe(preset.height);
      expect(proj.name).toBe(preset.label);
    }
  });

  it('SELLER_CANVAS_PRESETS includes the 6 required seller presets', () => {
    const ids = SELLER_CANVAS_PRESETS.map(p => p.id);
    expect(ids).toContain('product_photo');
    expect(ids).toContain('ig_post');
    expect(ids).toContain('ig_story');
    expect(ids).toContain('tshirt_print');
    expect(ids).toContain('poster_18x24');
    expect(ids).toContain('logo_sticker');
  });

  it('tshirt_print preset is 4500 x 5400 at 300 dpi', () => {
    const preset = SELLER_CANVAS_PRESETS.find(p => p.id === 'tshirt_print')!;
    expect(preset.width).toBe(4500);
    expect(preset.height).toBe(5400);
    expect(preset.dpi).toBe(300);
  });

  it('logo_sticker preset has transparentBg', () => {
    const preset = SELLER_CANVAS_PRESETS.find(p => p.id === 'logo_sticker')!;
    expect(preset.transparentBg).toBe(true);
  });

  it('poster_18x24 represents 18x24 in at 300 dpi', () => {
    const preset = SELLER_CANVAS_PRESETS.find(p => p.id === 'poster_18x24')!;
    expect(preset.width).toBe(18 * 300);  // 5400
    expect(preset.height).toBe(24 * 300); // 7200
    expect(preset.dpi).toBe(300);
  });
});

describe('designService — route and project integrity', () => {
  beforeEach(clearStorage);

  it('createProject assigns a unique id compatible with /design-canvas?id= routing', async () => {
    const p1 = await createProject('canvas', 'A', {});
    const p2 = await createProject('canvas', 'B', {});
    expect(p1.id).not.toBe(p2.id);
    expect(p1.id).toMatch(/^proj_/);
  });

  it('duplicateProject copies all canvas dimensions and layers', async () => {
    const proj = await createProject('canvas', 'Original', { width: 2048, height: 2048 });
    await updateProject(proj.id, {
      layers: [{
        id: 'layer_1', name: 'Layer 1', type: 'drawing', visible: true, locked: false,
        order: 0, opacity: 1,
        transform: { x: 0, y: 0, width: 1080, height: 1080, rotation: 0, scaleX: 1, scaleY: 1 },
        data: { kind: 'drawing', paths: [] },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }],
    });

    const copy = await duplicateProject(proj.id);
    expect(copy.id).not.toBe(proj.id);
    expect(copy.canvas.width).toBe(2048);
    expect(copy.canvas.height).toBe(2048);
    expect(copy.layers.length).toBe(1);
    expect(copy.name).toBe('Original (copy)');
    expect(copy.deletedAt).toBeUndefined();
  });

  it('soft-deleted project id still resolves via getProject for canvas editor', async () => {
    const proj = await createProject('canvas', 'Canvas', {});
    await softDeleteProject(proj.id);
    const resolved = await getProject(proj.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.deletedAt).toBeDefined();
  });

  it('seed projects do not have deletedAt set', async () => {
    const projects = await getProjects();
    projects.forEach(p => {
      expect(p.deletedAt).toBeUndefined();
    });
  });

  it('existing projects created without deletedAt are still returned by getProjects', async () => {
    // Simulate a project stored before soft-delete was introduced (no deletedAt field)
    const legacyProj = {
      id: 'proj_legacy_1',
      name: 'Legacy',
      type: 'canvas' as const,
      status: 'draft' as const,
      canvas: { width: 1080, height: 1080, backgroundHex: '#000000' },
      layers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // No deletedAt field at all
    };
    store['bt:design:projects:v1'] = JSON.stringify([legacyProj]);

    const projects = await getProjects();
    expect(projects.some(p => p.id === 'proj_legacy_1')).toBe(true);
  });
});
