// Phase 0 proof (roadmap/04): does an app published with EAS Update open in the App Store's
// Expo Go (SDK 58) on an iPhone, and does data saved on the phone survive a full restart?
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

const KEY = 'splitsnap-probe/v1';

export default function App() {
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    (async () => {
      const saved = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null');
      const next = {
        opens: (saved ? saved.opens : 0) + 1,
        taps: saved ? saved.taps : 0,
        firstOpened: saved ? saved.firstOpened : new Date().toISOString(),
        lastOpened: saved ? saved.thisOpen : null,
        thisOpen: new Date().toISOString(),
      };
      await AsyncStorage.setItem(KEY, JSON.stringify(next));
      setData(next);
    })();
  }, []);

  const tap = async () => {
    const next = { ...data, taps: data.taps + 1 };
    setData(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <Text style={styles.title}>SplitSnap probe</Text>
      <Text style={styles.sub}>Published with EAS Update · Expo SDK 58</Text>
      {data ? (
        <>
          <Text style={styles.big}>{data.taps}</Text>
          <Pressable style={styles.button} onPress={tap} accessibilityRole="button">
            <Text style={styles.buttonText}>Tap to add 1</Text>
          </Pressable>
          <Text style={styles.line}>Opened {data.opens} time(s)</Text>
          <Text style={styles.line}>First opened: {new Date(data.firstOpened).toLocaleString()}</Text>
          <Text style={styles.line}>
            Last opened: {data.lastOpened ? new Date(data.lastOpened).toLocaleString() : 'this is the first time'}
          </Text>
          <Text style={styles.hint}>
            Tap a few times, close Expo Go completely (swipe it away), open this project again. If the number and
            "Opened" count are kept, saved data works.
          </Text>
        </>
      ) : (
        <Text style={styles.line}>Loading…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6F7', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#1F2A2E' },
  sub: { fontSize: 13, color: '#6B7B80', marginTop: 4, marginBottom: 24 },
  big: { fontSize: 64, fontWeight: '700', color: '#1CC29F' },
  button: { backgroundColor: '#1CC29F', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14, marginVertical: 16 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  line: { fontSize: 14, color: '#1F2A2E', marginTop: 6 },
  hint: { fontSize: 13, color: '#6B7B80', marginTop: 24, textAlign: 'center' },
});
