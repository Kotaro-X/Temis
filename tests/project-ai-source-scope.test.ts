import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
test('a mirrored shared ToDo body is saved with Project scope before indexing can read it', async () => {
  const writes: any[] = []; const exports: any = {};
  const dependencies: Record<string, any> = {
    '../../db/noteRepo': { getFreeNoteById: async () => null, upsertNoteRecord: async (note: any) => { writes.push(note); return note; }, setNoteScope: async (id: string, scope: any) => ({ ...writes[0], id, ...scope }) },
    './collaborationService': { upsertProjectSharedNote: async () => {} },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('src/services/collaboration/projectTaskMemoService.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Date, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  const result = await exports.syncProjectTaskMemo({ task: { id: 'todo', kind: 'todo', title: 'Shared', description: 'Shared body', projectId: 'project' }, profile: { userId: 'alice' } });
  assert.equal(result, 'project-todo-todo'); assert.equal(writes[0].scope, 'project'); assert.equal(writes[0].projectId, 'project'); assert.equal(writes[0].body, 'Shared body');
});
