// Messages between the preview and the exact engine's worker.

export interface ExactRequest {
  id: number
  source: string
  /** \includegraphics names → URLs of the files */
  images: Record<string, string>
}

export type ExactResponse =
  | { id: number; ok: true; pages: string[]; fonts: string[]; ms: number }
  /** the document has something the exact engine cannot lay out yet */
  | { id: number; ok: false; reason: string }
