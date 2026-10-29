import * as React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import { DarkTheme, DefaultTheme, InitialState, NavigationContainer, Theme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { AppStoreProvider, useAppState, useStoreReady } from './src/store/AppStore';
import { DraftProvider } from './src/store/draft';
import { SyncProvider } from './src/sync/SyncProvider';
import { colors, setActiveTheme, themed, ThemeName } from './src/theme';
import { AppText, DialogHost } from './src/ui';

function navigationThemeFor(name: ThemeName): Theme {
  const base = name === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: name === 'dark',
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
    },
  };
}

/** Browser tab title in the Snack web preview: 'Groups · SplitSnap'. */
const documentTitle = {
  formatter: (options: Record<string, unknown> | undefined) => {
    const title = typeof options?.title === 'string' ? options.title.trim() : '';
    return title && title !== 'SplitSnap' ? `${title} · SplitSnap` : 'SplitSnap';
  },
};

/** Light or dark: the user's choice in Settings, or the phone's setting when it is 'system'. */
function useResolvedTheme(): ThemeName {
  const system = useColorScheme();
  const appearance = useAppState().settings.appearance ?? 'system';
  if (appearance === 'system') return system === 'dark' ? 'dark' : 'light';
  return appearance;
}

/** Waits for the saved state to load before showing any screen. */
function AppContent() {
  const ready = useStoreReady();
  const theme = useResolvedTheme();
  // Switch the palette before anything below renders, so `colors` and themed styles match.
  setActiveTheme(theme);
  // Remounting the navigator redraws every screen in the new colours; the saved navigation
  // state puts the user back where they were.
  const navState = React.useRef<InitialState | undefined>(undefined);

  if (!ready) {
    return (
      <View style={styles.loading} accessibilityLabel="Loading SplitSnap">
        <ActivityIndicator size="large" color={colors.primary} />
        <AppText variant="caption" style={styles.loadingText}>
          Loading your expenses…
        </AppText>
      </View>
    );
  }
  return (
    <>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      <NavigationContainer
        key={theme}
        theme={navigationThemeFor(theme)}
        documentTitle={documentTitle}
        initialState={navState.current}
        onStateChange={(state) => {
          navState.current = state;
        }}
      >
        <RootNavigator />
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppStoreProvider>
        <SyncProvider>
          <DraftProvider>
            <AppContent />
          </DraftProvider>
        </SyncProvider>
      </AppStoreProvider>
      <DialogHost />
    </SafeAreaProvider>
  );
}

const styles = themed((colors) => StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  loadingText: { marginTop: 12 },
}));
