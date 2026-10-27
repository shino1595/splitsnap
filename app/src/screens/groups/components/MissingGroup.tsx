import * as React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../navigation/types';
import { EmptyState, Screen } from '../../../ui';

/** Shown when a screen's group was deleted (or never existed). */
export function MissingGroup() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // popTo reuses the tab navigator already in the stack (navigate would push a second one).
  const backToGroups = () => navigation.popTo('Tabs', { screen: 'Groups' });
  return (
    <Screen>
      <EmptyState
        icon="alert-circle-outline"
        title="Group not found"
        message="This group was deleted or is no longer available."
        actionTitle="Back to groups"
        onAction={backToGroups}
      />
    </Screen>
  );
}
