// Design tokens ("Noir & Gold"). Screens and components use these instead of literal values.
//
// Light and dark palettes share the same keys. `colors` always returns the active palette's
// value, so `colors.text` read while rendering follows the theme. Style sheets are built with
// `themed((colors) => StyleSheet.create({...}))`, which makes one sheet per theme on first use.
// Never copy a `colors.*` value into a module-level constant (tools\typecheck.ps1 flags it as
// SPLITSNAP4): it would keep the colour that was active when the file loaded.

const lightColors = {
  primary: '#8A671B', // gold-bronze: tint, links, icons, selected states, "you are owed"
  primaryDark: '#6B4F12',
  primarySoft: '#F3ECD9',
  primaryBorder: '#DCCB9C',
  primaryPressed: '#EADFC2',
  /** Background of filled primary buttons, the Fab and the raised centre tab button. */
  primaryFill: '#15130F',
  primaryFillPressed: '#34302A',
  /** Text and icons on primaryFill. */
  onPrimaryFill: '#E9D6A3',
  /** Thin gold rule. */
  accentLine: '#C9A85A',
  /** Decorative circles behind every screen (Screen.tsx), largest to smallest, and the gold wash on balance cards. */
  layer1: 'rgba(255, 255, 255, 0.55)',
  layer2: '#FBF8F0',
  layer3: '#FFFFFF',
  wash: '#FBF2DC',
  owe: '#A63D4F', // rose: "you owe"
  oweSoft: '#F7E6E9',
  text: '#15130F',
  textMuted: '#726C61',
  textFaint: '#A39C90',
  border: '#E4DED1',
  background: '#F6F3EC',
  card: '#FFFFFF',
  danger: '#C4321F',
  dangerSoft: '#FBE9E6',
  dangerPressed: '#A32818',
  warning: '#B4540E',
  warningSoft: '#FCEBDD',
  info: '#3D5A80',
  infoSoft: '#E9EEF5',
  white: '#FFFFFF',
  overlay: 'rgba(21, 19, 15, 0.45)',
  /** Pressed state for flat controls (icon buttons, rows). */
  pressed: 'rgba(21, 19, 15, 0.06)',
  /** Translucent page colour behind a loading spinner. */
  scrim: 'rgba(246, 243, 236, 0.78)',
  /** Segment pressed inside a SegmentedControl. */
  segmentPressed: 'rgba(255, 255, 255, 0.5)',
  /** Android switch thumb when off. */
  switchThumbOff: '#F4F2EC',
};

export type Palette = typeof lightColors;

const darkColors: Palette = {
  primary: '#D9BC7A',
  primaryDark: '#E8D3A2', // used for text on primarySoft, so it must stay readable on dark
  primarySoft: 'rgba(212, 181, 106, 0.12)',
  primaryBorder: 'rgba(212, 181, 106, 0.38)',
  primaryPressed: 'rgba(212, 181, 106, 0.24)',
  primaryFill: '#D4B56A',
  primaryFillPressed: '#BFA158',
  onPrimaryFill: '#14120D',
  accentLine: '#D4B56A',
  layer1: '#111112',
  layer2: '#191816',
  layer3: '#23201A',
  wash: '#2A2416',
  owe: '#E58C9B',
  oweSoft: 'rgba(229, 140, 155, 0.16)',
  text: '#F2EDE2',
  textMuted: '#A39C8E',
  textFaint: '#6F695E',
  border: '#2B2924',
  background: '#0C0C0D',
  card: '#161617',
  danger: '#F0604F',
  dangerSoft: 'rgba(240, 96, 79, 0.16)',
  dangerPressed: '#D24C3C',
  warning: '#F0954A',
  warningSoft: 'rgba(240, 149, 74, 0.16)',
  info: '#8FB0DE',
  infoSoft: 'rgba(143, 176, 222, 0.16)',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.6)',
  pressed: 'rgba(255, 255, 255, 0.08)',
  scrim: 'rgba(12, 12, 13, 0.8)',
  segmentPressed: 'rgba(255, 255, 255, 0.08)',
  switchThumbOff: '#C9C4B8',
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

export const radius = { sm: 6, md: 12, lg: 14, pill: 999 };

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
