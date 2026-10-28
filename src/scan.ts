import { prepareZXingModule, readBarcodes, type ReaderOptions, type ReadResult } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { createWorker, PSM, type Page, type Worker } from 'tesseract.js'
import { getScan, patchScan, putScan, type Barcode, type Scan } from './db'
import { classifyBarcodes, mergeFields, parseOcr } from './parse'

// Serve the barcode decoder from our own origin so it works offline.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
  fireImmediately: true,
})

const DECODE_MAX = 2560
const FULL_MAX = 4096
const PHOTO_MAX = 2000
const THUMB_MAX = 320

// crypto.randomUUID only exists on HTTPS and newer browsers; getRandomValues works everywhere.
const newId = () =>
  Date.now().toString(36) +
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')

function drawScaled(bitmap: ImageBitmap, max: number, upscale = false) {
  const fit = max / Math.max(bitmap.width, bitmap.height)
  const scale = upscale ? fit : Math.min(1, fit)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  )
const toJpeg = (canvas: HTMLCanvasElement, quality: number) => encode(canvas, 'image/jpeg', quality)
// Lossless, for OCR on photos that are already small or compressed (e.g. sent through a chat app).
const toPng = (canvas: HTMLCanvasElement) => encode(canvas, 'image/png')

type Format = NonNullable<ReaderOptions['formats']>[number]
const BOX_FORMATS: Format[] = ['Code128', 'UPCA', 'EAN13', 'QRCode', 'DataMatrix']
const INVOICE_FORMATS: Format[] = ['Code128', 'Code39', 'ITF', 'EAN13', 'QRCode', 'DataMatrix', 'PDF417']

async function decode(canvas: HTMLCanvasElement, formats = BOX_FORMATS) {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  return readBarcodes(data, { formats, tryHarder: true, maxNumberOfSymbols: 20 })
}

interface Point {
  x: number
  y: number
}

const STRIP_WIDTH = 1800

/**
 * Cuts a rectangle out of a photo that may be tilted: it starts at `origin`, runs `along` pixels in
 * direction `u` and `down` pixels at a right angle to it. The result is straightened and enlarged
 * so the small recipient text is easy for OCR.
 */
function cropStraight(bitmap: ImageBitmap, origin: Point, u: Point, along: number, down: number) {
  const v = { x: -u.y, y: u.x }
  const s = STRIP_WIDTH / along
  const canvas = document.createElement('canvas')
  canvas.width = STRIP_WIDTH
  canvas.height = Math.round(down * s)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // Maps photo pixels into the crop: x along u, y along v, both measured from the origin.
  const o = origin
  ctx.setTransform(s * u.x, s * v.x, s * u.y, s * v.y, -s * (o.x * u.x + o.y * u.y), -s * (o.x * v.x + o.y * v.y))
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0)
  return canvas
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Cuts out a box measured from a line on the label (`from` → `to`, in photo pixels). Offsets are in
 * units of that line's length: `left`/`right` along it, `top`/`bottom` below it (negative is above).
 */
function stripFromLine(bitmap: ImageBitmap, from: Point, to: Point, box: Box) {
  const w = Math.hypot(to.x - from.x, to.y - from.y)
  if (w < 40) return null
  const u = { x: (to.x - from.x) / w, y: (to.y - from.y) / w }
  const v = { x: -u.y, y: u.x }
  const origin = {
    x: from.x + (u.x * box.left + v.x * box.top) * w,
    y: from.y + (u.y * box.left + v.y * box.top) * w,
  }
  return cropStraight(bitmap, origin, u, (box.right - box.left) * w, (box.bottom - box.top) * w)
}

// Measured on Tokopedia labels, in barcode widths: across from just left of the bars to just right
// of them, and down from the middle of the bars past the big invoice number and the
// "Penerima | Pengirim / Marketplace" box.
const BELOW_BARCODE: Box = { left: -0.25, right: 1.35, top: 0.06, bottom: 0.4 }
// The same box measured from the printed invoice number's baseline, in number widths.
const BELOW_NUMBER: Box = { left: -0.4, right: 1.3, top: -0.12, bottom: 0.32 }

/** The invoice barcode: a long number if there is one, else the first linear barcode. */
function pickInvoiceBarcode(results: ReadResult[]) {
  const linear = results.filter((r) => !['QRCode', 'DataMatrix', 'PDF417'].includes(r.format))
  return linear.find((r) => /^\d{12,24}$/.test(r.text.trim())) ?? linear[0]
}

/** The OCR line that is the big printed invoice number (mostly digits, 12 or more of them). */
function findNumberLine(page: Page) {
  const lines = (page.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
  return lines
    .map((line) => ({ line, digits: line.text.replace(/\D/g, '').length, chars: line.text.replace(/\s/g, '').length }))
    .filter(({ digits, chars }) => digits >= 12 && digits / chars > 0.75)
    .sort((a, b) => b.digits - a.digits)[0]?.line
}

const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/**
 * Reads the invoice barcodes right away, and starts reading its text in the background (`details`).
 * The recipient, sender and marketplace come from the strip just below the invoice barcode. When the
 * barcode can't be read (it is often cut off where the paper curls), the big printed number is found
 * by OCR instead and the strip is measured from it. `photo` is the copy that gets stored.
 */
export async function readInvoice(file: Blob) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const decodeCanvas = drawScaled(bitmap, DECODE_MAX)
    const results = await decode(decodeCanvas, INVOICE_FORMATS)
    const barcode = pickInvoiceBarcode(results)
    const scale = bitmap.width / decodeCanvas.width
    const at = (p: Point) => ({ x: p.x * scale, y: p.y * scale })
    const pos = barcode?.position
    const strip = pos && stripFromLine(bitmap, at(mid(pos.topLeft, pos.bottomLeft)), at(mid(pos.topRight, pos.bottomRight)), BELOW_BARCODE)
    const photoCanvas = drawScaled(bitmap, PHOTO_MAX)
    // Measured now: the bitmap is closed (and reports zero size) by the time the text is read.
    const photoScale = bitmap.width / photoCanvas.width
    const [photo, stripImage] = await Promise.all([toJpeg(photoCanvas, 0.85), strip ? toPng(strip) : undefined])
    const details = stripImage
      ? ocr(stripImage, { priority: 1, layout: PSM.SPARSE_TEXT }).then((text) => ({ text, strip: stripImage }))
      : toPng(photoCanvas).then((png) => readStripFromNumber(file, png, photoScale))
    return { photo, barcodes: results.map((r) => r.text), details }
  } finally {
    bitmap.close()
  }
}

async function readStripFromNumber(file: Blob, image: Blob, scale: number): Promise<{ text: string; strip?: Blob }> {
  const page = await ocrPage(image, { priority: 1, layout: PSM.AUTO, lines: true })
  const line = findNumberLine(page)
  if (!line) return { text: page.text }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const b = line.baseline
    const strip = stripFromLine(bitmap, { x: b.x0 * scale, y: b.y0 * scale }, { x: b.x1 * scale, y: b.y1 * scale }, BELOW_NUMBER)
    if (!strip) return { text: page.text }
    const stripImage = await toPng(strip)
    const text = await ocr(stripImage, { priority: 1, layout: PSM.SPARSE_TEXT })
    // Strip first so its "Penerima" wins; the whole page still helps match the invoice number.
    return { text: `${text}\n${page.text}`, strip: stripImage }
  } finally {
    bitmap.close()
  }
}

export async function scanPhoto(file: Blob, extra: Pick<Scan, 'orderId' | 'invoice'> = {}): Promise<Scan> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    let results = await decode(drawScaled(bitmap, DECODE_MAX))
    // Dense labels sometimes need the full-resolution photo.
    if (results.length < 4 && Math.max(bitmap.width, bitmap.height) > DECODE_MAX) {
      const full = await decode(drawScaled(bitmap, FULL_MAX))
      if (full.length > results.length) results = full
    }

    const barcodes: Barcode[] = results.map((r) => ({ format: r.format, text: r.text }))
    const [photo, thumb] = await Promise.all([
      toJpeg(drawScaled(bitmap, PHOTO_MAX), 0.85),
      toJpeg(drawScaled(bitmap, THUMB_MAX), 0.7),
    ])

    const scan: Scan = {
      id: newId(),
      createdAt: Date.now(),
      photo,
      thumb,
      barcodes,
      fields: classifyBarcodes(results),
      ocrText: null,
      ocrStatus: 'pending',
      ...extra,
    }
    await putScan(scan)
    return scan
  } finally {
    bitmap.close()
  }
}

let workerPromise: Promise<Worker> | null = null
const getWorker = () => (workerPromise ??= createWorker('eng'))

/** Start loading the OCR engine early so the first scan doesn't wait for it. */
export function warmUpOcr() {
  void getWorker()
}

/**
 * Tesseract page segmentation: box labels read best as one block (the engine default); invoice
 * cells ("Penerima | Pengirim") get merged that way, so the invoice strip uses sparse text; finding
 * the invoice number on a whole invoice photo works best with automatic layout.
 */
export type OcrLayout = PSM.SINGLE_BLOCK | PSM.SPARSE_TEXT | PSM.AUTO

interface OcrOptions {
  priority?: number
  layout?: OcrLayout
  /** Let Tesseract detect and undo a tilted photo first. */
  straighten?: boolean
  /** Also return line positions (for locating text on the photo). */
  lines?: boolean
}

interface OcrJob extends Required<OcrOptions> {
  image: Blob
  resolve: (page: Page) => void
  reject: (err: unknown) => void
}

const jobs: OcrJob[] = []
let ocrBusy = false
let currentLayout: OcrLayout = PSM.SINGLE_BLOCK

/** One shared OCR engine; higher priority jobs (invoices someone is waiting on) jump the queue. */
function ocrPage(image: Blob, { priority = 0, layout = PSM.SINGLE_BLOCK, straighten = false, lines = false }: OcrOptions = {}) {
  return new Promise<Page>((resolve, reject) => {
    jobs.push({ image, priority, layout, straighten, lines, resolve, reject })
    jobs.sort((a, b) => b.priority - a.priority)
    void pumpOcr()
  })
}

export const ocr = (image: Blob, options?: OcrOptions) => ocrPage(image, options).then((p) => p.text)

async function pumpOcr() {
  if (ocrBusy) return
  ocrBusy = true
  while (jobs.length) {
    const job = jobs.shift()!
    try {
      const worker = await getWorker()
      if (job.layout !== currentLayout) {
        await worker.setParameters({ tessedit_pageseg_mode: job.layout })
        currentLayout = job.layout
      }
      const { data } = await worker.recognize(job.image, { rotateAuto: job.straighten }, { text: true, blocks: job.lines })
      job.resolve(data)
    } catch (err) {
      job.reject(err)
    }
  }
  ocrBusy = false
}

/**
 * Reads a stored box photo again from scratch (barcodes, then text in the background), for
 * scans whose first read came out poorly. Order link and invoice are kept.
 */
export async function rereadScan(id: string, onDone: () => void) {
  const scan = await getScan(id)
  if (!scan) return
  const bitmap = await createImageBitmap(scan.photo)
  try {
    const results = await decode(drawScaled(bitmap, DECODE_MAX))
    await patchScan(id, (s) => {
      // The stored photo is smaller than the original, so it may yield fewer barcodes; keep any
      // value an earlier barcode already proved.
      const fields = classifyBarcodes(results)
      for (const k of ['imei1', 'imei2', 'eid', 'serial', 'upc'] as const) {
        const prev = s.fields[k]
        if (!fields[k] && prev && s.barcodes.some((b) => b.text.includes(prev))) fields[k] = prev
      }
      const barcodes = results.length >= s.barcodes.length ? results.map((r) => ({ format: r.format, text: r.text })) : s.barcodes
      return { ...s, barcodes, fields, ocrText: null, ocrStatus: 'pending' }
    })
  } finally {
    bitmap.close()
  }
  queueOcr([id], onDone)
}

const queue: string[] = []
let running = false

/** Box labels are read in the background, one at a time; `onDone` fires after each record is updated. */
export function queueOcr(ids: string[], onDone: () => void) {
  for (const id of ids) if (!queue.includes(id)) queue.push(id)
  if (!running) void drain(onDone)
}

async function drain(onDone: () => void) {
  running = true
  while (queue.length) {
    const id = queue.shift()!
    const scan = await getScan(id)
    if (!scan || scan.ocrStatus !== 'pending') continue
    try {
      let text = await ocr(scan.photo)
      // A tilted label reads as fragments; let Tesseract straighten it and keep whichever read more.
      const found = (t: string) => Object.keys(parseOcr(t)).length
      if (found(text) < 3) {
        const straightened = await ocr(scan.photo, { straighten: true }).catch(() => '')
        if (found(straightened) > found(text)) text = straightened
      }
      await patchScan(id, (s) => ({ ...s, ocrText: text, ocrStatus: 'done', fields: mergeFields(s.fields, parseOcr(text)) }))
    } catch (err) {
      console.error('OCR failed', err)
      await patchScan(id, (s) => ({ ...s, ocrStatus: 'error' }))
    }
    onDone()
  }
  running = false
}
