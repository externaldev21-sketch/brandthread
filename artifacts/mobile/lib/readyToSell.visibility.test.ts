import { describe, expect, it } from 'vitest';
import { readyToSellVisibility } from './readyToSell';

const incomplete = { complete: false };
const complete = { complete: true };

describe('dashboard incentives retire on server state', () => {
  it('"Get ready to sell" shows until all 9 launch steps are done', () => {
    expect(readyToSellVisibility({ data: incomplete, progress: { complete: false }, hasPlan: true }).checklist).toBe(true);
    expect(readyToSellVisibility({ data: incomplete, progress: { complete: true }, hasPlan: true }).checklist).toBe(false);
  });

  it('the server 9-step count wins over the six-row subset', () => {
    // Six rows done but the 9-step checklist isn't → still shown.
    expect(readyToSellVisibility({ data: complete, progress: { complete: false }, hasPlan: true }).checklist).toBe(true);
    // Before the 9-step count loads, the six rows decide.
    expect(readyToSellVisibility({ data: complete, progress: null, hasPlan: true }).checklist).toBe(false);
  });

  it('"Select a plan" / free-trial block shows only while there is no plan', () => {
    expect(readyToSellVisibility({ data: incomplete, progress: null, hasPlan: false }).plan).toBe(true);
    expect(readyToSellVisibility({ data: incomplete, progress: null, hasPlan: true }).plan).toBe(false);
    // Unknown (status still loading / failed) never flashes the block.
    expect(readyToSellVisibility({ data: incomplete, progress: null, hasPlan: null }).plan).toBe(false);
  });

  it('with both retired nothing is left to render', () => {
    expect(readyToSellVisibility({ data: complete, progress: { complete: true }, hasPlan: true }).any).toBe(false);
    expect(readyToSellVisibility({ data: complete, progress: { complete: true }, hasPlan: false })).toEqual({ checklist: false, plan: true, any: true });
  });
});
