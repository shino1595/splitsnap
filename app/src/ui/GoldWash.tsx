import * as React from 'react';
import { Image, StyleSheet } from 'react-native';
import { colors, themed } from '../theme';
import { WASH_PNG } from './gradients';

/** Diagonal gold wash for the first child of a card (give the card `overflow: 'hidden'`); content after it stays on top. */
export function GoldWash() {
  return (
    <Image
      source={{ uri: WASH_PNG }}
      resizeMode="stretch"
      style={[styles.wash, { tintColor: colors.wash }]}
    />
  );
}

const styles = themed(() => StyleSheet.create({
  wash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
}));
