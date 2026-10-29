// Share a local group (your name first, what sharing means, then the join code), or show a shared
// group's join code and who is on SplitSnap (docs/SYNC_DESIGN.md §7).
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { groupMembers } from '../../store/selectors';
import { useSync } from '../../sync/SyncProvider';
import { colors, font, radius, spacing, themed } from '../../theme';
import {
  AppText,
  Banner,
  Button,
  Card,
  confirmAsync,
  EmptyState,
  Icon,
  LoadingOverlay,
  PersonAvatar,
  Screen,
  SectionHeader,
  shareText,
  showAlert,
  TextField,
} from '../../ui';
import { ListCard } from '../groups/components/ListCard';
import { MissingGroup } from '../groups/components/MissingGroup';
import { meLabel, plural } from '../groups/components/groupMeta';
import {
  cleanDisplayName,
  DISPLAY_NAME_MAX,
  displayNameDraft,
  displayNameProblem,
  formatJoinCode,
  inviteMessage,
  inviteTitle,
  memberBadge,
  syncErrorText,
} from './sharingLogic';

type Props = RootScreenProps<'ShareGroup'>;

type Busy = 'share' | 'code' | 'off' | null;

const AVATAR = 36;
const MEMBER_INSET = spacing.lg + AVATAR + spacing.md;

/** False once the screen is gone, so a late server answer doesn't set state. */
export function useMounted(): React.RefObject<boolean> {
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** Shown when this build has no shared-groups server (sync status 'off'). */
export function SharingUnavailable({ onBack }: { onBack: () => void }) {
  return (
    <Screen>
      <EmptyState
        icon="cloud-offline-outline"
        title="Sharing isn't available"
        message="This version of SplitSnap has no shared-groups server, so your groups stay on this phone."
        actionTitle="Go back"
        onAction={onBack}
      />
    </Screen>
  );
}

export interface DisplayNameFormProps {
  /** What the field starts with. */
  initial: string;
  /** Saves the cleaned name; a thrown error is shown under the field. */
  onSave: (name: string) => Promise<void>;
  saveTitle?: string;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/** Your name as other members see it: asked before sharing or joining, and editable in Settings. */
export function DisplayNameForm({ initial, onSave, saveTitle = 'Save', onCancel, autoFocus = false }: DisplayNameFormProps) {
  const [text, setText] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const mounted = useMounted();

  const save = async () => {
    if (busy) return;
    const problem = displayNameProblem(text);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await onSave(cleanDisplayName(text));
    } catch (e) {
      if (mounted.current) setError(syncErrorText(e, "Couldn't save your name. Please try again."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <View style={styles.nameForm}>
      <TextField
        label="Your name"
        value={text}
        onChangeText={(t) => {
          setText(t);
          if (error) setError(null);
        }}
        placeholder="e.g. Aarav"
        autoCapitalize="words"
        autoCorrect={false}
        autoFocus={autoFocus}
        maxLength={DISPLAY_NAME_MAX}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        error={error}
        helper="The other members see this name next to everything you add."
        testID="sharing-name"
      />
      <View style={styles.nameButtons}>
        {onCancel ? <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} testID="sharing-name-cancel" /> : null}
        <Button title={saveTitle} icon="checkmark" onPress={() => void save()} loading={busy} testID="sharing-name-save" />
      </View>
    </View>
  );
}

function MemberBadge({ onSplitSnap }: { onSplitSnap: boolean }) {
  const tint = onSplitSnap ? colors.primaryDark : colors.textMuted;
  return (
    <View style={[styles.badge, onSplitSnap ? styles.badgeOn : styles.badgeInvited]}>
      <Icon name={onSplitSnap ? 'checkmark-circle' : 'time-outline'} size={13} color={tint} />
      <AppText variant="caption" weight="semibold" color={tint} numberOfLines={1}>
        {memberBadge(onSplitSnap)}
      </AppText>
    </View>
  );
}

function Point({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.point}>
      <Icon name={icon} size={20} color={colors.primaryDark} />
      <AppText variant="label" weight="regular" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

export default function ShareGroupScreen({ navigation, route }: Props) {
  const { groupId } = route.params;
  const state = useAppState();
  const sync = useSync();
  const group = state.groups[groupId];
  const info = sync.shared(groupId);
  const mounted = useMounted();

  const [busy, setBusy] = React.useState<Busy>(null);
  const [editingName, setEditingName] = React.useState(false);
  // Saved here too, in case the provider shows the new name a render later.
  const [savedName, setSavedName] = React.useState<string | null>(null);
  // The code a call just returned, until the sync bookkeeping (or another member's change) shows it.
  const [latest, setLatest] = React.useState<{ code: string; enabled: boolean } | null>(null);

  const infoCode = info ? info.joinCode : null;
  const infoEnabled = info ? info.joinEnabled : false;
  React.useEffect(() => {
    setLatest(null);
  }, [infoCode, infoEnabled]);

  const isShared = !!info || latest !== null;
  React.useLayoutEffect(() => {
    navigation.setOptions({ title: isShared ? 'Shared group' : 'Share group' });
  }, [navigation, isShared]);

  if (!group) return <MissingGroup />;
  if (sync.status === 'off') return <SharingUnavailable onBack={() => navigation.goBack()} />;

  const displayName = sync.displayName ?? savedName;
  const members = groupMembers(state, groupId);

  const saveName = async (name: string) => {
    await sync.setDisplayName(name);
    if (!mounted.current) return;
    setSavedName(name);
    setEditingName(false);
  };

  const share = async () => {
    if (busy) return;
    setBusy('share');
    try {
      const code = await sync.shareGroup(groupId);
      if (mounted.current) setLatest({ code, enabled: true });
    } catch (e) {
      showAlert("Couldn't share the group", syncErrorText(e, 'Something went wrong while uploading the group. Please try again.'));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const code = latest ? latest.code : infoCode;
  const activeCode = (latest ? latest.enabled : infoEnabled) && code ? code : null;

  const changeCode = async (enabled: boolean) => {
    if (busy) return;
    if (enabled && activeCode) {
      const ok = await confirmAsync(
        'Make a new code?',
        'The current code stops working. People who already joined stay in the group.',
        { confirmText: 'New code' },
      );
      if (!ok) return;
    }
    if (!enabled) {
      const ok = await confirmAsync(
        'Turn off joining?',
        'Nobody new can join with a code. People who already joined stay in the group, and you can turn joining on again later.',
        { confirmText: 'Turn off', destructive: true },
      );
      if (!ok) return;
    }
    setBusy(enabled ? 'code' : 'off');
    try {
      const next = await sync.resetJoinCode(groupId, enabled);
      if (mounted.current) setLatest({ code: next, enabled });
    } catch (e) {
      showAlert(enabled ? "Couldn't make a new code" : "Couldn't turn off joining", syncErrorText(e, 'Please try again.'));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const invite = () => {
    if (activeCode) void shareText(inviteMessage(group.name, activeCode), inviteTitle(group.name));
  };

  // ----- not shared yet: your name, then what sharing means -----

  if (!isShared) {
    if (!displayName || editingName) {
      return (
        <Screen keyboard>
          <Card style={styles.card}>
            <AppText variant="heading">{displayName ? 'Change your name' : 'First, your name'}</AppText>
            <AppText variant="label" weight="regular" color={colors.textMuted}>
              Shared groups show who added what, so the others need to know it's you.
            </AppText>
            <DisplayNameForm
              initial={displayNameDraft(displayName, state.people[ME_ID]?.name)}
              onSave={saveName}
              saveTitle={displayName ? 'Save' : 'Continue'}
              onCancel={displayName ? () => setEditingName(false) : undefined}
              autoFocus
            />
          </Card>
        </Screen>
      );
    }

    const others = members.length - 1;
    return (
      <Screen
        footer={
          <Button
            title="Share group"
            icon="share-social-outline"
            size="lg"
            onPress={() => void share()}
            disabled={!!busy}
            fullWidth
            testID="share-group"
          />
        }
      >
        {sync.status === 'offline' ? (
          <Banner tone="warning" message="You're offline. Sharing uploads the group, so it needs a connection." style={styles.gapBelow} />
        ) : null}
        <Card style={styles.card}>
          <AppText variant="heading">Share {group.name}</AppText>
          <AppText variant="label" weight="regular" color={colors.textMuted}>
            Everyone in the group can then add and see expenses from their own phone. You get a code to send them.
          </AppText>
          <Point
            icon="people-outline"
            text="Whoever joins with the code sees this group's expenses, payments, comments and activity, and can add and change them."
          />
          <Point
            icon="person-add-outline"
            text={
              others > 0
                ? `The ${plural(others, 'other member is', 'other members are')} added as Invited. Each one taps "That's me" on their name when they join.`
                : 'Invite people with the code. They join as new members.'
            }
          />
          <Point icon="lock-closed-outline" text="Only this group is shared. Your other groups and non-group expenses stay on this phone." />
          <Point
            icon="server-outline"
            text="The group is stored on SplitSnap's server, and whoever runs this SplitSnap project can see its data. Keep anything private out of it."
          />
          <Point icon="image-outline" text="Bill photos stay on this phone. The others see the items and amounts, not the picture." />
        </Card>
        <View style={styles.nameLine}>
          <AppText variant="caption" numberOfLines={2} style={styles.flex}>
            The others will see you as <AppText variant="caption" weight="semibold">{displayName}</AppText>.
          </AppText>
          <Button title="Change" variant="ghost" size="sm" onPress={() => setEditingName(true)} testID="share-change-name" />
        </View>
        <LoadingOverlay visible={busy === 'share'} message="Sharing the group…" />
      </Screen>
    );
  }

  // ----- shared: the code and who is on SplitSnap -----

  return (
    <Screen>
      <Card style={styles.codeCard}>
        <AppText variant="label" color={colors.textMuted} align="center">
          Join code
        </AppText>
        {activeCode ? (
          <>
            <AppText
              selectable
              align="center"
              style={styles.code}
              accessibilityLabel={`Join code ${activeCode.split('').join(' ')}`}
              testID="share-code"
            >
              {formatJoinCode(activeCode)}
            </AppText>
            <AppText variant="caption" align="center">
              Anyone with this code can join {group.name} and see everything in it. Send it only to the people in the group.
            </AppText>
            <Button title="Send invite" icon="paper-plane-outline" size="lg" onPress={invite} disabled={!!busy} fullWidth testID="share-invite" />
            <View style={styles.codeActions}>
              <Button
                title="New code"
                icon="refresh-outline"
                variant="outline"
                size="sm"
                onPress={() => void changeCode(true)}
                loading={busy === 'code'}
                disabled={!!busy}
                style={styles.flex}
                testID="share-new-code"
              />
              <Button
                title="Turn off joining"
                icon="close-circle-outline"
                variant="outline"
                size="sm"
                onPress={() => void changeCode(false)}
                loading={busy === 'off'}
                disabled={!!busy}
                style={styles.flex}
                testID="share-joining-off"
              />
            </View>
          </>
        ) : (
          <>
            <AppText weight="semibold" align="center">
              Joining is off
            </AppText>
            <AppText variant="caption" align="center">
              Nobody new can join this group. Turning joining on makes a new code; the old one stays switched off.
            </AppText>
            <Button
              title="Turn joining on"
              icon="key-outline"
              onPress={() => void changeCode(true)}
              loading={busy === 'code'}
              disabled={!!busy}
              fullWidth
              testID="share-joining-on"
            />
          </>
        )}
      </Card>

      <SectionHeader title={`Members · ${members.length}`} />
      <ListCard dividerInset={MEMBER_INSET}>
        {members.map((person) => {
          const isMe = person.id === ME_ID;
          const on = isMe || sync.isOnSplitSnap(groupId, person.id);
          const label = isMe ? meLabel(displayName ?? person.name) : person.name;
          return (
            <View key={person.id} style={styles.memberRow} accessible accessibilityLabel={`${label}, ${memberBadge(on)}`}>
              <PersonAvatar person={person} size={AVATAR} />
              <AppText weight="medium" numberOfLines={1} style={styles.flex}>
                {label}
              </AppText>
              <MemberBadge onSplitSnap={on} />
            </View>
          );
        })}
      </ListCard>
      <AppText variant="caption" style={styles.hint}>
        Invited people join with the code and tap "That's me" on their name. Anyone can also join as a new member. Bill
        photos stay on the phone that took them.
      </AppText>
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { gap: spacing.md },
  gapBelow: { marginBottom: spacing.md },
  nameForm: { gap: spacing.md },
  nameButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingLeft: spacing.xs },
  codeCard: { gap: spacing.md, alignItems: 'stretch' },
  code: {
    fontSize: font.amount,
    fontWeight: font.weightBold,
    letterSpacing: 3,
    color: colors.text,
    paddingVertical: spacing.xs,
  },
  codeActions: { flexDirection: 'row', gap: spacing.sm },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  badgeOn: { backgroundColor: colors.primarySoft },
  badgeInvited: { backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  hint: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
}));
