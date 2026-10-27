import * as React from 'react';
import { StyleProp, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

/** Every glyph name Ionicons knows about. Component props take plain strings and are narrowed here. */
export type IconName = React.ComponentProps<typeof Ionicons>['name'];

const FALLBACK_ICON: IconName = 'help-circle-outline';

/** Narrows a string to a valid Ionicons glyph; unknown names render a '?' circle instead of nothing. */
export function resolveIconName(name: string): IconName {
  const glyphMap = (Ionicons as unknown as { glyphMap?: Record<string, unknown> }).glyphMap;
  if (glyphMap && !(name in glyphMap)) return FALLBACK_ICON;
  return name as IconName;
}

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

export function Icon({ name, size = 22, color = colors.text, style }: IconProps) {
  return <Ionicons name={resolveIconName(name)} size={size} color={color} style={style} />;
}
