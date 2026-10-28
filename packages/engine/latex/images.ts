// Images as pdfTeX reads them for \pdfximage: a bitmap's size in pixels and its resolution, from the file's header
// alone (writepng.c, writejpg.c), or a PDF file's page boxes (pdf.ts). The engine never reads files: the app passes
// what imageInfo returns for each uploaded image (document(source, { images })).

import { pdfInfo, type Pdf } from "./pdf"

/** A PNG or JPEG: its size in pixels, and its resolution in dots per inch (0: none given) */
export interface Bitmap { kind: "png" | "jpg"; width: number; height: number; xres: number; yres: number
  /** a PNG pdfTeX writes objects of its own for (writepng.c: a palette, a soft mask for its alpha channel or tRNS, an
   *  ICC profile) besides the image's */
  objects?: true }

/** What pdfTeX reads of an image file */
export type Image = Bitmap | Pdf

/** A PNG's, JPEG's or PDF file's size information, or null for another file */
export function imageInfo(bytes: Uint8Array): Image | null {
  return bitmapInfo(bytes) ?? pdfInfo(bytes)
}

/** The size and resolution in a PNG's or JPEG's header, or null for another file */
export function bitmapInfo(bytes: Uint8Array): Bitmap | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 24 && dv.getUint32(0) === 0x89504e47 && dv.getUint32(4) === 0x0d0a1a0a) return png(dv)
  if (bytes.length >= 4 && dv.getUint16(0) === 0xffd8) return jpg(dv)
  return null
}

/** IHDR, and pHYs in pixels per metre (writepng.c: the resolution is round(0.0254 × it)) */
function png(dv: DataView): Bitmap | null {
  const out: Bitmap = { kind: "png", width: 0, height: 0, xres: 0, yres: 0 }
  for (let p = 8; p + 8 <= dv.byteLength;) {
    const len = dv.getUint32(p), type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7))
    if (type === "IHDR") { out.width = dv.getUint32(p + 8); out.height = dv.getUint32(p + 12); if (dv.getUint8(p + 17) !== 0 && dv.getUint8(p + 17) !== 2) out.objects = true }
    else if (type === "tRNS" || type === "iCCP") out.objects = true
    else if (type === "pHYs" && dv.getUint8(p + 16) === 1) { out.xres = Math.round(0.0254 * dv.getUint32(p + 8)); out.yres = Math.round(0.0254 * dv.getUint32(p + 12)) }
    else if (type === "IDAT" || type === "IEND") break
    p += 12 + len
  }
  return out.width && out.height ? out : null
}

/** the frame header's size, and a JFIF APP0's density (units 1: per inch; 2: per cm, × 2.54 truncated, as pdfTeX
 *  does: 40 per cm is 101 dpi); pdfTeX reads no Exif resolution */
function jpg(dv: DataView): Bitmap | null {
  const out: Bitmap = { kind: "jpg", width: 0, height: 0, xres: 0, yres: 0 }
  for (let p = 2; p + 4 <= dv.byteLength;) {
    if (dv.getUint8(p) !== 0xff) return null
    const marker = dv.getUint8(p + 1), len = dv.getUint16(p + 2)
    if (marker === 0xe0 && len >= 14 && dv.getUint32(p + 4) === 0x4a464946) { // "JFIF"
      const units = dv.getUint8(p + 11), x = dv.getUint16(p + 12), y = dv.getUint16(p + 14)
      if (units === 1) { out.xres = x; out.yres = y }
      else if (units === 2) { out.xres = Math.trunc(x * 2.54); out.yres = Math.trunc(y * 2.54) }
    } else if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) { // SOFn
      out.height = dv.getUint16(p + 5); out.width = dv.getUint16(p + 7)
      break
    }
    p += 2 + len
  }
  return out.width && out.height ? out : null
}
