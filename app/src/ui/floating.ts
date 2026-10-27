import * as React from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Extra bottom offset that floating elements (Fab) need to clear the home indicator.
 * <Screen> provides it for its floating layer; undefined = not inside a Screen.
 */
export const FloatingBottomContext = React.createContext<number | undefined>(undefined);

/** True when rendered inside a bottom-tab screen (the tab bar already covers the bottom inset). */
export function useInTabs(): boolean {
  return React.useContext(BottomTabBarHeightContext) !== undefined;
}

/** Bottom inset still uncovered at this point of the tree. */
export function useUncoveredBottomInset(): number {
  const insets = useSafeAreaInsets();
  return useInTabs() ? 0 : insets.bottom;
}
