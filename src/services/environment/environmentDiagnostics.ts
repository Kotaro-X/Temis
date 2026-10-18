import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { AppEnvironment } from './runtimeEnvironment';
declare const require: (id: string) => typeof import('@react-native-firebase/crashlytics');
const KEY = '@temis/production-crash-collection:v1';
/** The native Firebase app remains production in this single-bundle app. Suspend its collector in test. */
export const setEnvironmentDiagnostics = async (environment: AppEnvironment) => {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  if (environment === 'production' && await AsyncStorage.getItem(KEY) === null) return;
  const sdk = require('@react-native-firebase/crashlytics');
  const instance = sdk.getCrashlytics();
  if (environment === 'test') {
    if (await AsyncStorage.getItem(KEY) === null) await AsyncStorage.setItem(KEY, instance.isCrashlyticsCollectionEnabled ? 'true' : 'false');
    await sdk.setCrashlyticsCollectionEnabled(instance, false);
    await sdk.setUserId(instance, '');
  } else {
    const previous = await AsyncStorage.getItem(KEY);
    if (previous !== null) {
      await sdk.setCrashlyticsCollectionEnabled(instance, previous === 'true');
      await AsyncStorage.removeItem(KEY);
    }
  }
};
