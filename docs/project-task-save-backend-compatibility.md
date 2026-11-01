# Project task save backend compatibility (2026-11-01)

## Cause

Production `temis-c05aa`, `asia-northeast1/mutateProjectTask` was last updated on
2026-10-26T14:25:39Z. Its downloaded source accepted `assigneeUserIds` but rejected
`plannedStartAt`, `plannedEndAt`, `repeat`, `repeatAnchorDate`, and
`occurrenceOverrides`. The planner sends planning fields even with no time or
repeat selected. The whitelist rejected the request before its transaction with
`invalid-argument: 更新内容を確認してください。`.

Running the new unscheduled-task regression cases against the downloaded source
reproduced that exact error for both one and two assignees. This is a backend
contract mismatch, independent of the selected assignee count.

## Repair and rollout scope

The workspace already contained planning support in `functions/projectTaskMutationCore.cjs`.
Apply that planning whitelist, validation, occurrence merge, and optimistic
`expectedUpdatedAt` check to the downloaded production source, and deploy only
`functions:mutateProjectTask` with explicit `--project temis-c05aa`.
The isolated deployment directory is `/tmp/wememo-project-save-fix`.
Other source files come from the deployed archive so unrelated workspace edits
are excluded. Rules, indexes, other functions, app binaries, and test data are
outside this rollout. Local source also retains pre-existing project-exit checks.

## Validation

- Old production source: both new unscheduled-task tests fail with the reported error.
- Repaired deployment source: all 8 mutation tests pass.
- Workspace mutation, planner editor, Project editor, error guidance tests: 25 pass.
- TypeScript check, Node syntax checks, targeted lint, and diff whitespace check pass.

Manual acceptance: create Project tasks with one and multiple assignees, reopen
and edit the title/memo/date, save scheduled and repeating tasks, and confirm the
same saved data in Project and Private views. Simulator/device execution belongs
to the user.

Production deployment completed successfully on 2026-11-01 (JST); the Cloud Functions API confirmed `mutateProjectTask` is `ACTIVE`. No app rebuild is required for the rejected planning fields to be accepted. Authenticated device saves remain for manual acceptance.
