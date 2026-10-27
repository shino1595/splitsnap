import { useContext, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { formatRupees } from './money';

// Valid code that -ShimAll must accept too: a context from a shimmed package, a generic call
// on a shimmed value and a weak-type annotation.
const GAP = Platform.select<number>({ ios: 8, default: 4 });
const platformApi: { select?: unknown } = Platform;

export function Home(props: { label?: string }) {
  const [count, setCount] = useState(0);
  const tabBarHeight = useContext(BottomTabBarHeightContext);

  async function pick(): Promise<string | null> {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled) return null;
    const small = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1000 } }], {
      compress: 0.7,
      format: SaveFormat.JPEG,
      base64: true,
    });
    await AsyncStorage.setItem('last', small.uri);
    return small.base64 ?? null;
  }

  return (
    <View style={[styles.box, { gap: GAP, paddingBottom: tabBarHeight ?? 0 }]}>
      <Ionicons name="receipt-outline" size={22} color="#1CC29F" />
      <Text numberOfLines={1}>{props.label ?? formatRupees(count)}</Text>
      <Pressable onPress={() => { setCount(count + 100); void pick(); }}>
        <Text>{typeof platformApi.select === 'function' ? 'Add' : 'Add (web)'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({ box: { flex: 1, padding: 16 } });
