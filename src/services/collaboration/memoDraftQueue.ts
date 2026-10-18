export type MemoDraft = { title: string; body: string };
const equal = (a: MemoDraft | null, b: MemoDraft) => a?.title === b.title && a.body === b.body;

/** One session, one destination. Failed writes retain the latest draft for retry. */
export class MemoDraftQueue {
  private latest: MemoDraft;
  private saved: MemoDraft | null;
  private running: Promise<void> | null = null;
  private active = true;
  private generation = 0;
  private write: (draft: MemoDraft, assertActive: () => void) => Promise<void>;
  private valid: () => boolean;
  constructor(initial: MemoDraft, write: (draft: MemoDraft, assertActive: () => void) => Promise<void>, valid: () => boolean, isNew = false) {
    this.write = write; this.valid = valid;
    this.latest = initial;
    this.saved = isNew ? null : initial;
  }
  update(draft: MemoDraft) { this.latest = draft; }
  receiveExternal(draft: MemoDraft): boolean {
    if (!this.active || this.running || !equal(this.saved, this.latest)) return false;
    this.saved = { ...draft }; this.latest = { ...draft };
    return true;
  }
  invalidate() { this.active = false; this.generation++; }
  resume() { this.active = true; }
  assertActive = () => {
    if (!this.active || !this.valid()) throw new Error("アカウントまたはメモの利用状態が変わりました。画面を開き直してください。");
  };
  flush(): Promise<void> {
    if (this.running) return this.running;
    const generation = this.generation;
    const assertCurrent = () => { this.assertActive(); if (this.generation !== generation) throw new Error("メモの保存処理が取り消されました。"); };
    const run = async () => {
      assertCurrent();
      while (!equal(this.saved, this.latest)) {
        const draft = { ...this.latest };
        if (!this.saved && !draft.title.trim() && !draft.body.trim()) return;
        await this.write(draft, assertCurrent);
        assertCurrent();
        this.saved = draft;
      }
    };
    this.running = run().finally(() => { this.running = null; });
    return this.running;
  }
}
