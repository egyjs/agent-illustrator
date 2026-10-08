import { describe, expect, it } from 'vitest';
import { resolvePaint, toSvgColor } from '../../src/scene/color.ts';

describe('scene/color', () => {
  it('normalizes CSS colors to lowercase #rrggbb', () => {
    expect(toSvgColor('#fff')).toBe('#ffffff');
    expect(toSvgColor('teal')).toBe('#008080');
    expect(toSvgColor('RebeccaPurple')).toBe('#663399');
    expect(toSvgColor('rgb(42 157 143)')).toBe('#2a9d8f');
    expect(toSvgColor(' #2A9D8F ')).toBe('#2a9d8f');
  });

  it('turns other color spaces into hex, so any renderer can draw them', () => {
    expect(toSvgColor('oklch(1 0 0)')).toBe('#ffffff');
    expect(toSvgColor('hsl(0 100% 50%)')).toBe('#ff0000');
  });

  it('keeps translucency as rgba() and none as none', () => {
    expect(toSvgColor('rgb(255 0 0 / 50%)')).toBe('rgba(255, 0, 0, 0.5)');
    expect(toSvgColor('none')).toBe('none');
  });

  it('returns undefined for anything that is not a color', () => {
    expect(toSvgColor('palette.primary')).toBeUndefined();
    expect(toSvgColor('')).toBeUndefined();
    expect(toSvgColor('#12')).toBeUndefined();
  });

  it('resolvePaint looks up tokens first and ignores prototype members', () => {
    const doc = { tokens: { 'palette.primary': '#E76F51' } };
    expect(resolvePaint(doc, 'palette.primary')).toBe('#e76f51');
    expect(resolvePaint(doc, 'navy')).toBe('#000080');
    expect(resolvePaint(doc, 'palette.missing')).toBeUndefined();
    expect(resolvePaint(doc, 'constructor')).toBeUndefined();
  });
});
