// Self-test fixture for tools/typecheck.ps1: correct code using the allowed packages.
import { NavigationContainer, type NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { Home } from './src/Home';
import { Broken } from './src/Broken';

type Tabs = { Home: undefined; Broken: undefined };
type Stack = { Tabs: NavigatorScreenParams<Tabs> | undefined; Detail: { id: string } };

const RootStack = createNativeStackNavigator<Stack>();
const TabNav = createBottomTabNavigator<Tabs>();

enableScreens(true);

function Detail({ route }: NativeStackScreenProps<Stack, 'Detail'>) {
  return <Home label={route.params.id} />;
}

function TabsScreen() {
  return (
    <TabNav.Navigator>
      <TabNav.Screen name="Home" component={Home} />
      <TabNav.Screen name="Broken" component={Broken} />
    </TabNav.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <RootStack.Navigator screenOptions={{ headerTintColor: '#1CC29F' }}>
          <RootStack.Screen name="Tabs" component={TabsScreen} options={{ headerShown: false }} />
          <RootStack.Screen name="Detail" component={Detail} options={{ presentation: 'modal' }} />
        </RootStack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
