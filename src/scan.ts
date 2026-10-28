import { prepareZXingModule, readBarcodes, type Position, type ReaderOptions, type ReadResult } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { createWorker, PSM, type Worker } from 'tesseract.js'
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
// Invoice text (the recipient line) is small; Tesseract reads it far better once it is enlarged.
const INVOICE_OCR_SIZE = 3200

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

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality),
  )

type Format = NonNullable<ReaderOptions['formats']>[number]
const BOX_FORMATS: Format[] = ['Code128', 'UPCA', 'EAN13', 'QRCode', 'DataMatrix']
const INVOICE_FORMATS: Format[] = ['Code128', 'Code39', 'ITF', 'EAN13', 'QRCode', 'DataMatrix', 'PDF417']

async function decode(canvas: HTMLCanvasElement, formats = BOX_FORMATS) {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  return readBarcodes(data, { formats, tryHarder: true, maxNumberOfSymbols: 20 })
}

// The strip under the invoice barcode, in barcode widths: across from just left of the bars to just
// right of them, and down from below the bars past the big invoice number and the
// "Penerima | Pengirim / Marketplace" box.
const STRIP = { left: -0.25, right: 1.35, top: 0.06, bottom: 0.4 }
const STRIP_WIDTH = 1800

/**
 * Cuts out the strip below a barcode, straightened along the barcode's angle and enlarged so the
 * small recipient text is easy for OCR. Returns null when the barcode is too small to measure.
 */
function stripBelowBarcode(bitmap: ImageBitmap, pos: Position, scale: number) {
  const pt = (p: { x: number; y: number }) => ({ x: p.x * scale, y: p.y * scale })
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const left = mid(pt(pos.topLeft), pt(pos.bottomLeft))
  const right = mid(pt(pos.topRight), pt(pos.bottomRight))
  const w = Math.hypot(right.x - left.x, right.y - left.y)
  if (w < 60) return null

  const u = { x: (right.x - left.x) / w, y: (right.y - left.y) / w } // along the bars
  const v = { x: -u.y, y: u.x } // "down" on the label
  const o = {
    x: left.x + (u.x * STRIP.left + v.x * STRIP.top) * w,
    y: left.y + (u.y * STRIP.left + v.y * STRIP.top) * w,
  }
  const s = STRIP_WIDTH / ((STRIP.right - STRIP.left) * w)

  const canvas = document.createElement('canvas')
  canvas.width = STRIP_WIDTH
  canvas.height = Math.round((STRIP.bottom - STRIP.top) * w * s)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // Maps photo pixels into the strip: x along u, y along v, both measured from o.
  ctx.setTransform(s * u.x, s * v.x, s * u.y, s * v.y, -s * (o.x * u.x + o.y * u.y), -s * (o.x * v.x + o.y * v.y))
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0)
  return canvas
}

/** The invoice barcode: a long number if there is one, else the first linear barcode. */
function pickInvoiceBarcode(results: ReadResult[]) {
  const linear = results.filter((r) => !['QRCode', 'DataMatrix', 'PDF417'].includes(r.format))
  return linear.find((r) => /^\d{12,24}$/.test(r.text.trim())) ?? linear[0]
}

/**
 * Reads the invoice barcodes right away. The text is read separately with `ocr(ocrImage)` because
 * it's slower: `ocrImage` is just the strip with the invoice number, recipient and sender when the
 * barcode was found (`fromStrip`), else the whole photo enlarged. `photo` is the copy that gets stored.
 */
export async function readInvoice(file: Blob) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const decodeCanvas = drawScaled(bitmap, DECODE_MAX)
    const results = await decode(decodeCanvas, INVOICE_FORMATS)
    const barcode = pickInvoiceBarcode(results)
    const strip = barcode && stripBelowBarcode(bitmap, barcode.position, bitmap.width / decodeCanvas.width)
    const [photo, ocrImage] = await Promise.all([
      toJpeg(drawScaled(bitmap, PHOTO_MAX), 0.85),
      toJpeg(strip ?? drawScaled(bitmap, INVOICE_OCR_SIZE, true), 0.92),
    ])
    return { photo, ocrImage, fromStrip: !!strip, barcodes: results.map((r) => r.text) }
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
 * cells ("Penerima | Pengirim") get merged that way, so invoices use sparse text.
 */
export type OcrLayout = PSM.SINGLE_BLOCK | PSM.SPARSE_TEXT

interface OcrJob {
  image: Blob
  priority: number
  layout: OcrLayout
  resolve: (text: string) => void
  reject: (err: unknown) => void
}

const jobs: OcrJob[] = []
let ocrBusy = false
let currentLayout: OcrLayout = PSM.SINGLE_BLOCK

/** One shared OCR engine; higher priority jobs (invoices someone is waiting on) jump the queue. */
export function ocr(image: Blob, priority = 0, layout: OcrLayout = PSM.SINGLE_BLOCK) {
  return new Promise<string>((resolve, reject) => {
    jobs.push({ image, priority, layout, resolve, reject })
    jobs.sort((a, b) => b.priority - a.priority)
    void pumpOcr()
  })
}

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
      const { data } = await worker.recognize(job.image)
      job.resolve(data.text)
    } catch (err) {
      job.reject(err)
    }
  }
  ocrBusy = false
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
      const text = await ocr(scan.photo)
      await patchScan(id, (s) => ({ ...s, ocrText: text, ocrStatus: 'done', fields: mergeFields(s.fields, parseOcr(text)) }))
    } catch (err) {
      console.error('OCR failed', err)
      await patchScan(id, (s) => ({ ...s, ocrStatus: 'error' }))
    }
    onDone()
  }
  running = false
}
