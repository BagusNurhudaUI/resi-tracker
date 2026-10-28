import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { createWorker, type Worker } from 'tesseract.js'
import { getScan, putScan, type Barcode, type Scan } from './db'
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

function drawScaled(bitmap: ImageBitmap, max: number) {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality),
  )

async function decode(canvas: HTMLCanvasElement) {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  return readBarcodes(data, {
    formats: ['Code128', 'UPCA', 'EAN13', 'QRCode', 'DataMatrix'],
    tryHarder: true,
    maxNumberOfSymbols: 20,
  })
}

export async function scanPhoto(file: Blob): Promise<Scan> {
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
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      photo,
      thumb,
      barcodes,
      fields: classifyBarcodes(results),
      ocrText: null,
      ocrStatus: 'pending',
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

const queue: string[] = []
let running = false

/** OCR runs in the background, one photo at a time; `onDone` fires after each record is updated. */
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
      const worker = await getWorker()
      const { data } = await worker.recognize(scan.photo)
      await putScan({
        ...scan,
        ocrText: data.text,
        ocrStatus: 'done',
        fields: mergeFields(scan.fields, parseOcr(data.text)),
      })
    } catch (err) {
      console.error('OCR failed', err)
      await putScan({ ...scan, ocrStatus: 'error' })
    }
    onDone()
  }
  running = false
}
