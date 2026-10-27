// DELIBERATE type errors for the typecheck self-test (tools/selftest/run-selftest.ps1 expects them):
// line 10 TS2322 (string to number), line 12 TS2322 (unknown View prop, needs real react-native
// types), line 13 TS2322 (numberOfLines string), line 14 TS2322 (unknown Ionicons glyph, needs
// real @expo/vector-icons types).
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function Broken() {
  // eslint-disable-next-line
  const total: number = 'three';
  return (
    <View notAProp={1}>
      <Text numberOfLines="2">{total}</Text>
      <Ionicons name="not-a-real-glyph" size={20} />
    </View>
  );
}
