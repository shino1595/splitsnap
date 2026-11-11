import type { GroupThemeId } from '../types';

export interface GroupThemeInfo {
  id: GroupThemeId;
  label: string;
  /** Base colour of the theme as [r, g, b]; applied with alpha at render time. */
  tint: [number, number, number];
}

export const DEFAULT_GROUP_THEME: GroupThemeId = 'default';

export const GROUP_THEMES: GroupThemeInfo[] = [
  { id: 'default', label: 'Default', tint: [201, 168, 90] },
  { id: 'beach', label: 'Beach', tint: [20, 140, 160] },
  { id: 'mountains', label: 'Mountains', tint: [70, 100, 150] },
  { id: 'home', label: 'Home', tint: [190, 120, 50] },
  { id: 'office', label: 'Office', tint: [80, 95, 115] },
  { id: 'friends', label: 'Friends', tint: [150, 70, 150] },
  { id: 'fitness', label: 'Fitness', tint: [190, 60, 60] },
  { id: 'groceries', label: 'Groceries', tint: [70, 140, 70] },
  { id: 'music', label: 'Music', tint: [110, 80, 180] },
  { id: 'dining', label: 'Dining', tint: [150, 50, 80] },
];

export function isGroupThemeId(value: unknown): value is GroupThemeId {
  return typeof value === 'string' && GROUP_THEMES.some((t) => t.id === value);
}

/** The theme for an id; a missing or unknown id gives the default theme. */
export function groupThemeInfo(id?: string): GroupThemeInfo {
  return GROUP_THEMES.find((t) => t.id === id) ?? GROUP_THEMES[0];
}

/** `rgba(r, g, b, alpha)` for a theme tint. */
export function tintRgba(tint: [number, number, number], alpha: number): string {
  return `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${alpha})`;
}

/** `rgb(r, g, b)` for a theme tint (used with tintColor, which takes a solid colour; opacity is set separately). */
export function tintRgb(tint: [number, number, number]): string {
  return `rgb(${tint[0]}, ${tint[1]}, ${tint[2]})`;
}
