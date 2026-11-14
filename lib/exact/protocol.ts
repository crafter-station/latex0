// Messages between the preview and the exact engine's worker.

export interface ExactRequest {
  id: number
  source: string
  /** \includegraphics names → URLs of the files */
  images: Record<string, string>
}

/** A page of a PDF file shown as an image: the file's URL and \includegraphics name, the page (from 1), the
 *  rectangle of it that fills the image's box (x1 y1 x2 y2 in the page's default user space, bp), how many degrees
 *  clockwise the page is turned when shown (0, 90, 180 or 270), and the largest size in bp the box has on the paper */
export interface PdfRegion {
  url: string; name: string
  page: number; box: [number, number, number, number]; rotate: number
  width: number; height: number
}

/** In the pages, the <image> of the PDF region `pdfRegions[n]` has the href `pdf-region:n`: the preview puts the
 *  picture it draws of the region there */
export const PDF_REGION = "pdf-region:"

export type ExactResponse =
  /** `warnings`: what is on the pages that the view does not draw */
  | { id: number; ok: true; pages: string[]; fonts: string[]; warnings: string[]; pdfRegions: PdfRegion[]; ms: number }
  /** the document has something the exact engine cannot lay out yet */
  | { id: number; ok: false; reason: string }
