# Temis AI: Guild search and selectable answers

## Implementation

- Memo and Guild AI headings are `Temis AI`; the memo labels are updated in Japanese and English.
- `AIAnswerEvidencePanel` renders a selectable native `Text` for answers. Long press selects a range and exposes the OS copy menu. The inner answer ScrollView was removed; the screen's results scroller remains.
- `functions/wikiAnswerRetrievalCore.cjs` is the single platform-independent traversal/excerpt implementation. The local memo service imports it through its existing TypeScript entry point; Guild uses a Firestore adapter.
- Four semantic seed documents, at most three Wiki hops, thirty frontier documents per hop, three hundred inspected candidates, and fifteen answer documents. Linked documents need not have embeddings. Each evidence excerpt is at most 1,200 characters.
- Guild uses only public, moderation-visible posts readable by the signed-in user. Plus/free-grant checks remain server-side. Blocked or unavailable posts never enter traversal. Selected posts and intermediate path posts are checked again before generation and before returning the answer; changed revisions produce a retry message.
- `searchGuildPostsWithAI` keeps its callable name and existing result fields. Optional `snippetText`, `linkDepth`, and `linkPath` extend each evidence post. Private source memo IDs are never returned.
- Search results are cleared on account/entitlement changes; late results from the previous session are ignored.

## Indexing and operations

`guildPostAIIndex` version 2 stores full-document Wiki tokens, hashed tokens for exact Firestore lookup, the source document revision, and embedding status. Link metadata is committed before requesting embeddings. Vectors are committed only if the source is still at the same revision. Nonpublic/deleted posts lose their index. Event delivery retries transient failures.

The production investigation found 2 public visible posts but 0 indexed posts. The index event Function's Cloud Run service had no invoker binding; logs repeatedly reported missing `run.routes.invoke` permission. Repair grants only its existing event service account `roles/run.invoker` on that one service, with no public invoker.

Administrative commands use the existing Firebase CLI account. Credentials and API keys are kept in memory and not printed. Backfill reads the project's OpenAI secret and sends only public visible post text for embedding; it is an intentional migration, not a test.

```sh
node scripts/guild-ai-maintenance.cjs status temis-c05aa
node scripts/guild-ai-maintenance.cjs repair-invoker temis-c05aa
node scripts/guild-ai-maintenance.cjs backfill temis-c05aa
```

The existing admin-only `backfillGuildPostAIIndex` Callable remains available and additionally reports `failedPostIds`. Re-running backfill reuses current embeddings where possible.

## Manual debug checklist

At the user's request, no automated tests, local builds, simulator operations, or authenticated answer-generation tests were performed for this change. Previous test results do not verify this revision.

- In Memo and Guild, long press an answer, adjust selection handles, copy, and paste elsewhere; also try an answer longer than the results viewport.
- Sign in with a Plus-entitled account and ask about a public post connected through multiple Wiki links. Inspect the path labels and open cited posts.
- Check three-hop inclusion, fourth-hop exclusion, cycles, shared links, distinct seed preservation, and the fifteen-post maximum.
- Check private/deleted/moderated/blocked posts, including intermediate path posts, are excluded.
- During generation, switch account or lose entitlement: the old result must not appear.
- Distinguish an empty result from index preparation, timeout, and service failure.
- A legacy client should still read `answerText`, `citedPostIds`, and `evidencePosts`.

## Deployment record

- Firestore vector index definition aligned with production; Wiki lookup and version indexes added.
- Index event Function and admin backfill Function deployed; event service invoker repaired.
- Backfill processed 9 source records, indexed the 2 public visible posts, and reported 0 failures.
- All three Guild AI composite indexes (vector, Wiki lookup, and version readiness) reached `READY`.
- Final read-only count: 2 public visible posts, 2 version-2 index documents, 2 completed embeddings.
- `searchGuildPostsWithAI(asia-northeast1)` deployed successfully after index readiness and backfill.
- The event service account already has `roles/datastore.user` and `roles/eventarc.eventReceiver`; its missing service-level `roles/run.invoker` binding was repaired.
- No authenticated answer-generation or UI-copy verification was performed. App source changes remain uncommitted; no app binary was built or distributed.
