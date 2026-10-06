import * as FileSystem from 'expo-file-system/legacy';

type UploadStage = 'start' | 'upload' | 'completion';
export class ProfilePhotoUploadError extends Error {
  constructor(public readonly code: string, public readonly stage: UploadStage, public readonly httpStatus: number, message: string) {
    super(message);
    this.name = 'ProfilePhotoUploadError';
  }
}
const uploadError = (status: number, stage: UploadStage, body?: any): ProfilePhotoUploadError => {
  const details = body?.error?.details;
  const serviceDisabled = Array.isArray(details) && details.some((item: any) => item?.reason === 'SERVICE_DISABLED');
  const serverMessage = typeof body?.error?.message === 'string' ? body.error.message : '';
  let code = 'PHOTO_UPLOAD_NETWORK';
  let message = '写真をアップロードできませんでした。通信状態を確認して再試行してください。';
  if ((stage === 'start' && status === 404) || serviceDisabled || /API has not been used|API.*disabled|billing.*disabled/i.test(serverMessage)) {
    code = 'PHOTO_STORAGE_NOT_READY';
    message = 'アプリの写真保存先がまだ準備されていません。運営側での設定が必要です。';
  } else if (status === 401) {
    code = 'PHOTO_UPLOAD_AUTH'; message = 'ログインの有効期限を確認できませんでした。再ログインしてお試しください。';
  } else if (status === 403) {
    code = 'PHOTO_UPLOAD_PERMISSION'; message = '写真の保存が許可されませんでした。運営側で保存先の設定を確認する必要があります。';
  } else if (status === 429) {
    code = 'PHOTO_UPLOAD_LIMIT'; message = '写真の保存が混み合っています。しばらくしてから再試行してください。';
  } else if (stage === 'completion' || (status >= 200 && status < 300)) {
    code = 'PHOTO_UPLOAD_RESPONSE'; message = '写真の保存結果を確認できませんでした。もう一度お試しください。';
  } else if (status >= 500) {
    code = 'PHOTO_UPLOAD_SERVER'; message = '写真の保存サービスでエラーが発生しました。しばらくしてから再試行してください。';
  } else if (status > 0) {
    code = 'PHOTO_UPLOAD_REJECTED'; message = '写真の保存処理が受け付けられませんでした。もう一度写真を選択してください。';
  }
  // Diagnostics deliberately exclude auth tokens, upload-session URLs and raw server responses.
  console.warn('[profile-photo-upload]', { code, stage, httpStatus: status });
  return new ProfilePhotoUploadError(code, stage, status, message);
};

// Firebase's resumable protocol uses JSON metadata, then raw file bytes. No JS Blob is needed.
export async function uploadProfilePhotoFile(input: {
  uri: string; size: number; bucket: string; path: string; token: string;
  isCurrentAccount: () => boolean;
}): Promise<void> {
  const assertCurrent = () => {
    if (!input.isCurrentAccount()) throw new Error('アカウントが切り替わりました。もう一度お試しください。');
  };
  assertCurrent();
  const origin = 'https://firebasestorage.googleapis.com';
  const headers = {
    Authorization: `Firebase ${input.token}`,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Goog-Upload-Protocol': 'resumable',
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Length': String(input.size),
    'X-Goog-Upload-Header-Content-Type': 'image/jpeg',
  };
  let response: Response;
  try {
    response = await fetch(`${origin}/v0/b/${encodeURIComponent(input.bucket)}/o?name=${encodeURIComponent(input.path)}`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: input.path, contentType: 'image/jpeg', cacheControl: 'public,max-age=86400' }),
    });
  } catch { throw uploadError(0, 'start'); }
  if (!response.ok) {
    let body: unknown;
    try { body = await response.json(); } catch { /* Keep HTTP status when the body is unavailable. */ }
    throw uploadError(response.status, 'start', body);
  }
  const url = response.headers.get('X-Goog-Upload-URL');
  // Never send tokens/files to an unexpected redirect/host from a malformed response.
  let validUrl = false;
  try { validUrl = Boolean(url && new URL(url).origin === origin); } catch { /* Malformed response. */ }
  if (!url || !validUrl) throw uploadError(response.status, 'completion');
  assertCurrent();
  let result: FileSystem.FileSystemUploadResult;
  try {
    result = await FileSystem.uploadAsync(url, input.uri, {
      httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      headers: { Authorization: `Firebase ${input.token}`, 'Content-Type': 'image/jpeg', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
    });
  } catch { throw uploadError(0, 'upload'); }
  const uploadStatus = Object.entries(result.headers).find(([name]) => name.toLowerCase() === 'x-goog-upload-status')?.[1];
  if (result.status < 200 || result.status >= 300) {
    let body: unknown;
    try { body = JSON.parse(result.body); } catch { /* Keep HTTP status. */ }
    throw uploadError(result.status, 'upload', body);
  }
  if (uploadStatus !== 'final') throw uploadError(result.status, 'completion');
  assertCurrent();
}
