// Join a shared group: your name (once), the code from the invite, then "That's me" on your
// placeholder or join as a new member (docs/SYNC_DESIGN.md §7).
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { ID } from '../../types';
import type { GroupPreview } from '../../sync/types';
import type { RootScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { useSync } from '../../sync/SyncProvider';
import { avatarPalette, colors, spacing, themed } from '../../theme';
import {
  AppText,
  Avatar,
  Banner,
  Button,
  Card,
  confirmAsync,
  Icon,
  LoadingOverlay,
  Screen,
  SectionHeader,
  TextField,
} from '../../ui';
import { ListCard } from '../groups/components/ListCard';
import { plural } from '../groups/components/groupMeta';
import { DisplayNameForm, SharingUnavailable, useMounted } from './ShareGroupScreen';
import {
  CLAIMED_TEXT,
  displayNameDraft,
  joinChoices,
  joinCodeProblem,
  normalizeJoinCode,
  syncErrorText,
  WRONG_CODE_TEXT,
} from './sharingLogic';

type Props = RootScreenProps<'JoinGroup'>;

const AVATAR = 36;
const MEMBER_INSET = spacing.lg + AVATAR + spacing.md;

interface Found {
  code: string;
  group: GroupPreview;
}

export default function JoinGroupScreen({ navigation }: Props) {
  const state = useAppState();
  const sync = useSync();
  const mounted = useMounted();

  const [codeText, setCodeText] = React.useState('');
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [found, setFound] = React.useState<Found | null>(null);
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'preview' | 'join' | null>(null);
  const [editingName, setEditingName] = React.useState(false);
  const [savedName, setSavedName] = React.useState<string | null>(null);

  if (sync.status === 'off') return <SharingUnavailable onBack={() => navigation.goBack()} />;

  const displayName = sync.displayName ?? savedName;

  const saveName = async (name: string) => {
    await sync.setDisplayName(name);
    if (!mounted.current) return;
    setSavedName(name);
    setEditingName(false);
  };

  const findGroup = async () => {
    if (busy) return;
    const problem = joinCodeProblem(codeText);
    if (problem) {
      setCodeError(problem);
      return;
    }
    const code = normalizeJoinCode(codeText);
    setBusy('preview');
    setCodeError(null);
    try {
      const group = await sync.previewJoin(code);
      if (!mounted.current) return;
      if (group) {
        setFound({ code, group });
        setJoinError(null);
      } else {
        setCodeError(WRONG_CODE_TEXT);
      }
    } catch (e) {
      if (mounted.current) setCodeError(syncErrorText(e, "Couldn't look up that code. Please try again."));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  /** Reloads the member list, e.g. after someone else claimed a name first. */
  const refresh = async (code: string) => {
    try {
      const group = await sync.previewJoin(code);
      if (mounted.current && group) setFound({ code, group });
    } catch {
      // The join error is already on screen.
    }
  };

  const join = async (memberId: ID | null, memberName: string | null, openNames: string[]) => {
    if (!found || busy) return;
    const groupName = found.group.name;
    const ok = memberId
      ? await confirmAsync(
          `Join as ${memberName}?`,
          `Everything ${memberName} paid or shared in ${groupName} will show as yours. Only do this if you are ${memberName}.`,
          { confirmText: "That's me" },
        )
      : openNames.length === 0 ||
        (await confirmAsync(
          'Join as a new member?',
          `If you are ${openNames.join(' or ')}, tap "That's me" instead, so your past expenses count as yours.`,
          { confirmText: 'Join as new member' },
        ));
    if (!ok) return;
    setBusy('join');
    setJoinError(null);
    try {
      const groupId = await sync.joinGroup(found.code, memberId);
      if (mounted.current) navigation.replace('GroupDetail', { groupId });
    } catch (e) {
      if (!mounted.current) return;
      const text = syncErrorText(e, "Couldn't join the group. Please try again.");
      if (text === WRONG_CODE_TEXT) {
        // The code was changed or switched off while you were choosing.
        setFound(null);
        setCodeError(text);
      } else {
        setJoinError(text);
        if (text === CLAIMED_TEXT) void refresh(found.code);
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const nameLine = (
    <View style={styles.nameLine}>
      <AppText variant="caption" numberOfLines={2} style={styles.flex}>
        You join as <AppText variant="caption" weight="semibold">{displayName}</AppText> unless you pick your name from
        the group's list.
      </AppText>
      <Button title="Change" variant="ghost" size="sm" onPress={() => setEditingName(true)} disabled={!!busy} testID="join-change-name" />
    </View>
  );

  // ----- your name first -----

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

  // ----- the code -----

  if (!found) {
    return (
      <Screen
        keyboard
        footer={
          <Button
            title="Find the group"
            icon="search"
            size="lg"
            onPress={() => void findGroup()}
            loading={busy === 'preview'}
            fullWidth
            testID="join-find"
          />
        }
      >
        {sync.status === 'offline' ? (
          <Banner tone="warning" message="You're offline. Joining a group needs a connection." style={styles.gapBelow} />
        ) : null}
        <Card style={styles.card}>
          <AppText variant="heading">Enter the join code</AppText>
          <AppText variant="label" weight="regular" color={colors.textMuted}>
            Ask someone in the group to send you an invite. The code has 8 letters and numbers.
          </AppText>
          <TextField
            label="Join code"
            value={codeText}
            onChangeText={(t) => {
              setCodeText(t.toUpperCase());
              if (codeError) setCodeError(null);
            }}
            placeholder="e.g. K7M2-QX9P"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={24}
            returnKeyType="go"
            onSubmitEditing={() => void findGroup()}
            error={codeError}
            inputStyle={styles.codeInput}
            testID="join-code"
          />
        </Card>
        {nameLine}
      </Screen>
    );
  }

  // ----- who are you? -----

  const { group } = found;
  const choices = joinChoices(group, displayName);
  const openNames = choices.open.map((m) => m.name);
  const alreadyIn = !!sync.shared(group.id) && !!state.groups[group.id];
  const colorFor = (id: ID, index: number) => state.people[id]?.color ?? avatarPalette[index % avatarPalette.length];

  return (
    <Screen>
      <Card style={styles.groupCard}>
        <Avatar name={group.name} color={colors.primarySoft} emoji={group.emoji} size={56} />
        <View style={styles.flex}>
          <AppText variant="heading" numberOfLines={2}>
            {group.name}
          </AppText>
          <AppText variant="caption">{plural(group.members.length, 'member')}</AppText>
        </View>
      </Card>

      {alreadyIn ? (
        <Banner
          tone="info"
          message={`You're already in ${group.name} on this phone.`}
          actionTitle="Open the group"
          onAction={() => navigation.replace('GroupDetail', { groupId: group.id })}
          style={styles.gapAbove}
        />
      ) : null}
      {joinError ? <Banner tone="danger" message={joinError} style={styles.gapAbove} /> : null}

      <SectionHeader title="Who are you in this group?" />
      {choices.open.length > 0 ? (
        <ListCard dividerInset={MEMBER_INSET}>
          {choices.open.map((m, i) => {
            const likely = m.id === choices.suggested;
            return (
              <View key={m.id} style={styles.memberRow}>
                <Avatar name={m.name} color={colorFor(m.id, i)} size={AVATAR} />
                <View style={styles.flex}>
                  <AppText weight="medium" numberOfLines={1}>
                    {m.name}
                  </AppText>
                  {likely ? (
                    <AppText variant="caption" color={colors.primaryDark}>
                      Same name as yours
                    </AppText>
                  ) : null}
                </View>
                <Button
                  title="That's me"
                  size="sm"
                  variant={likely ? 'primary' : 'secondary'}
                  onPress={() => void join(m.id, m.name, openNames)}
                  disabled={!!busy}
                  accessibilityLabel={`That's me: join as ${m.name}`}
                  testID={`join-claim-${m.id}`}
                />
              </View>
            );
          })}
        </ListCard>
      ) : (
        <Card>
          <AppText variant="caption">Everyone on the group's list has joined already. If you're new, join as a new member below.</AppText>
        </Card>
      )}

      {choices.taken.length > 0 ? (
        <>
          <SectionHeader title="Already on SplitSnap" />
          <ListCard dividerInset={MEMBER_INSET}>
            {choices.taken.map((m) => (
              <View key={m.id} style={styles.memberRow} accessible accessibilityLabel={`${m.name}, already joined`}>
                <Avatar name={m.name} color={colors.textFaint} size={AVATAR} />
                <AppText weight="medium" color={colors.textMuted} numberOfLines={1} style={styles.flex}>
                  {m.name}
                </AppText>
                <Icon name="lock-closed-outline" size={14} color={colors.textFaint} />
                <AppText variant="caption">Taken</AppText>
              </View>
            ))}
          </ListCard>
        </>
      ) : null}

      <SectionHeader title="Not on the list?" />
      <Card style={styles.card}>
        <AppText variant="label" weight="regular">
          Join as a new member. The others see you as{' '}
          <AppText variant="label" weight="semibold">
            {displayName}
          </AppText>
          .
        </AppText>
        <Button
          title="I'm not on this list: join as new member"
          icon="person-add-outline"
          variant="outline"
          onPress={() => void join(null, null, openNames)}
          disabled={!!busy}
          fullWidth
          testID="join-new-member"
        />
      </Card>

      <View style={styles.footerLinks}>
        <Button
          title="Use a different code"
          variant="ghost"
          size="sm"
          onPress={() => {
            setFound(null);
            setJoinError(null);
          }}
          disabled={!!busy}
          testID="join-other-code"
        />
        <Button title="Change my name" variant="ghost" size="sm" onPress={() => setEditingName(true)} disabled={!!busy} />
      </View>
      <LoadingOverlay visible={busy === 'join'} message="Joining the group…" />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { gap: spacing.md },
  gapBelow: { marginBottom: spacing.md },
  gapAbove: { marginTop: spacing.md },
  codeInput: { letterSpacing: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingLeft: spacing.xs },
  groupCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg },
}));
