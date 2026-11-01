import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import ts from 'typescript';
import * as zoom from '../src/features/taskPlanning/timelineZoom.ts';
import * as planning from '../src/features/taskPlanning/planningCore.ts';
import * as paging from '../src/features/taskPlanning/edgePaging.ts';
import { DEFAULT_TIMEBOX_SCHEDULE, SLOT_KEYS, SLOT_LABELS } from '../src/types/timer.ts';

type Element = { type: string; props: any };
const flatten = (value: any): Element[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [];

function fixture() {
  const slots: any[] = [];
  let cursor = 0, frameId = 0;
  const frames = new Map<number, () => void>();
  const memo = (fn: () => any, deps: any[]) => {
    const index = cursor++;
    const old = slots[index];
    if (!old || deps.some((dep, i) => dep !== old.deps[i])) slots[index] = { deps, value: fn() };
    return slots[index].value;
  };
  const react = {
    createElement: (type: string, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useRef: (initial: any) => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useMemo: memo, useCallback: (fn: any, deps: any[]) => memo(() => fn, deps), useEffect: () => { cursor++; },
  };
  const native = {
    Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    useWindowDimensions: () => ({ height: 900 }),
    PanResponder: { create: (handlers: any) => ({ panHandlers: handlers }) },
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {} },
  };
  const mocks: Record<string, any> = {
    react, 'react-native': native, 'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path' },
    '../common/KeyboardAwareModal': { __esModule: true, default: 'Modal' },
    '../../features/taskPlanning/timelineZoom': zoom,
    '../../features/taskPlanning/planningCore': planning,
    '../../features/taskPlanning/edgePaging': paging,
    '../../types/timer': { SLOT_KEYS, SLOT_LABELS },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/tasks/TaskTimeline.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => { assert.ok(mocks[name], name); return mocks[name]; },
    requestAnimationFrame: (callback: () => void) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  const scrolls: { chart: number[]; axis: number[] } = { chart: [], axis: [] };
  const creates: any[] = [];
  const props = { dates: ['2026-10-25'], items: [], undated: [], schedule: DEFAULT_TIMEBOX_SCHEDULE, canCreate: true, onPage() {}, onEdit() {}, onPlace() {}, onCreate: (...args: any[]) => creates.push(args) };
  const render = () => {
    cursor = 0;
    const tree = exports.default(props);
    const nodes = flatten(tree);
    const chart = nodes.find(node => node.type === 'ScrollView' && node.props.onScroll && node.props.onContentSizeChange)!;
    const axis = nodes.find(node => node.type === 'ScrollView' && node.props.pointerEvents === 'none')!;
    const viewport = nodes.find(node => node.props.onPanResponderMove)!;
    chart.props.ref.current = { scrollTo: ({ y }: any) => scrolls.chart.push(y) };
    axis.props.ref.current = { scrollTo: ({ y }: any) => scrolls.axis.push(y) };
    viewport.props.ref.current = { measureInWindow: (callback: any) => callback(0, 100, 350, 500) };
    return { tree, nodes, chart: chart.props, axis: axis.props, gesture: viewport.props };
  };
  const frame = () => { const next = [...frames.values()]; frames.clear(); next.forEach(callback => callback()); };
  const event = (distance: number) => ({ nativeEvent: { touches: [{ pageX: 100, pageY: 300 - distance / 2 }, { pageX: 100, pageY: 300 + distance / 2 }] } });
  return { render, scrolls, frame, frames, event, creates };
}

test('native content sizes must both catch up before zoom scrolls; stale offsets do not move the anchor', () => {
  const f = fixture();
  let view = f.render();
  view.gesture.onLayout();
  view.chart.onContentSizeChange(350, 1440); view.axis.onContentSizeChange(36, 1440);
  view.chart.onScroll({ nativeEvent: { contentOffset: { y: 300 } } });
  view.gesture.onPanResponderGrant(f.event(200));
  view.gesture.onPanResponderMove(f.event(300), {});
  assert.equal(f.frames.size, 1);
  f.frame();
  view = f.render();
  const before = f.scrolls.chart.length;
  view.chart.onContentSizeChange(350, 2160);
  assert.equal(f.scrolls.chart.length, before);
  view.chart.onScroll({ nativeEvent: { contentOffset: { y: 300 } } });
  view.axis.onContentSizeChange(36, 2160);
  assert.equal(f.scrolls.chart.at(-1), 550);
  assert.equal(f.scrolls.axis.at(-1), 550);

  view.gesture.onPanResponderMove(f.event(400), {});
  view.gesture.onPanResponderRelease(); // Flush the last sample before the next frame.
  assert.equal(f.frames.size, 0);
  view = f.render();
  view.chart.onContentSizeChange(350, 2880); view.axis.onContentSizeChange(36, 2880);
  assert.equal(f.scrolls.chart.at(-1), 800);
  view.chart.onScroll({ nativeEvent: { contentOffset: { y: 550 } } });
  view.gesture.onPanResponderGrant(f.event(200));
  f.frame();
  assert.equal(f.scrolls.chart.at(-1), 800, 'a new pinch must use the final zoom offset, not a stale scroll event');
});

test('grid keeps one creation surface per day and maps taps using the committed zoom scale', () => {
  const f = fixture();
  let view = f.render();
  view.gesture.onLayout();
  view.chart.onContentSizeChange(350, 1440); view.axis.onContentSizeChange(36, 1440);
  view.gesture.onPanResponderGrant(f.event(200));
  view.gesture.onPanResponderMove(f.event(400), {});
  view.gesture.onPanResponderRelease();
  view = f.render();
  const grids = view.nodes.filter(node => node.props.accessibilityLabel === '2026-10-25 予定を作成');
  assert.equal(grids.length, 1);
  grids[0].props.onPress({ nativeEvent: { locationY: 1086 } });
  assert.deepEqual(f.creates, [['2026-10-25', 545]]);
});
