#!/usr/bin/env node
// Scope-limited DM release helper. Never reads credential values or user messages.
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const cliAuth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');
const { readFileSync } = require('node:fs');
const names = ['sendDirectMessage', 'markDirectMessagesRead', 'setDirectMessageDevice', 'notifyDirectMessage', 'retryDirectMessageNotifications', 'deleteAccount'];
async function main() {
  const [command, projectId] = process.argv.slice(2);
  if (!['ensure-indexes', 'status', 'repair-invoker'].includes(command) || !/^[a-z][a-z0-9-]+$/.test(projectId || '')) throw new Error('Usage: direct-messages-maintenance.cjs <ensure-indexes|status|repair-invoker> <project-id>');
  await requireAuth({ project: projectId, ...cliAuth.getGlobalDefaultAccount() });
  const firestore = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const desired = JSON.parse(readFileSync(require.resolve('../firestore.indexes.json'), 'utf8')).indexes
    .filter((index) => ['dmConversations', 'messages'].includes(index.collectionGroup));
  if (command !== 'repair-invoker') {
    for (const spec of desired) {
      const url = `/projects/${projectId}/databases/(default)/collectionGroups/${spec.collectionGroup}/indexes`;
      const listed = (await firestore.get(url)).body.indexes || [];
      const match = listed.find((index) => index.queryScope === spec.queryScope && JSON.stringify(index.fields.filter((field) => field.fieldPath !== '__name__')) === JSON.stringify(spec.fields));
      if (!match && command === 'ensure-indexes') {
        const operation = (await firestore.post(url, { queryScope: spec.queryScope, fields: spec.fields })).body;
        console.log(JSON.stringify({ collectionGroup: spec.collectionGroup, created: true, operation: operation.name }));
      } else console.log(JSON.stringify({ collectionGroup: spec.collectionGroup, state: match?.state || 'MISSING' }));
    }
  }
  if (command === 'ensure-indexes') return;
  const functions = new Client({ urlPrefix: 'https://cloudfunctions.googleapis.com', apiVersion: 'v2' });
  if (command === 'repair-invoker') {
    for (const name of ['notifyDirectMessage', 'retryDirectMessageNotifications']) {
      const fn = (await functions.get(`/projects/${projectId}/locations/asia-northeast1/functions/${name}`)).body;
      const principal = fn.eventTrigger?.serviceAccountEmail || fn.serviceConfig?.serviceAccountEmail;
      const service = fn.serviceConfig?.service;
      if (!principal || !service) throw new Error('Missing DM runtime identity');
      const run = new Client({ urlPrefix: 'https://run.googleapis.com', apiVersion: 'v2' });
      const policy = (await run.get(`/${service}:getIamPolicy`)).body;
      const member = `serviceAccount:${principal}`;
      const binding = (policy.bindings || []).find((item) => item.role === 'roles/run.invoker' && !item.condition);
      if (!binding?.members?.includes(member)) {
        policy.bindings ||= [];
        if (binding) binding.members.push(member);
        else policy.bindings.push({ role: 'roles/run.invoker', members: [member] });
        await run.post(`/${service}:setIamPolicy`, { policy });
      }
      console.log(JSON.stringify({ name, invoker: member, publicAccessAdded: false }));
    }
    return;
  }
  const scheduler = new Client({ urlPrefix: 'https://cloudscheduler.googleapis.com', apiVersion: 'v1' });
  const job = (await scheduler.get(`/projects/${projectId}/locations/asia-northeast1/jobs/firebase-schedule-retryDirectMessageNotifications-asia-northeast1`)).body;
  console.log(JSON.stringify({ schedulerState: job.state, schedule: job.schedule, invoker: job.httpTarget?.oidcToken?.serviceAccountEmail }));
  for (const name of names) {
    try {
      const fn = (await functions.get(`/projects/${projectId}/locations/asia-northeast1/functions/${name}`)).body;
      console.log(JSON.stringify({ name, state: fn.state, updateTime: fn.updateTime, uri: fn.serviceConfig?.uri }));
    } catch (error) { console.log(JSON.stringify({ name, httpStatus: error.status || error.statusCode || null })); }
  }
}
main().catch((error) => { console.error('DM maintenance failed', error.status || error.code || error.name); process.exitCode = 1; });
