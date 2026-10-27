import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { ME_ID } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { canRemoveFriend, friendBalance } from '../../store/selectors';
import { isSettled } from '../../lib/balances';
import { colors, spacing, themed } from '../../theme';
import { AppText, Avatar, Banner, Button, EmptyState, Icon, Screen, SectionHeader, TextField, confirmAsync, showAlert } from '../../ui';
import { removeButtonTitle, sameNameFriend, validateFriendForm } from './friendLogic';
import type { FriendForm } from './friendLogic';

type Field = keyof FriendForm;

export default function FriendEditScreen({ navigation, route }: RootScreenProps<'FriendEdit'>) {
  const friendId = route.params?.friendId;
  const editing = !!friendId;
  const state = useAppState();
  const actions = useActions();
  const person = friendId ? state.people[friendId] : undefined;

  // The values the form opened with; anything else counts as an unsaved change.
  const [initial] = React.useState<FriendForm>(() => ({
    name: person?.name ?? '',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    upiId: person?.upiId ?? '',
  }));
  const [form, setForm] = React.useState<FriendForm>(initial);
  const [touched, setTouched] = React.useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const leavingRef = React.useRef(false);

  const errors = React.useMemo(() => validateFriendForm(form), [form]);
  const duplicate = React.useMemo(() => sameNameFriend(state, form.name, friendId), [state, form.name, friendId]);
  const dirty = (Object.keys(initial) as Field[]).some((k) => initial[k].trim() !== form[k].trim());
  const isFriend = !!friendId && friendId !== ME_ID && state.friendIds.indexOf(friendId) >= 0;
  const guard = React.useMemo(() => (isFriend && friendId ? canRemoveFriend(state, friendId) : null), [state, isFriend, friendId]);
  const unsettled = React.useMemo(() => (friendId ? !isSettled(friendBalance(state, friendId)) : false), [state, friendId]);

  const set = (field: Field) => (text: string) => setForm((f) => ({ ...f, [field]: text }));
  const blur = (field: Field) => () => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  const errorFor = (field: Field) => (submitted || touched[field] ? errors[field] : undefined);

  const goBack = React.useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.popTo('Tabs', { screen: 'Friends' });
  }, [navigation]);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: !editing ? 'Add friend' : friendId === ME_ID ? 'Your details' : 'Edit friend' });
  }, [navigation, editing, friendId]);

  // Ask before throwing away typed changes (close button, swipe down, back gesture, hardware back).
  usePreventRemove(dirty, ({ data }) => {
    if (leavingRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    confirmAsync('Discard changes?', 'Your changes to this friend will be lost.', {
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      leavingRef.current = true;
      navigation.dispatch(data.action);
    });
  });

  const save = () => {
    // A second tap before the screen closes must not add the friend twice.
    if (leavingRef.current) return;
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    const input = { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), upiId: form.upiId.trim() };
    if (friendId) {
      actions.updatePerson(friendId, input);
    } else {
      actions.addFriend({
        name: input.name,
        email: input.email || undefined,
        phone: input.phone || undefined,
        upiId: input.upiId || undefined,
      });
    }
    leavingRef.current = true;
    goBack();
  };

  const remove = async () => {
    if (!friendId || !person) return;
    const ok = await confirmAsync(
      `Remove ${person.name}?`,
      `${person.name} will be removed from your friends list. Past expenses and payments stay in your history.`,
      { confirmText: 'Remove', destructive: true },
    );
    if (!ok) return;
    const result = actions.removeFriend(friendId);
    if (!result.ok) {
      showAlert(`Can’t remove ${person.name}`, result.reason);
      return;
    }
    leavingRef.current = true;
    navigation.popTo('Tabs', { screen: 'Friends' });
  };

  if (editing && !person) {
    return (
      <Screen>
        <EmptyState
          icon="person-outline"
          title="Friend not found"
          message="This person is no longer in SplitSnap."
          actionTitle="Go back"
          onAction={() => {
            leavingRef.current = true;
            goBack();
          }}
        />
      </Screen>
    );
  }

  const previewName = form.name.trim();

  return (
    <Screen
      keyboard
      footer={<Button title={editing ? 'Save' : 'Add friend'} icon="checkmark" onPress={save} fullWidth size="lg" />}
    >
      <View style={styles.preview}>
        {previewName ? (
          <Avatar name={previewName} color={person?.color ?? colors.textFaint} size={64} />
        ) : (
          <View style={styles.placeholder} accessibilityLabel="New friend">
            <Icon name="person-outline" size={30} color={colors.textMuted} />
          </View>
        )}
      </View>

      <View style={styles.fields}>
        <TextField
          label="Name"
          value={form.name}
          onChangeText={set('name')}
          onBlur={blur('name')}
          placeholder="e.g. Aarav Sharma"
          autoFocus={!editing}
          autoCapitalize="words"
          maxLength={60}
          error={errorFor('name')}
          helper={duplicate ? `You already have a friend called ${duplicate.name}.` : undefined}
          returnKeyType="next"
          testID="friend-name"
        />
        <TextField
          label="Email (optional)"
          value={form.email}
          onChangeText={set('email')}
          onBlur={blur('email')}
          placeholder="name@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={120}
          error={errorFor('email')}
        />
        <TextField
          label="Phone (optional)"
          value={form.phone}
          onChangeText={set('phone')}
          onBlur={blur('phone')}
          placeholder="+91 98200 12345"
          keyboardType="phone-pad"
          maxLength={20}
          error={errorFor('phone')}
        />
        <TextField
          label="UPI ID (optional)"
          value={form.upiId}
          onChangeText={set('upiId')}
          onBlur={blur('upiId')}
          placeholder="name@bank"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={100}
          error={errorFor('upiId')}
          helper="Lets you pay them from a UPI app when you settle up, e.g. aarav@okicici."
          returnKeyType="done"
          onSubmitEditing={save}
        />
      </View>

      {guard && person ? (
        <View style={styles.danger}>
          <SectionHeader title="Remove friend" />
          {guard.ok ? (
            <AppText variant="caption" style={styles.dangerText}>
              You’re settled up with {person.name} and don’t share any groups, so they can be removed.
            </AppText>
          ) : (
            <Banner
              tone="warning"
              title={`Can’t remove ${person.name} yet`}
              message={guard.reason ?? 'Settle up first.'}
              actionTitle={unsettled ? 'Settle up' : undefined}
              onAction={unsettled ? () => navigation.navigate('SettleUp', { friendId: person.id }) : undefined}
              style={styles.dangerText}
            />
          )}
          <Button
            title={removeButtonTitle(person.name)}
            icon="trash-outline"
            variant="danger"
            onPress={remove}
            disabled={!guard.ok}
            fullWidth
            accessibilityLabel={guard.ok ? `Remove ${person.name} from friends` : `Remove ${person.name} (unavailable: ${guard.reason ?? ''})`}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  preview: { alignItems: 'center', marginBottom: spacing.lg },
  placeholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fields: { gap: spacing.md },
  danger: { marginTop: spacing.xl },
  dangerText: { marginBottom: spacing.md },
}));
