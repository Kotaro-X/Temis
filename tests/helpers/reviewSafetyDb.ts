// In-memory transactions serialize writes; external moderation stays outside the lock.
export function safetyDb() {
  const values = new Map<string, any>();
  const clone = (value: any) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const snapshot = (ref: any) => ({ ref, id: ref.id, exists: values.has(ref.path), data: () => clone(values.get(ref.path)) });
  const doc = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snapshot(doc(path)), set: async (data: any) => { values.set(path, clone(data)); }, update: async (patch: any) => { values.set(path, { ...values.get(path), ...clone(patch) }); }, delete: async () => { values.delete(path); } });
  const collection = (path: string, filters: any[] = []): any => ({
    path, doc: (id: string) => doc(`${path}/${id}`), where: (key: string, op: string, expected: any) => collection(path, [...filters, [key, op, expected]]),
    get: async () => {
      const docs = [...values.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).filter(key => filters.every(([field, op, expected]) => {
        const actual = field.split('.').reduce((value: any, part: string) => value?.[part], values.get(key));
        return op === 'in' ? expected.includes(actual) : op === 'array-contains' ? actual?.includes(expected) : actual === expected;
      })).map(key => snapshot(doc(key)));
      return { docs, empty: !docs.length, size: docs.length };
    },
  });
  let serial = Promise.resolve();
  const runTransaction = <T>(body: (tx: any) => Promise<T>): Promise<T> => {
    const result = serial.then(async () => {
      const writes: (() => void)[] = [];
      const tx = { get: (ref: any) => ref.get(), set: (ref: any, data: any) => writes.push(() => values.set(ref.path, clone(data))),
        create: (ref: any, data: any) => writes.push(() => { if (values.has(ref.path)) throw new Error('exists'); values.set(ref.path, clone(data)); }),
        update: (ref: any, patch: any) => writes.push(() => { if (!values.has(ref.path)) throw new Error('missing'); values.set(ref.path, { ...values.get(ref.path), ...clone(patch) }); }),
        delete: (ref: any) => writes.push(() => values.delete(ref.path)), };
      const value = await body(tx); writes.forEach(write => write()); return value;
    });
    serial = result.then(() => {}, () => {}); return result;
  };
  return { values, doc, collection, runTransaction };
}
