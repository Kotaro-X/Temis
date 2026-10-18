import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function fixture() {
  const slots: any[] = []; let cursor = 0; let done = 0;
  const events = new Map<string, (event?: any) => void>(); const effects: (() => void)[] = [];
  const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next: any) => { slots[i] = next; }]; },
    useEffect: (effect: () => void) => { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(effect); } },
  };
  const modules: Record<string, any> = {
    react, 'react-native': { Platform: { OS: 'ios' }, BackHandler: { addEventListener: (_: string, listener: any) => { events.set('back', listener); return { remove: () => events.delete('back') }; } }, Keyboard: { addListener: (name: string, listener: any) => { events.set(name, listener); return { remove: () => events.delete(name) }; } }, useWindowDimensions: () => ({ width: 375, height: 812 }), Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } } },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView', initialWindowMetrics: {} },
    '../inputs/MemoTextEditor': { __esModule: true, default: 'MemoTextEditor' }, './MemoDetailLayout': { memoDetailStyles: {} },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/components/memo/MemoBodyEditorModal.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  const render = () => { cursor = 0; return exports.default({ visible: true, value: 'body', onChangeText: () => {}, onDone: () => { done++; }, language: 'ja' }); };
  render(); effects.forEach(effect => effect());
  return { render, events, done: () => done };
}
test('body editor keeps a bounded viewport through repeated keyboard frame changes and floating keyboards', () => {
  const f = fixture(); assert.equal(f.render().props.style.bottom, 0);
  for (let i = 0; i < 20; i++) {
    f.events.get('keyboardWillChangeFrame')!({ endCoordinates: { width: 375, screenY: 512 } });
    assert.equal(f.render().props.style.bottom, 300);
  }
  f.events.get('keyboardWillChangeFrame')!({ endCoordinates: { width: 180, screenY: 512 } }); assert.equal(f.render().props.style.bottom, 0);
  f.events.get('keyboardDidHide')!(); assert.equal(f.render().props.style.bottom, 0);
  assert.equal(f.events.get('back')!(), true); assert.equal(f.done(), 1);
});
