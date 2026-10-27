// DELIBERATE icon-name mistakes behind string-typed props, which TypeScript alone cannot see.
// tools/selftest/run-selftest.ps1 expects SPLITSNAP2 on lines 16, 18, 21, 23 and 24 only.
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function Glyph({ icon, size = 20 }: { icon: string; size?: number }) {
  return <Ionicons name={icon as 'add'} size={size} />;
}

function label(icon: string, text: string): string {
  return text + icon;
}

const TAB_ICONS: Record<string, [string, string]> = {
  Home: ['home-outline', 'home'],
  Wallet: ['wallet-outline', 'walet'],
};
const ROWS = [{ label: 'Cart', icon: 'cart-outline', color: 'tomato' }, { label: 'Shop', icon: 'shopping-cart' }];

export function IconNames({ on }: { on: boolean }) {
  const fallbackIcon = on ? 'checkmark' : 'chek';
  return (
    <View accessibilityLabel={label('clos', 'Close') + label('close', 'ok') + fallbackIcon}>
      <Glyph icon={on ? 'add' : 'not-an-icon'} />
      <Glyph icon="receipt-outline" />
      <Glyph icon={TAB_ICONS.Home[0] + ROWS.length} />
    </View>
  );
}
