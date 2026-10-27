import * as React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { radius, themed } from '../../../theme';
import { Card, Divider } from '../../../ui';

export interface ListCardProps {
  children?: React.ReactNode;
  /** Left indent of the dividers drawn between rows. */
  dividerInset?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A card holding a list of rows with hairline dividers between them. Rows are clipped to the
 * rounded corners by an inner view, so the card keeps its shadow on iOS.
 */
export function ListCard({ children, dividerInset = 0, style }: ListCardProps) {
  const rows = React.Children.toArray(children);
  return (
    <Card padded={false} style={style}>
      <View style={styles.clip}>
        {rows.map((row, i) => (
          <React.Fragment key={React.isValidElement(row) && row.key != null ? String(row.key) : String(i)}>
            {i > 0 ? <Divider inset={dividerInset} /> : null}
            {row}
          </React.Fragment>
        ))}
      </View>
    </Card>
  );
}

const styles = themed(() => StyleSheet.create({
  clip: { borderRadius: radius.lg, overflow: 'hidden' },
}));
