import { describe, expect, it } from 'vitest';
import { clock, parseUnits, short, units, zec } from './format';

describe('format', () => {
  it('units trims zeros and keeps a minimum', () => {
    expect(units(8_740_000n, 8)).toBe('0.0874');
    expect(units(0n, 8, 2)).toBe('0.00');
    expect(units(123_456_789_000n, 8)).toBe('1,234.56789');
    expect(zec(133_669n, 0)).toBe('0.00133669 ZEC');
  });
  it('parseUnits refuses junk and extra decimals', () => {
    expect(parseUnits('25', 6)).toBe(25_000_000n);
    expect(parseUnits('0.2', 9)).toBe(200_000_000n);
    expect(parseUnits('1,000.5', 6)).toBe(1_000_500_000n);
    expect(parseUnits('1.0000001', 6)).toBeNull();
    expect(parseUnits('abc', 6)).toBeNull();
    expect(parseUnits('.', 6)).toBeNull();
  });
  it('short and clock', () => {
    expect(short('3hz4td165byB8njyWaXmrxG2zZsX2pJrGWprEpdbzit5', 4, 3)).toBe('3hz4…it5');
    expect(clock(72_000)).toBe('1:12');
    expect(clock(3_725_000)).toBe('1:02:05');
  });
});
