import * as React from 'react';
import { GestureResponderEvent, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createNativeStackNavigator,
  NativeStackNavigationOptions,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {
  BottomTabBarButtonProps,
  BottomTabNavigationOptions,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { colors, font, themed } from '../theme';
import { Icon, IconButton, shadowStyle } from '../ui';
import type { RootStackParamList, TabParamList } from './types';

import ActivityScreen from '../screens/activity/ActivityScreen';
import AccountScreen from '../screens/account/AccountScreen';
import SettingsScreen from '../screens/account/SettingsScreen';
import ImportSplitwiseScreen from '../screens/import/ImportSplitwiseScreen';
import JoinGroupScreen from '../screens/sharing/JoinGroupScreen';
import ShareGroupScreen from '../screens/sharing/ShareGroupScreen';
import SyncTestScreen from '../screens/sharing/SyncTestScreen';
import AddExpenseScreen from '../screens/expense/AddExpenseScreen';
import ExpenseDetailScreen from '../screens/expense/ExpenseDetailScreen';
import PaidByScreen from '../screens/expense/PaidByScreen';
import SplitOptionsScreen from '../screens/expense/SplitOptionsScreen';
import FriendDetailScreen from '../screens/friends/FriendDetailScreen';
import FriendEditScreen from '../screens/friends/FriendEditScreen';
import FriendsScreen from '../screens/friends/FriendsScreen';
import GroupBalancesScreen from '../screens/groups/GroupBalancesScreen';
import GroupDetailScreen from '../screens/groups/GroupDetailScreen';
import GroupEditScreen from '../screens/groups/GroupEditScreen';
import GroupsScreen from '../screens/groups/GroupsScreen';
import GroupTotalsScreen from '../screens/groups/GroupTotalsScreen';
import ItemizedSplitScreen from '../screens/itemized/ItemizedSplitScreen';
import ScanBillScreen from '../screens/scan/ScanBillScreen';
import SearchScreen from '../screens/search/SearchScreen';
import PaymentDetailScreen from '../screens/settle/PaymentDetailScreen';
import SettleUpScreen from '../screens/settle/SettleUpScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

// Functions, not constants: the colours must be read while rendering so they follow dark mode.
const headerTitleStyle = () => ({ fontWeight: font.weightSemibold, color: colors.text });

const stackScreenOptions = (): NativeStackNavigationOptions => ({
  headerStyle: { backgroundColor: colors.card },
  headerTitleStyle: headerTitleStyle(),
  headerTintColor: colors.primary,
  headerBackButtonDisplayMode: 'minimal',
  contentStyle: { backgroundColor: colors.background },
});

/**
 * Editor screens (AddExpense, SplitOptions, PaidBy, ScanBill, ItemizedSplit, SettleUp,
 * FriendEdit, GroupEdit, ImportSplitwise, ShareGroup, JoinGroup) slide up as modals on iOS, where a modal has no back button, so they
 * get a close button. Android uses a normal push (sliding up, so it still reads as an editor)
 * and web a plain push, both with the usual back arrow.
 */
function modal(navigation: { goBack(): void }, title: string): NativeStackNavigationOptions {
  if (Platform.OS === 'android') return { title, animation: 'slide_from_bottom' };
  if (Platform.OS !== 'ios') return { title };
  return {
    title,
    presentation: 'modal',
    headerLeft: () => (
      <IconButton icon="close" color={colors.primary} onPress={() => navigation.goBack()} accessibilityLabel="Close" />
    ),
  };
}

const TAB_ICONS: Record<Exclude<keyof TabParamList, 'AddTab'>, [string, string]> = {
  Groups: ['people-outline', 'people'],
  Friends: ['person-outline', 'person'],
  Activity: ['pulse-outline', 'pulse'],
  Account: ['person-circle-outline', 'person-circle'],
};

function tabOptions(name: keyof typeof TAB_ICONS, title: string): BottomTabNavigationOptions {
  const [outline, filled] = TAB_ICONS[name];
  return {
    title,
    tabBarIcon: ({ color, size, focused }) => <Icon name={focused ? filled : outline} size={size} color={color} />,
  };
}

/** Never shown: pressing the centre tab opens AddExpense instead (see the tabPress listener). */
function AddTabPlaceholder() {
  return null;
}

/** Raised green "+" in the middle of the tab bar. */
function AddTabButton({ onPress, testID }: BottomTabBarButtonProps) {
  const navigation = useNavigation<RootNavigation>();
  const press = (e: GestureResponderEvent) => {
    // The tab bar's onPress emits `tabPress`, which the AddTab listener turns into AddExpense.
    if (onPress) onPress(e);
    else navigation.navigate('AddExpense');
  };
  return (
    <View style={styles.addSlot}>
      <Pressable
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel="Add expense"
        testID={testID}
        hitSlop={6}
        style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
      >
        <Icon name="add" size={32} color={colors.white} />
      </Pressable>
    </View>
  );
}

function Tabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: headerTitleStyle(),
        headerTintColor: colors.primary,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        // The default 49 px bar leaves the 11 px labels about 10 px, which clips them on web.
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: TAB_BAR_HEIGHT + insets.bottom },
        tabBarLabelStyle: { fontSize: 11, fontWeight: font.weightSemibold },
        tabBarHideOnKeyboard: Platform.OS === 'android',
      }}
    >
      <Tab.Screen name="Groups" component={GroupsScreen} options={tabOptions('Groups', 'Groups')} />
      <Tab.Screen name="Friends" component={FriendsScreen} options={tabOptions('Friends', 'Friends')} />
      <Tab.Screen
        name="AddTab"
        component={AddTabPlaceholder}
        options={{
          title: 'Add expense',
          tabBarAccessibilityLabel: 'Add expense',
          tabBarButtonTestID: 'tab-add-expense',
          tabBarButton: (props) => <AddTabButton {...props} />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.getParent<RootNavigation | undefined>()?.navigate('AddExpense');
          },
        })}
      />
      <Tab.Screen name="Activity" component={ActivityScreen} options={tabOptions('Activity', 'Activity')} />
      <Tab.Screen name="Account" component={AccountScreen} options={tabOptions('Account', 'Account')} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Tabs" screenOptions={stackScreenOptions()}>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false, title: 'SplitSnap' }} />

      {/* GroupDetail and FriendDetail show the name in their content; their title only names the web tab. */}
      <Stack.Screen name="GroupDetail" component={GroupDetailScreen} options={{ title: 'Group', headerTitle: '' }} />
      <Stack.Screen
        name="GroupEdit"
        component={GroupEditScreen}
        options={({ navigation, route }) => modal(navigation, route.params?.groupId ? 'Edit group' : 'New group')}
      />
      <Stack.Screen name="GroupBalances" component={GroupBalancesScreen} options={{ title: 'Balances' }} />
      <Stack.Screen name="GroupTotals" component={GroupTotalsScreen} options={{ title: 'Totals' }} />

      <Stack.Screen name="FriendDetail" component={FriendDetailScreen} options={{ title: 'Friend', headerTitle: '' }} />
      <Stack.Screen
        name="FriendEdit"
        component={FriendEditScreen}
        options={({ navigation, route }) => modal(navigation, route.params?.friendId ? 'Edit friend' : 'Add friend')}
      />

      <Stack.Screen
        name="AddExpense"
        component={AddExpenseScreen}
        // Centred between its 'Cancel' and 'Save' text buttons (left-aligned it read as 'Cancel Add expense').
        options={({ navigation, route }) => ({
          ...modal(navigation, route.params?.expenseId ? 'Edit expense' : 'Add expense'),
          headerTitleAlign: 'center',
        })}
      />
      <Stack.Screen name="SplitOptions" component={SplitOptionsScreen} options={({ navigation }) => modal(navigation, 'Split options')} />
      <Stack.Screen name="PaidBy" component={PaidByScreen} options={({ navigation }) => modal(navigation, 'Paid by')} />
      <Stack.Screen name="ScanBill" component={ScanBillScreen} options={({ navigation }) => modal(navigation, 'Scan a bill')} />
      <Stack.Screen
        name="ItemizedSplit"
        component={ItemizedSplitScreen}
        options={({ navigation }) => modal(navigation, 'Split by item')}
      />
      <Stack.Screen name="ExpenseDetail" component={ExpenseDetailScreen} options={{ title: 'Expense' }} />

      <Stack.Screen name="SettleUp" component={SettleUpScreen} options={({ navigation }) => modal(navigation, 'Settle up')} />
      <Stack.Screen name="PaymentDetail" component={PaymentDetailScreen} options={{ title: 'Payment' }} />

      <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen
        name="ImportSplitwise"
        component={ImportSplitwiseScreen}
        options={({ navigation }) => modal(navigation, 'Import from Splitwise')}
      />
      <Stack.Screen name="SyncTest" component={SyncTestScreen} options={{ title: 'Shared groups test' }} />
      <Stack.Screen name="ShareGroup" component={ShareGroupScreen} options={({ navigation }) => modal(navigation, 'Share group')} />
      <Stack.Screen name="JoinGroup" component={JoinGroupScreen} options={({ navigation }) => modal(navigation, 'Join a group')} />
    </Stack.Navigator>
  );
}

const ADD_SIZE = 58;
const TAB_BAR_HEIGHT = 56;

const styles = themed((colors) => StyleSheet.create({
  addSlot: { flex: 1, alignItems: 'center' },
  addButton: {
    width: ADD_SIZE,
    height: ADD_SIZE,
    borderRadius: ADD_SIZE / 2,
    marginTop: -18,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowStyle(2),
  },
  addButtonPressed: { backgroundColor: colors.primaryDark },
}));
