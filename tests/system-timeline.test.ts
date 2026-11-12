import { describe, expect, it } from 'vitest';
import { clampSystemYear, timelineStep } from '../src/ui/systemClock';

describe('system timeline', () => {
  it('clamps the year to 0..endYear', () => {
    expect(clampSystemYear(-2, 120)).toBe(0);
    expect(clampSystemYear(80, 120)).toBe(80);
    expect(clampSystemYear(200, 120)).toBe(120);
  });
  it('scales playback by speed and never overshoots', () => {
    expect(timelineStep(10, 0.5, 4, 100)).toBe(50);
    expect(timelineStep(98, 1, 4, 100)).toBe(100);
  });
});
