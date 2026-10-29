import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMonth } from './api';
import { clearMonthCache, restoreMonthCache, saveMonthCache } from './cache';
import type { CashSummary, MonthData } from './types';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
// Query strings carry spaces as '+'.
const url = (call: number) => decodeURIComponent(String(fetchMock.mock.calls[call][0]).replaceAll('+', ' '));
const summary = { month: '2026-10', current: '2026-10', first: '2026-09' } as CashSummary;
const movement = { id: 'm1', kind: 'spend', amount: 5000, date: '2026-10-06', month: '2026-10' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('loadMonth', () => {
  it('loads the summary of the month and its movements, newest first', async () => {
    fetchMock.mockResolvedValueOnce(json(summary)).mockResolvedValueOnce(json({ page: 1, perPage: 500, totalItems: 1, totalPages: 1, items: [movement] }));
    const data = await loadMonth('2026-10');
    expect(url(0)).toContain('/household/api/cash/summary?month=2026-10');
    expect(url(1)).toContain('/household/api/collections/movements/records');
    expect(url(1)).toContain('month = "2026-10"');
    expect(url(1)).toContain('sort=-date,-created');
    expect(data).toEqual({ summary, movements: [movement] });
  });

  it('asks for the current month when none is given', async () => {
    fetchMock.mockResolvedValueOnce(json(summary)).mockResolvedValueOnce(json({ page: 1, perPage: 500, totalItems: 0, totalPages: 0, items: [] }));
    await loadMonth();
    expect(url(0)).not.toContain('month=');
    expect(url(1)).toContain('month = "2026-10"');
  });
});

describe('month cache', () => {
  const data = { summary, movements: [movement] } as unknown as MonthData;

  it('month opens from the cache without network', async () => {
    saveMonthCache(data);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(loadMonth()).rejects.toBeTruthy();
    expect(restoreMonthCache()).toEqual(data);
    expect(restoreMonthCache('2026-10')).toEqual(data);
    expect(restoreMonthCache('2026-09')).toBeNull();
  });

  it('forgets every saved month', () => {
    saveMonthCache(data);
    localStorage.setItem('household:user', 'kept');
    clearMonthCache();
    expect(restoreMonthCache()).toBeNull();
    expect(localStorage.getItem('household:user')).toBe('kept');
  });
});
