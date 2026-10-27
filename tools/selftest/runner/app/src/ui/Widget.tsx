// .tsx files are not bundled for unit tests; importing one must give a clear error.
import { Text } from 'react-native';

export function Widget() {
  return <Text>hello</Text>;
}
