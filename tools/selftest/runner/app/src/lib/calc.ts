// Self-test fixture for tools/run-tests.ps1: a tiny pure module plus stubbed package imports.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { SYMBOLS, type Money } from './symbols';

export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) throw new RangeError('n must be positive');
  const base = Math.trunc(total / n);
  const out: number[] = new Array(n).fill(base);
  for (let i = 0; i < total - base * n; i++) out[i] += 1;
  return out;
}

export function format(m: Money): string {
  const major = (m.minor / 100).toFixed(2);
  return `${SYMBOLS[m.currency] ?? m.currency + ' '}${major}`;
}

export function platformName(): string {
  return Platform.select({ web: 'web', default: 'native' }) ?? Platform.OS;
}

export async function saveAndLoad(key: string, value: string): Promise<string | null> {
  await AsyncStorage.setItem(key, value);
  return AsyncStorage.getItem(key);
}

export function pickPhoto(): Promise<unknown> {
  return ImagePicker.launchCameraAsync();
}

export function crash(input: { name?: string }): number {
  // Deliberately unsafe: used by the failing self-test to check source-mapped stack traces.
  return (input.name as unknown as string[]).length + (input as any).missing.length;
}

export function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
