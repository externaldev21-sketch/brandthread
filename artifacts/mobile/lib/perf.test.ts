import { describe, expect, it } from 'vitest';
import { DEFAULT_PERF_BUDGET, TAB_PERF_BUDGETS, budgetFor, overBudget } from './perf';

describe('per-screen perf budgets', () => {
  it('uses the tab budget when one exists, else the default', () => {
    expect(budgetFor('/inbox')).toBe(TAB_PERF_BUDGETS['/inbox']);
    expect(budgetFor('/settings/privacy')).toBe(DEFAULT_PERF_BUDGET);
  });

  it('reports exactly which numbers went over', () => {
    const b = budgetFor('/inbox');
    expect(overBudget({ route: '/inbox', firstRenderMs: b.firstRenderMs, dataMs: b.dataMs })).toEqual([]);
    expect(overBudget({ route: '/inbox', firstRenderMs: b.firstRenderMs + 1, dataMs: null })).toEqual(['firstRender']);
    expect(overBudget({ route: '/inbox', firstRenderMs: 10, dataMs: b.dataMs + 1 })).toEqual(['data']);
  });

  it('never flags a number that was not measured', () => {
    expect(overBudget({ route: '/', firstRenderMs: null, dataMs: null })).toEqual([]);
  });
});
