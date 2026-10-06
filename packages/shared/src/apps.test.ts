import { describe, expect, it } from 'vitest';
import { otherApps } from './apps';

describe('otherApps', () => {
  it('links the other apps on skybreaker.dev', () => {
    expect(otherApps('shopping', { protocol: 'https:', hostname: 'shopping.skybreaker.dev' })).toEqual([
      expect.objectContaining({ id: 'cash', name: 'Conti', url: 'https://cash.skybreaker.dev/' }),
    ]);
  });

  it('uses the development ports elsewhere', () => {
    expect(otherApps('cash', { protocol: 'http:', hostname: 'localhost' })).toEqual([
      expect.objectContaining({ id: 'shopping', name: 'Spesa', url: 'http://localhost:4321/' }),
    ]);
  });
});
