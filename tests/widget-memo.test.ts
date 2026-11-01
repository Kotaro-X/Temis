import test from "node:test";
import assert from "node:assert/strict";
import { createWidgetMemoRequests, createWidgetMemoSave, isWidgetMemoURL, newWidgetMemoDraft, WIDGET_MEMO_URL, type WidgetMemoDraft } from "../src/features/widgetMemo/widgetMemoCore.ts";
import { modalOverlayLayers } from "../src/services/modalOverlayLayers.ts";

test("widget links accept only the new-memo action", () => {
  assert.equal(isWidgetMemoURL(WIDGET_MEMO_URL), true);
  for (const url of [null, "", "garbage", "https://memo/new", "exp+temis://memo/delete", "exp+temis://memo/new?project=secret", "exp+temis://memo/new#x", "exp+temis://user@memo/new", "exp+temis://memo:80/new", "exp+temis://expo-development-client/?url=x"]) assert.equal(isWidgetMemoURL(url), false, String(url));
});

test("cold and warm duplicate requests keep one pending editor through startup", () => {
  const requests = createWidgetMemoRequests();
  let calls = 0;
  const unsubscribe = requests.subscribe(() => calls++);
  requests.receive(WIDGET_MEMO_URL); requests.receive(WIDGET_MEMO_URL);
  assert.equal(calls, 1); assert.equal(requests.getSnapshot(), true);
  requests.receive("exp+temis://other/action"); assert.equal(calls, 1);
  requests.dismiss(); assert.equal(requests.getSnapshot(), false);
  requests.receive(WIDGET_MEMO_URL); assert.equal(calls, 3);
  unsubscribe(); requests.dismiss(); assert.equal(calls, 3);
});

test("each new memo starts in Private regardless of the previous selection", () => {
  const previous = newWidgetMemoDraft("one"); previous.projectId = "project";
  assert.deepEqual(newWidgetMemoDraft("two"), { id: "two", title: "", body: "", projectId: null });
});

test("widget entry uses the top native modal and keeps its editor host stable", () => {
  const parent = modalOverlayLayers.register("memo");
  const child = modalOverlayLayers.register("references");
  const requests = createWidgetMemoRequests(modalOverlayLayers.getSnapshot);
  requests.receive(WIDGET_MEMO_URL); assert.equal(requests.getHost(), "references");
  const later = modalOverlayLayers.register("notice");
  requests.receive(WIDGET_MEMO_URL); assert.equal(requests.getHost(), "references");
  later(); child(); requests.dismiss(); requests.receive(WIDGET_MEMO_URL);
  assert.equal(requests.getHost(), "memo");
  parent(); requests.dismiss(); requests.receive(WIDGET_MEMO_URL);
  assert.equal(requests.getHost(), "root");
});

test("private save failure retains the ID and content, even if destination changes on retry", async () => {
  const writes: WidgetMemoDraft[] = []; let fail = true;
  const session = createWidgetMemoSave({ assertActive() {}, saveProject: async () => assert.fail("unexpected sharing"), mirrorProject: async () => {},
    savePrivate: async draft => { writes.push(draft); if (fail) { fail = false; throw new Error("sync queue failed"); } },
  });
  const draft = { ...newWidgetMemoDraft("stable"), body: "Remember this" };
  await assert.rejects(session.save(draft)); assert.equal(session.locked(), true);
  assert.equal(await session.save({ ...draft, projectId: "different" }), true);
  assert.deepEqual(writes.map(item => [item.id, item.body, item.projectId]), [["stable", "Remember this", null], ["stable", "Remember this", null]]);
});

test("Project is not written before Save and a local mirror failure does not reshare", async () => {
  let shared = 0; let mirrors = 0;
  const session = createWidgetMemoSave({ assertActive() {}, savePrivate: async () => assert.fail("unexpected Private write"),
    saveProject: async (_draft, committed) => { shared++; committed(); },
    mirrorProject: async () => { mirrors++; if (mirrors === 1) throw new Error("disk"); },
  });
  const draft = { ...newWidgetMemoDraft("shared"), body: "Shared", projectId: "project" };
  assert.equal(shared, 0);
  await assert.rejects(session.save(draft)); assert.equal(session.status(), "saved");
  assert.equal(await session.save(draft), true); assert.equal(shared, 1); assert.equal(mirrors, 2);
});

test("a post-commit publication queue error keeps the committed Project on retry", async () => {
  let writes = 0; let mirrored: WidgetMemoDraft | undefined;
  const session = createWidgetMemoSave({ assertActive() {}, savePrivate: async () => assert.fail("must not fall back to Private"),
    saveProject: async (_draft, committed) => { writes++; committed(); throw new Error("publication queue failed"); },
    mirrorProject: async draft => { mirrored = draft; },
  });
  const draft = { ...newWidgetMemoDraft("shared"), body: "Shared", projectId: "project" };
  await assert.rejects(session.save(draft));
  assert.equal(await session.save({ ...draft, projectId: null }), true);
  assert.equal(mirrored?.projectId, "project"); assert.equal(writes, 1);
});

test("an explicit permission rejection permits choosing Private without losing text", async () => {
  let privateDraft: WidgetMemoDraft | undefined;
  const session = createWidgetMemoSave({ assertActive() {}, savePrivate: async draft => { privateDraft = draft; },
    saveProject: async () => { throw Object.assign(new Error("permission changed"), { code: "permission-denied" }); }, mirrorProject: async () => {},
  });
  const draft = { ...newWidgetMemoDraft("stable"), body: "Keep", projectId: "project" };
  await assert.rejects(session.save(draft)); assert.equal(session.locked(), false);
  await session.save({ ...draft, projectId: null }); assert.equal(privateDraft?.body, "Keep");
});

test("ambiguous Project errors freeze the original payload and destination for retry", async () => {
  const writes: WidgetMemoDraft[] = [];
  const session = createWidgetMemoSave({ assertActive() {}, savePrivate: async () => assert.fail("unsafe fallback"), mirrorProject: async () => {},
    saveProject: async (draft, committed) => { writes.push(draft); if (writes.length === 1) throw new Error("network"); committed(); },
  });
  const draft = { ...newWidgetMemoDraft("stable"), body: "Keep", projectId: "project" };
  await assert.rejects(session.save(draft));
  await session.save({ ...draft, body: "Changed", projectId: null });
  assert.deepEqual(writes[0], writes[1]);
});

test("repeat taps are serialized and account changes stop subsequent local writes", async () => {
  let active = true; let finish: () => void = () => {}; let mirrors = 0; let shares = 0;
  const session = createWidgetMemoSave({ assertActive: () => { if (!active) throw new Error("account changed"); }, savePrivate: async () => {},
    saveProject: async (_draft, committed) => { shares++; await new Promise<void>(resolve => { finish = resolve; }); committed(); },
    mirrorProject: async () => { mirrors++; },
  });
  const draft = { ...newWidgetMemoDraft("stable"), body: "Keep", projectId: "project" };
  const saving = session.save(draft);
  assert.equal(await session.save(draft), false); assert.equal(shares, 1);
  active = false; finish(); await assert.rejects(saving, /account changed/); assert.equal(mirrors, 0);
});

test("empty memos perform no writes", async () => {
  const fail = async () => assert.fail("empty memo written");
  const session = createWidgetMemoSave({ assertActive() {}, savePrivate: fail, saveProject: fail, mirrorProject: fail });
  await assert.rejects(session.save(newWidgetMemoDraft("empty")), /入力/);
  assert.equal(session.locked(), false);
});
