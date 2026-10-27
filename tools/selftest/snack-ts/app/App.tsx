import * as React from 'react';
import { Text, View } from 'react-native';
import { A } from './src/a';
import { B } from './src/b';
import { C } from './src/c';

export default function App() {
  return (
    <View style={{ padding: 40 }}>
      <Text>{`a=${A} b=${B.weight} c=${C}`}</Text>
    </View>
  );
}
