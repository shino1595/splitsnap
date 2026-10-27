// Small building blocks shared by the Account and Settings screens.
import * as React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import type { CurrencyCode } from '../../../types';
import { currencyInfo } from '../../../lib/money';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Card, Divider, Icon, ListItem, OptionPicker } from '../../../ui';
import { currencyLabel, currencyOptions } from '../accountData';

const ICON_SIZE = 36;

export function RowIcon({ icon, color = colors.primaryDark, background = colors.primarySoft }: { icon: string; color?: string; background?: string }) {
  return (
    <View style={[styles.rowIcon, { backgroundColor: background }]}>
      <Icon name={icon} size={19} color={color} />
    </View>
  );
}

/** A white card whose children are separated by hairlines lined up with the row text. */
export function ListCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <Card padded={false} style={[styles.listCard, style]}>
      {rows.map((row, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <Divider inset={spacing.lg + ICON_SIZE + spacing.md} /> : null}
          {row}
        </React.Fragment>
      ))}
    </Card>
  );
}

interface CurrencyPickerRowProps {
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
  title?: string;
  subtitle?: string;
}

/** 'Default currency  INR ₹ ›' row that opens a searchable currency list. */
export function CurrencyPickerRow({ value, onChange, title = 'Default currency', subtitle = 'Used for new groups and expenses' }: CurrencyPickerRowProps) {
  const [open, setOpen] = React.useState(false);
  const options = React.useMemo(() => currencyOptions(value), [value]);
  const symbol = currencyInfo(value).symbol.trim();

  return (
    <>
      <ListItem
        left={<RowIcon icon="cash-outline" />}
        title={title}
        subtitle={subtitle}
        right={
          <AppText weight="semibold" color={colors.primaryDark} numberOfLines={1}>
            {symbol && symbol !== value ? `${value} ${symbol}` : value}
          </AppText>
        }
        showChevron
        onPress={() => setOpen(true)}
        accessibilityLabel={`${title}: ${currencyLabel(value)}. Tap to change`}
      />
      <OptionPicker<CurrencyCode>
        visible={open}
        onClose={() => setOpen(false)}
        title={title}
        options={options}
        selected={value}
        onSelect={onChange}
        searchable
      />
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  rowIcon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listCard: { overflow: 'hidden' },
}));
