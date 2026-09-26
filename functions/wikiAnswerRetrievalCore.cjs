// Shared by the app and Cloud Functions. No platform dependencies.
const compare = (a, b) =>
  b.roots.size - a.roots.size || b.shared.size - a.shared.size ||
  a.depth - b.depth || b.document.semanticScore - a.document.semanticScore ||
  b.document.updatedAt - a.document.updatedAt || a.document.memoId.localeCompare(b.document.memoId);

/** Gather windows throughout the document, not just its first chunk. */
const buildWikiAnswerExcerpt = (body, question, links, semanticText = "") => {
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length <= 1200) return text;
  const normalized = text.replace(/（/g, "(").replace(/）/g, ")");
  const terms = [semanticText.replace(/\s+/g, " ").trim().slice(0, 100), ...links.map((token) => `((${token}))`), question.trim(),
    ...question.split(/[\s、。！？?]+/u).filter((term) => term.length >= 2)];
  // A short prefix retains context; spread the remaining budget over matched regions.
  const centers = Array.from(new Set(terms.filter(Boolean).flatMap((term) => {
    const at = normalized.indexOf(term);
    return at < 0 ? [] : [at];
  }))).slice(0, 6);
  if (!centers.length) return text.slice(0, 1199) + "…";
  const radius = Math.floor(950 / centers.length / 2);
  const ranges = [[0, 200], ...centers.map((at) => [Math.max(0, at - radius), Math.min(text.length, at + radius)])]
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged.map(([from, to]) => text.slice(from, to)).join(" … ").slice(0, 1200);
};

const retrieveWikiAnswerEvidence = async (
  question,
  seedIds,
  deps,
  maxMemos = 15,
) => {
  const candidates = new Map();
  const checkedIds = new Set();
  const load = async (ids) => {
    const fresh = Array.from(new Set(ids)).filter((id) => !checkedIds.has(id)).slice(0, 300 - checkedIds.size);
    fresh.forEach((id) => checkedIds.add(id));
    if (!fresh.length) return;
    for (const document of await deps.loadDocuments(fresh)) {
      if (!document.body.trim()) continue;
      candidates.set(document.memoId, { document, roots: new Set(), shared: new Set(), depth: Infinity, path: [], sourceDocumentIds: [] });
    }
  };
  // Search hits may include multiple chunks, deleted documents, or blank documents.
  await load(seedIds);
  const seeds = Array.from(new Set(seedIds)).map((id) => candidates.get(id)).filter((c) => !!c).slice(0, 4);
  for (const seed of seeds) {
    seed.depth = 0;
    seed.sourceDocumentIds = [seed.document.memoId];
    seed.roots.add(seed.document.memoId);
  }
  let frontier = seeds;
  // Each root traverses a token once, at its shortest reachable depth. Other roots
  // may still traverse it later, which preserves multi-root ranking without cycles.
  const expanded = new Map();
  for (let depth = 1; depth <= 3 && frontier.length; depth++) {
    const edges = new Map();
    for (const parent of frontier) {
      for (const root of parent.roots) {
        const visited = expanded.get(root) ?? new Set();
        for (const token of parent.document.tokens) {
          if (visited.has(token)) continue;
          const entries = edges.get(token) ?? [];
          entries.push({ root, parent });
          edges.set(token, entries);
        }
      }
    }
    if (!edges.size) break;
    for (const [token, entries] of edges) {
      for (const { root } of entries) {
        const visited = expanded.get(root) ?? new Set();
        visited.add(token);
        expanded.set(root, visited);
      }
    }
    await load(await deps.findLinkedMemoIds(Array.from(edges.keys()), Array.from(checkedIds)));
    const next = new Set();
    for (const candidate of candidates.values()) {
      for (const token of candidate.document.tokens) {
        for (const { root, parent } of edges.get(token) ?? []) {
          if (candidate === parent) continue;
          candidate.shared.add(token);
          parent.shared.add(token);
          if (depth < candidate.depth) {
            candidate.depth = depth;
            candidate.path = [...parent.path, token];
            candidate.sourceDocumentIds = [...parent.sourceDocumentIds, candidate.document.memoId];
          }
          if (!candidate.roots.has(root)) {
            candidate.roots.add(root);
            next.add(candidate);
          }
        }
      }
    }
    frontier = Array.from(next).sort(compare).slice(0, 30);
  }
  const seedSet = new Set(seeds);
  const additional = Array.from(candidates.values())
    .filter((c) => !seedSet.has(c) && Number.isFinite(c.depth)).sort(compare);
  return [...seeds, ...additional].slice(0, Math.min(15, Math.max(1, maxMemos))).map((c) => ({
    memoId: c.document.memoId,
    chunkId: `wiki-answer:${c.document.memoId}`,
    snippetText: buildWikiAnswerExcerpt(c.document.body, question, [...c.path, ...c.shared], c.document.semanticText),
    createdAt: c.document.updatedAt,
    tokensHit: Array.from(c.shared).sort(),
    score: c.document.semanticScore,
    linkDepth: c.depth,
    linkPath: c.path,
    sourceDocumentIds: c.sourceDocumentIds,
  }));
};

module.exports = { buildWikiAnswerExcerpt, retrieveWikiAnswerEvidence };
