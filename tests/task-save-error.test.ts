import test from 'node:test';
import assert from 'node:assert/strict';
import { taskSaveErrorMessage } from '../src/utils/taskSaveError.ts';

test('Firebase codes and project errors provide relevant next steps with original details', () => {
  for (const [cause, expected] of [
    [{ code: 'functions/permission-denied', message: 'アクセス拒否' }, '共有タスクが有効か'],
    [{ code: 'firestore/unavailable', message: 'offline' }, 'インターネット接続'],
    [{ code: 'auth/unauthenticated', message: '認証エラー' }, 'ログイン中のアカウント'],
    [new Error('担当者はProjectメンバーから選択してください。'), '選び直して'],
    [new Error('タスクは保存しましたが、一覧を更新できませんでした。'), 'タスクは保存済み'],
  ] as const) {
    const result = taskSaveErrorMessage(cause);
    assert.ok(result.startsWith(cause.message));
    assert.ok(result.includes('対処方法'));
    assert.ok(result.includes(expected));
  }
});

test('unknown errors give a fallback without claiming a specific cause', () => {
  assert.match(taskSaveErrorMessage(null), /保存できませんでした。/);
  assert.match(taskSaveErrorMessage('unexpected'), /unexpected[\s\S]*サポート/);
});
