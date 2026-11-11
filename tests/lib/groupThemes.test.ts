import { DEFAULT_GROUP_THEME, GROUP_THEMES, groupThemeInfo, isGroupThemeId, tintRgb } from '../../app/src/lib/groupThemes';
import { THEME_ART, THEME_ART_SIZE } from '../../app/src/ui/groupThemeArt';

describe('groupThemes', () => {
  it('lists default first, then the nine themes, each with a label and an rgb tint', () => {
    expect(GROUP_THEMES.map((t) => t.id)).toEqual([
      'default', 'beach', 'mountains', 'home', 'office', 'friends', 'fitness', 'groceries', 'music', 'dining',
    ]);
    expect(DEFAULT_GROUP_THEME).toBe('default');
    for (const t of GROUP_THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.tint).toHaveLength(3);
      for (const c of t.tint) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
    expect(new Set(GROUP_THEMES.map((t) => t.id)).size).toBe(10);
  });

  it('knows its ids and nothing else', () => {
    expect(isGroupThemeId('beach')).toBe(true);
    expect(isGroupThemeId('default')).toBe(true);
    expect(isGroupThemeId('Beach')).toBe(false);
    expect(isGroupThemeId('space')).toBe(false);
    expect(isGroupThemeId('')).toBe(false);
    expect(isGroupThemeId(undefined)).toBe(false);
    expect(isGroupThemeId(null)).toBe(false);
    expect(isGroupThemeId(4)).toBe(false);
    expect(isGroupThemeId('__proto__')).toBe(false);
    expect(isGroupThemeId('toString')).toBe(false);
  });

  it('falls back to the default theme for a missing or unknown id', () => {
    expect(groupThemeInfo('music').label).toBe('Music');
    expect(groupThemeInfo()).toBe(GROUP_THEMES[0]);
    expect(groupThemeInfo(undefined).id).toBe('default');
    expect(groupThemeInfo('nope').id).toBe('default');
    expect(groupThemeInfo('constructor').id).toBe('default');
  });

  it('formats a tint as a solid colour', () => {
    expect(tintRgb([20, 140, 160])).toBe('rgb(20, 140, 160)');
  });
});

describe('theme art', () => {
  it('has two PNG layers for every theme', () => {
    for (const t of GROUP_THEMES) {
      const art = THEME_ART[t.id];
      expect(art.lines.indexOf('data:image/png;base64,')).toBe(0);
      expect(art.fills.indexOf('data:image/png;base64,')).toBe(0);
      expect(art.lines).not.toBe(art.fills);
    }
    expect(Object.keys(THEME_ART).sort()).toEqual(GROUP_THEMES.map((t) => t.id).sort());
    expect(THEME_ART_SIZE.width / THEME_ART_SIZE.height).toBeCloseTo(244 / 96, 2);
  });
});
