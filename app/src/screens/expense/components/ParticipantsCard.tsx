// "With you and:" — who shares the expense, plus the group it belongs to.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ME_ID } from '../../../types';
import type { AppState, Group, ID } from '../../../types';
import { listGroups, personName } from '../../../store/selectors';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Avatar, Card, Chip, Divider, Icon, OptionPicker, PersonAvatar } from '../../../ui';
import type { PickerOption } from '../../../ui';
import { FriendPickerSheet } from './FriendPickerSheet';
import { IconBadge } from './editorBits';
import { participantCandidates } from './expenseEditing';

const NO_GROUP = '__no_group__';

export interface ParticipantsCardProps {
  state: AppState;
  groupId: ID | null;
  participantIds: ID[];
  onChangeParticipants: (ids: ID[]) => void;
  onChangeGroup: (groupId: ID | null) => void;
  onAddFriend: () => void;
  error?: string | null;
}

function GroupAvatar({ group, size = 36 }: { group: Group; size?: number }) {
  return <Avatar name={group.name} color={colors.primarySoft} emoji={group.emoji} size={size} />;
}

export function ParticipantsCard({
  state,
  groupId,
  participantIds,
  onChangeParticipants,
  onChangeGroup,
  onAddFriend,
  error,
}: ParticipantsCardProps) {
  const [pickingPeople, setPickingPeople] = React.useState(false);
  const [pickingGroup, setPickingGroup] = React.useState(false);

  const group = groupId ? state.groups[groupId] : undefined;
  const others = participantIds.filter((id) => id !== ME_ID);
  const candidates = React.useMemo(() => participantCandidates(state, participantIds), [state, participantIds]);

  const groupOptions = React.useMemo((): PickerOption<string>[] => {
    const groups = listGroups(state);
    if (group && !groups.some((g) => g.id === group.id)) groups.unshift(group);
    return [
      { value: NO_GROUP, label: 'No group', subtitle: 'Just between you and friends', icon: 'person-outline' },
      ...groups.map((g) => ({
        value: g.id,
        label: g.name,
        subtitle: `${g.memberIds.length} ${g.memberIds.length === 1 ? 'member' : 'members'}${g.archived ? ' · archived' : ''}`,
        left: <GroupAvatar group={g} />,
      })),
    ];
  }, [state, group]);

  const remove = (id: ID) => onChangeParticipants(participantIds.filter((x) => x !== id));

  return (
    <Card padded={false}>
      <View style={styles.section}>
        <AppText variant="label" color={colors.textMuted}>
          With <AppText variant="label" weight="semibold">you</AppText> and:
        </AppText>
        <View style={styles.chips}>
          {others.map((id) => {
            const name = personName(state, id);
            return group ? (
              <Chip key={id} label={name} small left={<PersonAvatar person={state.people[id]} size={24} />} />
            ) : (
              <Chip
                key={id}
                label={name}
                left={<PersonAvatar person={state.people[id]} size={28} />}
                right={<Icon name="close" size={14} color={colors.textMuted} />}
                onPress={() => remove(id)}
                accessibilityLabel={`Remove ${name}`}
              />
            );
          })}
          {group ? null : (
            <Chip
              label={others.length === 0 ? 'Choose people' : 'Add people'}
              left={<Icon name="add" size={18} color={colors.primaryDark} style={styles.addIcon} />}
              onPress={() => setPickingPeople(true)}
              accessibilityLabel="Add people to this expense"
              testID="add-people"
            />
          )}
        </View>
        {group ? (
          <AppText variant="caption" style={styles.hint}>
            Everyone in {group.name}. To leave someone out, tap how it’s split below.
          </AppText>
        ) : null}
        {error ? (
          <AppText variant="caption" color={colors.danger} style={styles.hint}>
            {error}
          </AppText>
        ) : null}
      </View>

      <Divider />

      <Pressable
        onPress={() => setPickingGroup(true)}
        accessibilityRole="button"
        accessibilityLabel={`Group: ${group ? group.name : groupId ? 'Deleted group' : 'No group'}. Change group`}
        style={({ pressed }) => [styles.groupRow, pressed && styles.pressed]}
      >
        {group ? <GroupAvatar group={group} /> : <IconBadge icon="people-outline" size={36} />}
        <View style={styles.groupText}>
          <AppText variant="caption">Group</AppText>
          <AppText weight="semibold" numberOfLines={1}>
            {group ? group.name : groupId ? 'Deleted group' : 'No group'}
          </AppText>
        </View>
        <AppText variant="label" color={colors.primaryDark}>
          Change
        </AppText>
        <Icon name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>

      <FriendPickerSheet
        visible={pickingPeople}
        onClose={() => setPickingPeople(false)}
        candidates={candidates}
        selectedIds={others}
        onDone={(ids) => onChangeParticipants([ME_ID, ...ids])}
        onAddFriend={onAddFriend}
      />
      <OptionPicker
        visible={pickingGroup}
        onClose={() => setPickingGroup(false)}
        title="Choose a group"
        options={groupOptions}
        selected={groupId ?? NO_GROUP}
        onSelect={(value) => onChangeGroup(value === NO_GROUP ? null : value)}
        searchable={groupOptions.length > 8}
      />
    </Card>
  );
}

const styles = themed((colors) => StyleSheet.create({
  section: { padding: spacing.lg, gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addIcon: { marginLeft: spacing.xs },
  hint: { marginTop: spacing.xxs },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  pressed: { backgroundColor: colors.background },
  groupText: { flex: 1, minWidth: 0 },
}));
