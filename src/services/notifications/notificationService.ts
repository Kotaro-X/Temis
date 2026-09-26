import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import appConfig from '../../../app.json';
import { getFirebaseAuth } from '../sync/firebaseApp';
import { setDirectMessageDevice } from '../dm/directMessagesService';
import { dmNotificationTarget } from './dmNotificationPolicy';

let focusedConversation: string | null = null;
let notificationUserId: string | null = null;
let installed = false;
let operations: Promise<unknown> = Promise.resolve();
const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = operations.then(operation, operation);
  operations = next.catch(() => {});
  return next;
};
export const setNotificationView = (userId: string | null, conversationId: string | null) => {
  notificationUserId = userId;
  focusedConversation = conversationId;
};
export const initializeNotificationHandler = () => {
  if (installed) return;
  installed = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;
      const isDM = data.type === 'dm';
      const target = dmNotificationTarget(data, notificationUserId);
      const suppressed = isDM && (!target || (AppState.currentState === 'active' && target.conversationId === focusedConversation));
      return {
        shouldShowBanner: !suppressed, shouldShowList: !suppressed,
        shouldPlaySound: isDM && !suppressed, shouldSetBadge: false,
      };
    },
  });
};
const preferenceKey = (uid: string) => `dm.notifications.enabled.${uid}`;
export const notificationsEnabled = async (uid: string) => (await AsyncStorage.getItem(preferenceKey(uid))) === 'true';
const installationId = async () => {
  let value = await AsyncStorage.getItem('dm.notifications.installation');
  if (!value) { value = Crypto.randomUUID(); await AsyncStorage.setItem('dm.notifications.installation', value); }
  return value;
};
export const syncDMNotifications = (uid: string, enable: boolean, requestPermission = false) => serialize(async () => {
  if (!['ios', 'android'].includes(Platform.OS)) throw new Error('プッシュ通知はiOS・Androidアプリで利用できます。');
  if (getFirebaseAuth().currentUser?.uid !== uid) return false;
  if (!enable && !await AsyncStorage.getItem("dm.notifications.installation")) return false;
  const deviceId = await installationId();
  if (!enable) {
    await setDirectMessageDevice({ installationId: deviceId, platform: Platform.OS, enabled: false, resetInstallation: true });
    await AsyncStorage.setItem(preferenceKey(uid), 'false');
    await AsyncStorage.removeItem('dm.notifications.registeredUser');
    return false;
  }
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('direct-messages', {
    name: 'ダイレクトメッセージ', importance: Notifications.AndroidImportance.HIGH, sound: 'default',
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && requestPermission && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
    await setDirectMessageDevice({ installationId: deviceId, platform: Platform.OS, enabled: false, resetInstallation: true });
    await AsyncStorage.setItem(preferenceKey(uid), 'false');
    throw new Error('端末の設定でTemisの通知を許可してください。DM自体は通知なしでも使えます。');
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: appConfig.expo.extra.eas.projectId })).data;
  if (getFirebaseAuth().currentUser?.uid !== uid) return false;
  // Save the registration intent first so logout can clean up after an ambiguous response.
  await AsyncStorage.setItem('dm.notifications.registeredUser', uid);
  await setDirectMessageDevice({ installationId: deviceId, platform: Platform.OS, enabled: true, token });
  await AsyncStorage.setItem(preferenceKey(uid), 'true');
  await AsyncStorage.setItem('dm.notifications.registeredUser', uid);
  return true;
});
export const unregisterDMNotificationsBeforeSignOut = (accountDeleted = false) => serialize(async () => {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid || await AsyncStorage.getItem('dm.notifications.registeredUser') !== uid) return;
  if (!accountDeleted) await setDirectMessageDevice({ installationId: await installationId(), platform: Platform.OS, enabled: false });
  await AsyncStorage.removeItem('dm.notifications.registeredUser');
  notificationUserId = null;
  focusedConversation = null;
  // Leave ToDo reminder notifications alone.
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(presented.filter((item) => item.request.content.data.type === 'dm')
      .map((item) => Notifications.dismissNotificationAsync(item.request.identifier)));
  } catch { /* Notification presentation cleanup must not prevent local logout. */ }
});
