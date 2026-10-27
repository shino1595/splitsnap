// Design tokens. Screens and components use these instead of literal values.
//
// Light and dark palettes share the same keys. `colors` always returns the active palette's
// value, so `colors.text` read while rendering follows the theme. Style sheets are built with
// `themed((colors) => StyleSheet.create({...}))`, which makes one sheet per theme on first use.
// Never copy a `colors.*` value into a module-level constant (tools\typecheck.ps1 flags it as
// SPLITSNAP4): it would keep the colour that was active when the file loaded.

const lightColors = {
  primary: '#1CC29F', // Splitwise-style green: "you are owed", primary actions
  primaryDark: '#119C7E',
  primarySoft: '#E3F8F2',
  primaryBorder: '#BFEBDD',
  primaryPressed: '#CDEFE5',
  owe: '#FF652F', // orange: "you owe"
  oweSoft: '#FFEDE5',
  text: '#1F2A2E',
  textMuted: '#6B7B80',
  textFaint: '#9AA8AC',
  border: '#E3E8EA',
  background: '#F4F6F7',
  card: '#FFFFFF',
  danger: '#E5484D',
  dangerSoft: '#FDECEC',
  dangerPressed: '#C9363B',
  warning: '#B7791F',
  warningSoft: '#FFF6E0',
  info: '#3B82F6',
  infoSoft: '#EAF2FF',
  white: '#FFFFFF',
  overlay: 'rgba(15, 23, 26, 0.45)',
  /** Pressed state for flat controls (icon buttons, rows). */
  pressed: 'rgba(15, 23, 26, 0.06)',
  /** Translucent page colour behind a loading spinner. */
  scrim: 'rgba(244, 246, 247, 0.78)',
  /** Segment pressed inside a SegmentedControl. */
  segmentPressed: 'rgba(255, 255, 255, 0.5)',
  /** Android switch thumb when off. */
  switchThumbOff: '#F4F5F5',
};

export type Palette = typeof lightColors;

const darkColors: Palette = {
  primary: '#1CC29F',
  primaryDark: '#4FD8B8', // used for text on primarySoft, so it must stay readable on dark
  primarySoft: 'rgba(28, 194, 159, 0.16)',
  primaryBorder: 'rgba(28, 194, 159, 0.38)',
  primaryPressed: 'rgba(28, 194, 159, 0.26)',
  owe: '#FF7A45',
  oweSoft: 'rgba(255, 122, 69, 0.16)',
  text: '#E8EDEF',
  textMuted: '#9FAEB3',
  textFaint: '#6E7D82',
  border: '#2C3438',
  background: '#101416',
  card: '#1A2023',
  danger: '#F2555A',
  dangerSoft: 'rgba(242, 85, 90, 0.16)',
  dangerPressed: '#D9454A',
  warning: '#E5A93A',
  warningSoft: 'rgba(229, 169, 58, 0.16)',
  info: '#6EA8FE',
  infoSoft: 'rgba(110, 168, 254, 0.16)',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.6)',
  pressed: 'rgba(255, 255, 255, 0.08)',
  scrim: 'rgba(16, 20, 22, 0.8)',
  segmentPressed: 'rgba(255, 255, 255, 0.08)',
  switchThumbOff: '#C9D1D4',
};

export type ThemeName = 'light' | 'dark';
/** What the user picked in Settings; 'system' follows the phone's setting. */
export type AppearancePreference = 'system' | 'light' | 'dark';

const palettes: Record<ThemeName, Palette> = { light: lightColors, dark: darkColors };
let activeTheme: ThemeName = 'light';

/** Switches the palette that `colors` and `themed` sheets return. Call before rendering. */
export function setActiveTheme(name: ThemeName): void {
  activeTheme = name;
}

export function getActiveTheme(): ThemeName {
  return activeTheme;
}

/** Live view of the active palette (same keys as `Palette`). */
export const colors = {} as Palette;
for (const key of Object.keys(lightColors) as (keyof Palette)[]) {
  Object.defineProperty(colors, key, { enumerable: true, get: () => palettes[activeTheme][key] });
}

/** One style sheet per theme, built on first use: `const styles = themed((colors) => StyleSheet.create({...}))`. */
export function themed<T extends object>(factory: (palette: Palette) => T): T {
  const cache: Partial<Record<ThemeName, T>> = {};
  const current = (): T => {
    const hit = cache[activeTheme];
    if (hit) return hit;
    const built = factory(palettes[activeTheme]);
    cache[activeTheme] = built;
    return built;
  };
  return new Proxy({} as T, {
    get: (_target, prop) => (current() as Record<string | symbol, unknown>)[prop],
    has: (_target, prop) => prop in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, prop) => {
      const descriptor = Object.getOwnPropertyDescriptor(current(), prop);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

/** Avatar colours handed out to new people in order. */
export const avatarPalette = [
  '#5B8DEF', '#F2994A', '#9B51E0', '#27AE60', '#EB5757',
  '#2D9CDB', '#F2C94C', '#BB6BD9', '#219653', '#E86A92',
];

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

export const font = {
  caption: 12,
  small: 13,
  body: 15,
  label: 14,
  heading: 17,
  title: 22,
  amount: 34,
  weightRegular: '400' as const,
  weightMedium: '500' as const,
  weightSemibold: '600' as const,
  weightBold: '700' as const,
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
};
