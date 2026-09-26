export type WikiAnswerDocument = {
  memoId: string;
  body: string;
  tokens: string[];
  updatedAt: number;
  semanticScore: number;
  semanticText?: string;
};
export type WikiRetrievalDependencies = {
  loadDocuments: (ids: string[]) => Promise<WikiAnswerDocument[]>;
  findLinkedMemoIds: (tokens: string[], excludeIds: string[]) => Promise<string[]>;
};
export type WikiAnswerEvidence = {
  memoId: string;
  chunkId: string;
  snippetText: string;
  createdAt: number;
  tokensHit: string[];
  score: number;
  linkDepth: number;
  linkPath: string[];
  sourceDocumentIds: string[];
};
export function buildWikiAnswerExcerpt(body: string, question: string, links: string[], semanticText?: string): string;
export function retrieveWikiAnswerEvidence(question: string, seedIds: string[], deps: WikiRetrievalDependencies, maxMemos?: number): Promise<WikiAnswerEvidence[]>;
