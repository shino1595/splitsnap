import { Platform, ViewStyle } from 'react-native';
import { shadow } from '../theme';

// A const array instead of `1 | 2 | 3`: Snack's Babel cannot parse numeric literal types.
const SHADOW_LEVELS = [1, 2, 3] as const;
export type ShadowLevel = (typeof SHADOW_LEVELS)[number];

// react-native-web deprecates the shadow* props, so web gets an equivalent CSS box-shadow.
const WEB_SHADOWS: Record<ShadowLevel, string> = {
  1: '0px 2px 8px rgba(0, 0, 0, 0.06)',
  2: '0px 4px 14px rgba(0, 0, 0, 0.10)',
  3: '0px 8px 24px rgba(0, 0, 0, 0.16)',
};

const NATIVE_SHADOWS: Record<ShadowLevel, ViewStyle> = {
  1: shadow.card,
  2: { ...shadow.card, shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  3: { ...shadow.card, shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
};

/** Platform-safe drop shadow: iOS shadow* props, Android elevation, web box-shadow. */
export function shadowStyle(level: ShadowLevel = 1): ViewStyle {
  return Platform.OS === 'web' ? { boxShadow: WEB_SHADOWS[level] } : NATIVE_SHADOWS[level];
}
