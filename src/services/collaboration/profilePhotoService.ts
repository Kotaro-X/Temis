import * as Crypto from 'expo-crypto';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';
import { getFirebaseApp, getFirebaseAuth } from '../sync/firebaseApp';
import { updateProfilePhoto } from './collaborationService';
import { profilePhotoCrop } from './profilePolicy';
import * as FileSystem from 'expo-file-system/legacy';
import { uploadProfilePhotoFile } from './profilePhotoUpload';
import type { UserProfile } from '../../types/collaboration';

// Immutable object names keep old download URLs from pointing at a new image.
export const selectAndSaveProfilePhoto = async (): Promise<UserProfile | null> => {
  const userId = getFirebaseAuth().currentUser?.uid;
  if (!userId) throw new Error('アカウントにログインしてください。');
  // Older native builds may receive newer JS. Never load optional photo modules at app startup.
  let ImagePicker: typeof import('expo-image-picker');
  let ImageManipulator: typeof import('expo-image-manipulator');
  try {
    [ImagePicker, ImageManipulator] = await Promise.all([import('expo-image-picker'), import('expo-image-manipulator')]);
  } catch {
    throw new Error('写真機能には新しいアプリビルドが必要です。アプリを更新してから、もう一度お試しください。');
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const crop = profilePhotoCrop(asset.width, asset.height);
  const side = Math.min(crop.width, 512);
  const image = await ImageManipulator.manipulateAsync(asset.uri, [{ crop }, { resize: { width: side, height: side } }], { format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 });
  try {
    const file = await FileSystem.getInfoAsync(image.uri);
    if (!file.exists || file.isDirectory || !file.size || file.size > 1024 * 1024) throw new Error('写真の容量が大きすぎるか、読み込めませんでした。別の写真を選択してください。');
    const isCurrentAccount = () => getFirebaseAuth().currentUser?.uid === userId;
    if (!isCurrentAccount()) throw new Error('アカウントが切り替わりました。もう一度お試しください。');
    const path = `profilePhotos/${userId}/${Crypto.randomUUID()}.jpg`;
    const object = ref(getStorage(getFirebaseApp()), path);
    const token = await getFirebaseAuth().currentUser!.getIdToken();
    await uploadProfilePhotoFile({ uri: image.uri, size: file.size, bucket: object.bucket, path, token, isCurrentAccount });
    const url = await getDownloadURL(object);
    if (!isCurrentAccount()) throw new Error('アカウントが切り替わりました。もう一度お試しください。');
    // Uncertain remote commits are cleaned up server-side after reference checks.
    return await updateProfilePhoto(userId, url, path);
  } finally {
    await FileSystem.deleteAsync(image.uri, { idempotent: true }).catch(() => {});
  }
};
export const removeProfilePhoto = async (): Promise<UserProfile> => {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) throw new Error('アカウントにログインしてください。');
  return updateProfilePhoto(uid, null, null);
};
