// Self-test fixture for tools/build-snack-launcher.ps1: awkward characters must survive the
// round trip into the Snack form exactly: </script> "double" 'single' `back` \ backslash \n
// Unicode: ₹1,390.50 · €9.99 · £5 · 🧾 (astral) · ‘curly’ — dash
import { Text } from 'react-native';
import { label } from './src/label';

const html = '<script>alert(1)</script>&amp;';

export default function App() {
  return <Text>{`${label} ${html.length} ₹`}</Text>;
}
