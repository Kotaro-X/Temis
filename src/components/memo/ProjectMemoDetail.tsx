import { saveRecoveryDraft, loadRecoveryDraft, clearRecoveryDraft } from "../../services/environment/recoveryDrafts";
import { registerEnvironmentSaveHandler } from "../../services/environment/switchLifecycle";
import { changedProjectTaskFields } from "../../services/collaboration/projectTaskCore";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { moveMemoScope } from "../../services/collaboration/moveMemoScope";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Pressable, Text } from "react-native";
import { nanoid } from "nanoid/non-secure";
import type { AppLanguage } from "../../i18n";
import type { Project, ProjectSharedNote, ProjectTask } from "../../types/collaboration";
import { useCollaboration } from "../../context/CollaborationContext";
import { getFirebaseAuth } from "../../services/sync/firebaseApp";
import { deleteNoteById, getNoteById, upsertNoteRecord } from "../../db/noteRepo";
import { listProjectSharedNotes, removeProjectSharedNote, upsertProjectSharedNote } from "../../services/collaboration/collaborationService";
import { MemoDraftQueue, type MemoDraft } from "../../services/collaboration/memoDraftQueue";
import { projectMemoEvidenceId, projectNoteIdFromEvidence } from "../../services/collaboration/projectMemoAIRetrievalCore";
import { listWikiReferencesByToken, type WikiReferenceItem } from "../../services/wikiReferenceService";
import { extractTokens } from "../../utils/wikiLink";
import MemoDetailScreen from "../../screens/MemoDetailScreen";
import WikiReferenceOverlay, { type WikiReferenceFilter } from "../WikiReferenceOverlay";
import Modal from "../common/KeyboardAwareModal";
import MemoPublicationControls from "../guild/MemoPublicationControls";
import GuildPostComposerModal from "../guild/GuildPostComposerModal";
import MemoEditorFields from "./MemoEditorFields";
import MemoBodyEditorModal from "./MemoBodyEditorModal";
import { MemoDetailLayout, memoDetailStyles as styles } from "./MemoDetailLayout";

type Props = {
  project: Project; initialNote: ProjectSharedNote | null; tasks: ProjectTask[];
  language: AppLanguage; closeRequest?: number; onBack: () => void; onChanged: () => void;
};
type Visit = { privateId?: string; key?: string; note: ProjectSharedNote | null; token?: string; filter?: WikiReferenceFilter };

export default function ProjectMemoDetail(props: Props) {
  const [visit, setVisit] = useState<Visit>({ note: props.initialNote });
  const [history, setHistory] = useState<Visit[]>([]);
  const [privateCloseRequest, setPrivateCloseRequest] = useState(0);
  const [privateId, setPrivateId] = useState<string | null>(null);
  const [returnToken, setReturnToken] = useState<string | undefined>();
  const back = () => {
    if (!history.length) { props.onBack(); return; }
    const previous = history[history.length - 1];
    setHistory(current => current.slice(0, -1)); setVisit(previous);
    if (previous.privateId) { setReturnToken(previous.token); setPrivateId(previous.privateId); }
  };
  return <>
    <ProjectMemoSession key={visit.key ?? props.initialNote?.id ?? "new"} {...props} initialNote={visit.note}
      initialToken={visit.token ?? returnToken} initialFilter={visit.filter}
      onBack={back} onSaved={note => setVisit(current => ({ ...current, note }))}
      onSelect={(item, note, token, filter) => {
        const projectId = projectNoteIdFromEvidence(item.memoId);
        if (!projectId) { setPrivateId(item.memoId); setReturnToken(token); return; }
        setHistory(current => [...current, { ...visit, privateId: undefined, note, token, filter }]);
        setVisit({ key: item.projectNoteId, note: item.projectNote! }); setReturnToken(undefined);
      }} />
    <Modal visible={Boolean(privateId)} animationType="slide" onRequestClose={() => setPrivateCloseRequest(current => current + 1)}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      {privateId ? <MemoDetailScreen closeRequest={privateCloseRequest} memoId={privateId} language={props.language} onBack={() => { setPrivateId(null); setVisit(current => ({ ...current, privateId: undefined })); }} referenceProjectId={props.project.id}
        initialReferenceToken={visit.privateId ? visit.token : undefined} initialReferenceFilter={visit.privateId ? visit.filter : undefined}
        onSelectProjectReference={(note, token, filter, fromMemoId) => {
          setHistory(current => [...current, { ...visit, privateId: fromMemoId, token, filter }]);
          setPrivateId(null); setReturnToken(undefined); setVisit({ key: note.id, note });
        }} /> : null}
      </SafeAreaProvider>
    </Modal>
  </>;
}

type Reference = WikiReferenceItem & { projectNote?: ProjectSharedNote };
function ProjectMemoSession({ project, initialNote, tasks, language, onBack, onChanged, initialToken, initialFilter, onSaved, onSelect, closeRequest }: Props & {
  initialToken?: string; initialFilter?: WikiReferenceFilter; onSaved: (note: ProjectSharedNote) => void;
  onSelect: (item: Reference, note: ProjectSharedNote, token: string, filter: WikiReferenceFilter) => void;
}) {
  const { profile, projects, overflowProjects } = useCollaboration();
  const [id] = useState(() => initialNote?.id ?? nanoid());
  const [sourceId] = useState(() => initialNote?.sourceNoteId ?? id);
  const [ownerUid] = useState(() => profile?.userId);
  const [title, setTitle] = useState(initialNote?.title ?? "");
  const [body, setBody] = useState(initialNote?.body ?? "");
  const [bodyOpen, setBodyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(Boolean(initialNote));
  const [publicationOpen, setPublicationOpen] = useState(false);
  const [token, setToken] = useState(initialToken ?? null);
  const [referenceOpen, setReferenceOpen] = useState(Boolean(initialToken));
  const [filter, setFilter] = useState<WikiReferenceFilter>(initialFilter ?? "all");
  const [references, setReferences] = useState<Reference[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const noteRef = useRef<ProjectSharedNote | null>(initialNote);
  const deleted = useRef(false);
  const role = overflowProjects.find(item => item.project.id === project.id)?.role;
  const anonymous = Boolean(initialNote && (initialNote.ownerUserId == null || initialNote.anonymizedReason === "project_exit"));
  const owns = !anonymous && (!initialNote || initialNote.ownerUserId === ownerUid);
  const linkedTaskId = initialNote?.sourceTaskId ?? tasks.find(task => (task.kind ?? "task") === "task" && !task.deletedAt && task.relatedMemoId === id)?.id;
  const linkedTaskMemo = Boolean(linkedTaskId);
  const editable = linkedTaskMemo ? Boolean(role) : (!initialNote || initialNote.projectId === project.id) && (anonymous ? role === "owner" : owns && (role === "owner" || role === "member"));
  const access = useRef({ editable, readable: Boolean(role), uid: profile?.userId });
  access.current = { editable, readable: Boolean(role), uid: profile?.userId };
  const alive = useRef(true);
  const [queue] = useState(() => new MemoDraftQueue({ title: initialNote?.title ?? "", body: initialNote?.body ?? "" }, async (draft, assertActive) => {
    assertActive();
    const shared: ProjectSharedNote = { ...(noteRef.current ?? {
      id, sourceNoteId: sourceId, ownerUserId: ownerUid!, projectId: project.id,
      creatorDisplayName: profile?.displayName?.trim() || `@${profile?.username}`,
      creatorAnonymizedAt: null, anonymizedReason: null,
    }), title: draft.title.trim() || null, body: draft.body, updatedAt: Date.now() };
    if (linkedTaskId) shared.sourceTaskId = linkedTaskId;
    await upsertProjectSharedNote(shared, linkedTaskMemo ? changedProjectTaskFields(
      { title: noteRef.current?.title ?? "", description: noteRef.current?.body ?? "" },
      { title: shared.title ?? "", description: shared.body },
    ) : undefined);
    assertActive();
    // Shared content remains authoritative; only the author mirrors its source locally.
    if (owns && !linkedTaskMemo) {
      await upsertNoteRecord({ id: sourceId, type: "free", date: null, title: shared.title,
        body: shared.body, scope: "project", projectId: project.id, updatedAt: shared.updatedAt });
      assertActive();
    }
    noteRef.current = shared;
    if (alive.current) { setExists(true); setError(null); onSaved(shared); onChanged(); }
  }, () => alive.current && !deleted.current && access.current.editable && access.current.uid === ownerUid && getFirebaseAuth().currentUser?.uid === ownerUid, !initialNote));
  const draft = useRef<MemoDraft>({ title, body });
  const change = (next: MemoDraft) => { draft.current = next; queue.update(next); setTitle(next.title); setBody(next.body); };
  const report = useCallback((cause: unknown) => { if (alive.current) setError(cause instanceof Error ? cause.message : "保存できませんでした。再試行してください。"); }, []);
  const flush = useCallback(async () => {
    if (!editable) {
      if (draft.current.title !== (initialNote?.title ?? "") || draft.current.body !== (initialNote?.body ?? "")) throw new Error("編集権限が変わりました。入力内容は保持されています。");
      return;
    }
    queue.update(draft.current); await queue.flush();
    await clearRecoveryDraft(`project:${project.id}:${id}`);
  }, [editable, initialNote?.title, initialNote?.body, queue, project.id, id]);
  const recoveryId = `project:${project.id}:${id}`;
  useEffect(() => registerEnvironmentSaveHandler(flush, () => saveRecoveryDraft(recoveryId, draft.current)), [flush, recoveryId]);
  useEffect(() => {
    let active = true;
    void loadRecoveryDraft(recoveryId).then(saved => {
      if (active && saved) { draft.current = saved; queue.update(saved); setTitle(saved.title); setBody(saved.body); }
    }).catch(report);
    return () => { active = false; };
  }, [queue, recoveryId, report]);
  const action = async (work: () => Promise<void>) => {
    if (busy) return; setBusy(true);
    try { await work(); } catch (cause) { report(cause); Alert.alert("操作を完了できません", cause instanceof Error ? cause.message : "入力内容は保持されています。再試行してください。"); } finally { if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    if (!editable) return;
    const timer = setTimeout(() => { void flush().catch(report); }, 800);
    return () => clearTimeout(timer);
  }, [title, body, editable, flush, report]);
  useEffect(() => () => { alive.current = false; queue.invalidate(); }, [queue]);
  useEffect(() => {
    let active = true;
    if (!referenceOpen || !token || !access.current.readable) { setReferences([]); setReferenceLoading(false); return; }
    setReferenceLoading(true); setReferences([]);
    void listProjectSharedNotes(project.id).then(async notes => {
      const items = await listWikiReferencesByToken(token, { noteScope: "personal", projectId: project.id, projectNotes: notes,
        excludeMemoId: projectMemoEvidenceId(project.id, id) });
      if (active && access.current.uid === ownerUid && access.current.readable) {
        setReferences(items.map(item => ({ ...item, projectNote: notes.find(note => note.id === item.projectNoteId) })));
      }
    }).catch(cause => { if (active) report(cause); }).finally(() => { if (active) setReferenceLoading(false); });
    return () => { active = false; };
  }, [referenceOpen, token, project.id, id, ownerUid, role, report]);
  const closeBody = () => { void action(async () => { await flush(); Keyboard.dismiss(); setBodyOpen(false); }); };
  const back = () => { void action(async () => { await flush(); onBack(); }); };
  const backRef = useRef(back); backRef.current = () => { if (bodyOpen) closeBody(); else if (!publicationOpen) back(); };
  const lastCloseRequest = useRef(closeRequest);
  useEffect(() => { if (closeRequest !== lastCloseRequest.current) { lastCloseRequest.current = closeRequest; backRef.current(); } }, [closeRequest]);
  const confirmDelete = () => Alert.alert("メモを消去しますか？", "この操作は取り消せません。", [
    { text: "キャンセル", style: "cancel" }, { text: "消去", style: "destructive", onPress: () => void action(async () => {
      await flush(); queue.assertActive();
      deleted.current = true; queue.invalidate();
      try { if (noteRef.current) await removeProjectSharedNote(id); }
      catch (cause) { deleted.current = false; queue.resume(); throw cause; }
      if (owns && getFirebaseAuth().currentUser?.uid === ownerUid) await deleteNoteById(sourceId);
      onChanged(); onBack();
    }) },
  ]);
  const linked = linkedTaskMemo || tasks.some(task => task.relatedMemoId === sourceId);
  const move = (destination: string | null) => { void action(async () => {
    await flush(); queue.assertActive();
    if (!noteRef.current) return;
    queue.invalidate();
    let syncPending = false;
    try { const moved = await moveMemoScope(sourceId, destination, profile!); syncPending = "syncPending" in moved && Boolean(moved.syncPending); }
    catch (cause) { queue.resume(); throw cause; }
    onChanged(); onBack();
    if (syncPending) Alert.alert("保存先を変更しました", "共有先の変更は完了しました。個人データの同期は再試行が必要です。");
  }); };
  const scopePicker = () => Alert.alert("保存先", "プロジェクトを選択すると、メンバーに共有されます。", [
    { text: "個人", onPress: () => Alert.alert("共有を解除しますか？", "このメモはProjectメンバーから見えなくなります。", [{ text: "キャンセル", style: "cancel" }, { text: "変更する", onPress: () => move(null) }]) },
    ...projects.filter(p => p.id !== project.id && !p.deletedAt && overflowProjects.some(item => item.project.id === p.id && item.role !== "viewer")).map(p => ({ text: p.name, onPress: () => Alert.alert("メモを共有しますか？", "移動先のメンバーに共有されます。", [{ text: "キャンセル", style: "cancel" }, { text: "共有する", onPress: () => move(p.id) }]) })),
    { text: "キャンセル", style: "cancel" },
  ]);
  return <>
    <MemoDetailLayout language={language} obscured={bodyOpen || publicationOpen} onBack={back} busy={busy} onDelete={editable && exists && !linkedTaskMemo ? confirmDelete : undefined}
      controls={owns && editable && exists ? <MemoPublicationControls sourceId={`note:${sourceId}`} flushDraft={flush} onCreate={() => { void action(async () => { await flush(); setPublicationOpen(true); }); }} /> : undefined}>
      <Text style={styles.title}>{title.trim() || (language === "en" ? "Untitled" : "無題")}</Text>
      <Text style={styles.meta}>{project.name} · 作成者: {anonymous ? "匿名ユーザー" : owns ? "あなた" : initialNote?.creatorDisplayName || "メンバー"}</Text>
      {owns && editable ? <Pressable disabled={linked || busy} style={styles.scope} onPress={scopePicker}><Text style={styles.scopeText}>保存先：プロジェクト{linked ? "（タスクに紐づいています）" : ""}</Text></Pressable> : null}
      {!editable ? <Text style={styles.meta}>このメモは読み取り専用です。</Text> : null}
      {error ? <Pressable onPress={() => { void action(flush); }}><Text accessibilityRole="alert" style={{ color: "#b91c1c", marginBottom: 8 }}>{error} · 再試行</Text></Pressable> : null}
      <MemoEditorFields title={title} body={body} editable={editable && !busy} language={language} tokens={extractTokens(body)}
        onChangeTitle={value => change({ ...draft.current, title: value })} onChangeBody={value => change({ ...draft.current, body: value })}
        onEditBody={editable && !busy ? () => { Keyboard.dismiss(); setBodyOpen(true); } : undefined}
        onPressToken={value => { void action(async () => { await flush(); setToken(value); setFilter("all"); setReferenceOpen(true); }); }} />
    </MemoDetailLayout>
    <MemoBodyEditorModal visible={bodyOpen} value={body} onChangeText={value => change({ ...draft.current, body: value })} onDone={closeBody} busy={busy} language={language} />
    <WikiReferenceOverlay visible={referenceOpen} token={token} items={references} loading={referenceLoading} filter={filter} language={language} onClose={() => setReferenceOpen(false)} onChangeFilter={setFilter}
      onSelectItem={memoId => { void action(async () => { await flush(); const item = references.find(value => value.memoId === memoId); if (!item || !noteRef.current || !token) return; if (!access.current.readable || getFirebaseAuth().currentUser?.uid !== ownerUid) throw new Error("参照する権限がありません。"); if (item.projectNoteId) setReferenceOpen(false); onSelect(item, noteRef.current, token, filter); }); }} />
    {owns && editable && exists ? <GuildPostComposerModal embedded visible={publicationOpen} onClose={() => setPublicationOpen(false)} initialTitle={title} initialBody={body}
      source={{ scope: "project", memoId: `note:${sourceId}`, projectId: project.id }} onPublished={() => { setPublicationOpen(false); void action(async () => { queue.assertActive(); const source = await getNoteById(sourceId); queue.assertActive(); if (source) { change({ title: source.title ?? "", body: source.body }); await flush(); } }); }} /> : null}
  </>;
}
