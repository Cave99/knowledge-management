export interface Heading {
  id: string;
  text: string;
  level: number;
}
export interface KnowledgeDocument {
  id: string;
  title: string;
  description: string;
  space: string;
  spaceId: string;
  author: string;
  updatedAt: string;
  readMinutes: number;
  pinned: boolean;
  tags: string[];
  path: string;
  version: string;
  markdown: string;
  html: string;
  text: string;
  headings: Heading[];
}
export interface Space {
  id: string;
  name: string;
  count: number;
}
export interface Library {
  revision: string;
  documents: KnowledgeDocument[];
  spaces: Space[];
  diagnostics: { path: string; message: string }[];
}
