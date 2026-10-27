import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { ME_ID } from '../../types';
import type { CurrencyCode, GroupType, ID, Person } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { canDeleteGroup, canRemoveGroupMember, listFriends, liveExpenses, livePayments, personName } from '../../store/selectors';
import { CURRENCIES, currencyInfo } from '../../lib/money';
import { avatarPalette, colors, spacing, themed } from '../../theme';
import {
  AppText,
  Banner,
  Button,
  Card,
  confirmAsync,
  Icon,
  ListItem,
  OptionPicker,
  Screen,
  SectionHeader,
  SegmentedControl,
  showAlert,
  SwitchRow,
  TextField,
} from '../../ui';
import { EmojiGrid } from './components/EmojiGrid';
import { GroupAvatar } from './components/GroupAvatar';
import { ListCard } from './components/ListCard';
import { MemberPicker } from './components/MemberPicker';
import { MissingGroup } from './components/MissingGroup';
import { GROUP_TYPES, groupTypeInfo } from './components/groupMeta';
import { cleanName, deletionNote, findPersonByName, lockedMemberDetail, memberNets } from './groupLogic';

type Props = RootScreenProps<'GroupEdit'>;

const TYPE_OPTIONS = GROUP_TYPES.map((t) => ({ value: t.value, label: t.label }));

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} — ${c.name}`,
  subtitle: c.symbol.trim(),
}));

const SIMPLIFY_HELP =
  'Combines debts so everyone pays as few people as possible. Nobody ends up owing more or less in total.';

/** Everything the form edits, as one comparable string. */
function formKey(
  name: string,
  type: GroupType,
  emoji: string,
  memberIds: ID[],
  currency: CurrencyCode,
  simplify: boolean,
  archived: boolean,
): string {
  return JSON.stringify([cleanName(name), type, emoji, [...memberIds].sort(), currency, simplify, archived]);
}

export default function GroupEditScreen({ navigation, route }: Props) {
  const groupId = route.params?.groupId;
  const state = useAppState();
  const actions = useActions();
  const existing = groupId ? state.groups[groupId] : undefined;
  const isEdit = !!groupId;

  const [name, setName] = React.useState(existing?.name ?? '');
  const [type, setType] = React.useState<GroupType>(existing?.type ?? 'trip');
  const [emoji, setEmoji] = React.useState(existing?.emoji ?? groupTypeInfo('trip').emoji);
  const [emojiPicked, setEmojiPicked] = React.useState(!!existing);
  const [memberIds, setMemberIds] = React.useState<ID[]>(() =>
    existing ? existing.memberIds.filter((id) => id !== ME_ID) : [],
  );
  const [currency, setCurrency] = React.useState<CurrencyCode>(
    existing?.defaultCurrency ?? state.settings.defaultCurrency,
  );
  const [simplify, setSimplify] = React.useState(existing?.simplifyDebts ?? state.settings.simplifyDebtsDefault);
  const [archived, setArchived] = React.useState(!!existing?.archived);
  // People typed into "Add a new person": they become friends only when the group is saved.
  const [pending, setPending] = React.useState<Person[]>([]);
  const [submitted, setSubmitted] = React.useState(false);
  const [currencyOpen, setCurrencyOpen] = React.useState(false);
  // Set once the screen is about to close (saved or deleted): skips the discard question, and
  // renders nothing while a deleted group's editor is popped.
  const leavingRef = React.useRef(false);
  // Guards Save / Delete against a double tap (the screen stays mounted while it closes).
  const busyRef = React.useRef(false);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit group' : 'New group' });
  }, [navigation, isEdit]);

  // What the form started with, to tell whether there is anything to discard.
  const [initialForm] = React.useState(() => formKey(name, type, emoji, memberIds, currency, simplify, archived));
  const dirty = formKey(name, type, emoji, memberIds, currency, simplify, archived) !== initialForm;

  // Ask before throwing away changes (back button, swipe down, hardware back).
  usePreventRemove(dirty, ({ data }) => {
    if (leavingRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    void confirmAsync(
      isEdit ? 'Discard changes?' : 'Discard this group?',
      isEdit ? 'Your changes to this group will be lost.' : "The group hasn't been created yet.",
      { confirmText: 'Discard', cancelText: 'Keep editing', destructive: true },
    ).then((ok) => {
      if (!ok) return;
      leavingRef.current = true;
      navigation.dispatch(data.action);
    });
  });

  // Friends, plus current members who are not on the friends list, plus people added here.
  const candidates = React.useMemo(() => {
    const list: Person[] = listFriends(state);
    const ids = new Set(list.map((p) => p.id));
    const extra = [...(existing ? existing.memberIds : []), ...memberIds];
    for (const id of extra) {
      const person = state.people[id];
      if (id !== ME_ID && person && !ids.has(id)) {
        ids.add(id);
        list.push(person);
      }
    }
    return [...list, ...pending];
  }, [state, existing, memberIds, pending]);

  // Members who can't be removed: the full reason (alert) and a short line (list).
  const locks = React.useMemo(() => {
    const reasons: Record<ID, string> = {};
    const details: Record<ID, string> = {};
    if (!existing) return { reasons, details };
    const nets = memberNets(state, existing.id);
    for (const id of existing.memberIds) {
      if (id === ME_ID) continue;
      const guard = canRemoveGroupMember(state, existing.id, id);
      if (guard.ok) continue;
      reasons[id] = guard.reason ?? 'This member still has a balance in the group.';
      details[id] = lockedMemberDetail(nets.find((n) => n.id === id)?.amounts ?? {});
    }
    return { reasons, details };
  }, [state, existing]);

  const deleteGuard = React.useMemo(() => (existing ? canDeleteGroup(state, existing.id) : null), [state, existing]);

  const recordNote = React.useMemo(
    () =>
      existing
        ? deletionNote(liveExpenses(state, { groupId: existing.id }).length, livePayments(state, { groupId: existing.id }).length)
        : '',
    [state, existing],
  );

  if (isEdit && !existing) return leavingRef.current ? null : <MissingGroup />;

  const nameError = submitted && !name.trim() ? 'Give the group a name' : null;
  const info = currencyInfo(currency);

  const changeType = (next: GroupType) => {
    setType(next);
    if (!emojiPicked) setEmoji(groupTypeInfo(next).emoji);
  };

  const pickEmoji = (next: string) => {
    setEmoji(next);
    setEmojiPicked(true);
  };

  const toggleMember = (id: ID) => {
    if (memberIds.indexOf(id) < 0) {
      setMemberIds([...memberIds, id]);
      return;
    }
    const reason = locks.reasons[id];
    if (reason) {
      showAlert(`Can't remove ${personName(state, id)}`, reason);
      return;
    }
    setMemberIds(memberIds.filter((m) => m !== id));
  };

  /** Selects a friend with that name, or lists a new person to be added on save. */
  const addPerson = (typed: string): string | null => {
    const newName = cleanName(typed);
    const match = findPersonByName(candidates, newName);
    if (match) {
      const already = memberIds.indexOf(match.id) >= 0;
      if (!already) setMemberIds([...memberIds, match.id]);
      return already ? `${match.name} is already in this group.` : `${match.name} is already your friend, so we ticked them.`;
    }
    const person: Person = {
      id: `new_${Date.now().toString(36)}_${pending.length}`,
      name: newName,
      // The colour the store will give this person when it is saved.
      color: avatarPalette[(Object.keys(state.people).length + pending.length) % avatarPalette.length],
      createdAt: new Date().toISOString(),
    };
    setPending([...pending, person]);
    setMemberIds([...memberIds, person.id]);
    return null;
  };

  const save = () => {
    if (busyRef.current) return;
    setSubmitted(true);
    const trimmed = cleanName(name);
    if (!trimmed) return;
    busyRef.current = true;
    leavingRef.current = true;

    // New people become friends now; unticked ones are dropped.
    const realIds: ID[] = memberIds.map((id) => {
      const draft = pending.find((p) => p.id === id);
      return draft ? actions.addFriend({ name: draft.name }).id : id;
    });

    if (!existing) {
      const group = actions.createGroup({
        name: trimmed,
        type,
        emoji,
        memberIds: [ME_ID, ...realIds],
        defaultCurrency: currency,
        simplifyDebts: simplify,
      });
      navigation.replace('GroupDetail', { groupId: group.id });
      return;
    }

    const failures: string[] = [];
    for (const id of existing.memberIds) {
      if (id === ME_ID || realIds.indexOf(id) >= 0) continue;
      const result = actions.removeGroupMember(existing.id, id);
      if (!result.ok) failures.push(result.reason ?? `${personName(state, id)} could not be removed.`);
    }
    for (const id of realIds) {
      if (existing.memberIds.indexOf(id) < 0) actions.addGroupMember(existing.id, id);
    }
    actions.updateGroup(existing.id, {
      name: trimmed,
      type,
      emoji,
      defaultCurrency: currency,
      simplifyDebts: simplify,
      // undefined (not false) so an unchanged, never-archived group stays identical.
      archived: archived ? true : undefined,
    });
    if (failures.length > 0) showAlert('Some members were kept', failures.join('\n\n'));
    navigation.goBack();
  };

  const removeGroup = async () => {
    if (!existing || busyRef.current) return;
    const guard = canDeleteGroup(state, existing.id);
    if (!guard.ok) {
      showAlert("Can't delete this group yet", guard.reason);
      return;
    }
    busyRef.current = true;
    const ok = await confirmAsync(`Delete "${existing.name}"?`, `This can't be undone.${recordNote}`, {
      confirmText: 'Delete group',
      destructive: true,
    });
    if (!ok) {
      busyRef.current = false;
      return;
    }
    leavingRef.current = true;
    const result = actions.deleteGroup(existing.id);
    if (!result.ok) {
      leavingRef.current = false;
      busyRef.current = false;
      showAlert("Can't delete this group", result.reason);
      return;
    }
    navigation.popToTop();
  };

  const blockedDelete = deleteGuard && !deleteGuard.ok ? deleteGuard.reason ?? 'Everyone must be settled up first.' : null;

  return (
    <Screen
      keyboard
      footer={
        <Button
          title={isEdit ? 'Save changes' : 'Create group'}
          icon="checkmark"
          size="lg"
          onPress={save}
          fullWidth
          testID="group-save"
        />
      }
    >
      <View style={styles.preview}>
        <GroupAvatar group={{ emoji, type, name: name.trim() || 'New group' }} size={72} />
      </View>

      <TextField
        label="Group name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Goa Trip, Flat 302"
        autoFocus={!isEdit}
        autoCapitalize="words"
        maxLength={60}
        returnKeyType="done"
        error={nameError}
        testID="group-name"
      />

      <SectionHeader title="Type" />
      <SegmentedControl options={TYPE_OPTIONS} value={type} onChange={changeType} />

      <SectionHeader title="Picture" />
      <Card>
        <EmojiGrid value={emoji} onChange={pickEmoji} />
      </Card>

      <SectionHeader title={`Members · ${memberIds.length + 1}`} />
      <ListCard>
        <MemberPicker
          me={state.people[ME_ID]}
          people={candidates}
          selected={memberIds}
          onToggle={toggleMember}
          locked={locks.details}
          pendingIds={pending.map((p) => p.id)}
          onAddPerson={addPerson}
        />
      </ListCard>
      {memberIds.length === 0 ? (
        <AppText variant="caption" style={styles.hint}>
          {candidates.length > 0
            ? 'Pick the friends you share costs with, or add a new person. You can change this later.'
            : 'Add the people you share costs with by name. You can change this later.'}
        </AppText>
      ) : null}

      <SectionHeader title="Settings" />
      <ListCard>
        <ListItem
          title="Default currency"
          subtitle={`${info.code} — ${info.name}`}
          left={
            <View style={styles.iconCircle}>
              <Icon name="wallet-outline" size={20} color={colors.primaryDark} />
            </View>
          }
          right={
            <AppText weight="semibold" color={colors.textMuted}>
              {info.symbol.trim()}
            </AppText>
          }
          showChevron
          onPress={() => setCurrencyOpen(true)}
          accessibilityLabel={`Default currency, ${info.name}. Change`}
        />
        <View style={styles.switchWrap}>
          <SwitchRow label="Simplify group debts" value={simplify} onValueChange={setSimplify} description={SIMPLIFY_HELP} />
        </View>
        {isEdit ? (
          <View style={styles.switchWrap}>
            <SwitchRow
              label="Archive group"
              value={archived}
              onValueChange={setArchived}
              description="Hides the group from your Groups list. Balances still count, and you can unarchive it any time."
            />
          </View>
        ) : null}
      </ListCard>

      {existing ? (
        <>
          <SectionHeader title="Delete group" />
          <Card style={styles.dangerCard}>
            {blockedDelete ? (
              <Banner
                tone="warning"
                title="Settle up first"
                message={blockedDelete}
                actionTitle="View balances"
                onAction={() => navigation.navigate('GroupBalances', { groupId: existing.id })}
              />
            ) : (
              <AppText variant="caption">
                Deletes the group and all of its expenses and payments for everyone. This can't be undone.
              </AppText>
            )}
            <Button
              title="Delete group"
              icon="trash-outline"
              variant={blockedDelete ? 'outline' : 'danger'}
              disabled={!!blockedDelete}
              onPress={() => void removeGroup()}
              fullWidth
              accessibilityLabel={blockedDelete ? 'Delete group, unavailable until everyone is settled up' : 'Delete group'}
            />
          </Card>
        </>
      ) : null}

      <OptionPicker
        visible={currencyOpen}
        onClose={() => setCurrencyOpen(false)}
        title="Default currency"
        options={CURRENCY_OPTIONS}
        selected={currency}
        onSelect={setCurrency}
        searchable
      />
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  preview: { alignItems: 'center', marginBottom: spacing.lg },
  hint: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchWrap: { paddingHorizontal: spacing.lg },
  dangerCard: { gap: spacing.md },
}));
