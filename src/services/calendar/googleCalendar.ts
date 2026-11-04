import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getFirebaseAuth } from '../sync/firebaseApp';
import { isTestEnvironment } from '../environment/runtimeEnvironment';

export type CalendarDirection = 'off' | 'linked';
export type CalendarTarget = {
  calendarId: string | null;
  calendarName: string | null;
  direction: CalendarDirection;
};
export type GoogleCalendarSettings = CalendarTarget & {
  connected: boolean;
  email: string | null;
  enabled: boolean;
  projects: Record<string, CalendarTarget>;
  lastSyncedAt: number | null;
  error: string | null;
  skipped: number;
  blocked: number;
  pending: boolean;
  issues: Record<string, number>;
};
export type GoogleCalendar = { id: string; name: string; accessRole: string; timeZone: string };

const call = async <T>(name: string, data: unknown = {}): Promise<T> => {
  if (isTestEnvironment()) throw new Error('Googleカレンダー同期は通常環境で設定してください。');
  const auth = getFirebaseAuth(), uid = auth.currentUser?.uid;
  if (!uid || auth.currentUser?.isAnonymous) throw new Error('Temisにログインしてください。');
  const result = await httpsCallable<unknown, T>(getFunctions(getFirebaseApp(), 'asia-northeast1'), name, { timeout: 120000 })(data);
  if (getFirebaseAuth().currentUser?.uid !== uid || isTestEnvironment()) throw new Error('アカウントが切り替わりました。画面を開き直してください。');
  return result.data;
};
export const getGoogleCalendarSettings = () => call<GoogleCalendarSettings>('getGoogleCalendarSettings');
export const beginGoogleCalendarConnection = () => call<{ url: string }>('beginGoogleCalendarConnection');
export const listGoogleCalendars = () => call<GoogleCalendar[]>('listGoogleCalendars');
export const syncGoogleCalendarNow = () => call<GoogleCalendarSettings>('syncGoogleCalendarNow');
export const updateGoogleCalendarSettings = (data:
  | { action: 'pause' | 'resume' | 'disconnect' }
  | { action: 'disable'; projectId?: string }
  | { action: 'save'; calendarId: string; direction: CalendarDirection; enabled: boolean }
  | { action: 'project'; projectId: string; calendarId: string; direction: CalendarDirection }
) => call<GoogleCalendarSettings>('setGoogleCalendarSettings', { ...data, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
