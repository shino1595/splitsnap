import * as React from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { TextField } from './TextField';

export interface PickerOption<T> {
  value: T;
  label: string;
  subtitle?: string;
  /** Ionicons glyph shown in a tinted circle (ignored when `left` is given). */
  icon?: string;
  left?: React.ReactNode;
}

export interface OptionPickerProps<T> {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: PickerOption<T>[];
  selected?: T;
  /** Called with the tapped value; the picker then closes itself. */
  onSelect: (v: T) => void;
  searchable?: boolean;
}

/** Non-generic list row (FlatList's prop types cannot be checked against an unresolved T). */
interface Row {
  key: string;
  index: number;
  label: string;
  subtitle?: string;
  icon?: string;
  left?: React.ReactNode;
  selected: boolean;
}

export function OptionPicker<T>({ visible, onClose, title, options, selected, onSelect, searchable = false }: OptionPickerProps<T>) {
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const q = query.trim().toLowerCase();
  const rows: Row[] = [];
  options.forEach((o, index) => {
    if (q && !o.label.toLowerCase().includes(q) && !(o.subtitle ?? '').toLowerCase().includes(q)) return;
    rows.push({
      key: `${index}:${String(o.value)}`,
      index,
      label: o.label,
      subtitle: o.subtitle,
      icon: o.icon,
      left: o.left,
      selected: selected !== undefined && o.value === selected,
    });
  });

  const choose = (index: number) => {
    onSelect(options[index].value);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} scroll={false}>
      {searchable ? (
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.search}
          right={<Icon name="search" size={18} color={colors.textFaint} />}
        />
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={
          <AppText color={colors.textMuted} align="center" style={styles.empty}>
            No matches
          </AppText>
        }
        renderItem={({ item }) => {
          const isSelected = item.selected;
          return (
            <Pressable
              onPress={() => choose(item.index)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: isSelected }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              {item.left ? (
                item.left
              ) : item.icon ? (
                <View style={styles.iconCircle}>
                  <Icon name={item.icon} size={20} color={colors.primaryDark} />
                </View>
              ) : null}
              <View style={styles.text}>
                <AppText weight={isSelected ? 'semibold' : 'regular'} numberOfLines={1}>
                  {item.label}
                </AppText>
                {item.subtitle ? (
                  <AppText variant="caption" numberOfLines={2}>
                    {item.subtitle}
                  </AppText>
                ) : null}
              </View>
              {isSelected ? <Icon name="checkmark" size={22} color={colors.primary} /> : null}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = themed((colors) => StyleSheet.create({
  search: { marginBottom: spacing.sm },
  list: { flexGrow: 0, flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  empty: { paddingVertical: spacing.xl },
}));
