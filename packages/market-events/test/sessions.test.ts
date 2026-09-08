import { describe, expect, it } from 'vitest';
import { getActiveSessions } from '../src/sessions.js';

describe('Trading Sessions & Killzones', () => {
  it('correctly maps UTC timestamps to active sessions', () => {
    // 03:00 UTC -> Asia
    const asiaTs = Date.UTC(2026, 8, 8, 3, 0, 0);
    expect(getActiveSessions(asiaTs)).toEqual(['asia']);

    // 07:30 UTC -> Asia & London overlap
    const overlapTs = Date.UTC(2026, 8, 8, 7, 30, 0);
    expect(getActiveSessions(overlapTs)).toContain('asia');
    expect(getActiveSessions(overlapTs)).toContain('london');

    // 14:00 UTC -> London & New York overlap
    const nyTs = Date.UTC(2026, 8, 8, 14, 0, 0);
    expect(getActiveSessions(nyTs)).toContain('london');
    expect(getActiveSessions(nyTs)).toContain('new_york');
  });
});
