import type { ReadResult } from 'zxing-wasm/reader'
import type { Fields } from './db'

function luhn(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

const isImei = (s: string) => /^\d{15}$/.test(s) && luhn(s)

export function classifyBarcodes(results: ReadResult[]): Fields {
  const fields: Fields = {}
  const imeis: { text: string; x: number; y: number }[] = []

  for (const r of results) {
    const text = r.text.trim()
    if (r.format === 'UPCA' || r.format === 'EAN13') fields.upc ??= text
    else if (/^\d{32}$/.test(text)) fields.eid ??= text
    else if (isImei(text)) imeis.push({ text, x: r.position.topLeft.x, y: r.position.topLeft.y })
    else if (/^(1P)?[A-Z0-9]{4,7}[A-Z]{1,2}\/A$/.test(text)) fields.partNo ??= text.replace(/^1P/, '')
    else if (/^[A-Z0-9]{10,13}$/.test(text) && /[A-Z]/.test(text)) {
      // Apple serial barcodes carry an "S" prefix in front of a 10 or 12 char serial.
      fields.serial ??= /^S/.test(text) && (text.length === 11 || text.length === 13) ? text.slice(1) : text
    }
  }

  // Without OCR we can't read the "IMEI2" caption, so assume IMEI1 is the left-most (then top-most) one.
  imeis.sort((a, b) => a.x - b.x || a.y - b.y)
  if (imeis[0]) fields.imei1 = imeis[0].text
  if (imeis[1]) fields.imei2 = imeis[1].text
  return fields
}

export function parseOcr(text: string): Fields {
  const f: Fields = {}
  const flat = text.replace(/[ \t]+/g, ' ')

  // OCR often splits long numbers with stray spaces, so allow one after any digit.
  const digits = (re: RegExp) => flat.match(re)?.[1].replace(/ /g, '')

  const eid = digits(/EID ?:? ?((?:\d ?){32})/i)
  if (eid) f.eid = eid

  const imei2 = digits(/IMEI ?2 ?:? ?((?:\d ?){15})/i)
  if (imei2 && isImei(imei2)) f.imei2 = imei2
  const imei1 = digits(/IMEI ?\/? ?MEID ?:? ?((?:\d ?){15})/i)
  if (imei1 && isImei(imei1)) f.imei1 = imei1

  const serial = flat.match(/Serial\s*No\.?\s*:?\s*([A-Z0-9]{10,12})\b/i)
  if (serial) f.serial = serial[1].toUpperCase()

  const model = flat.match(/Model\s*:?\s*(A\d{4})/i)
  if (model) f.model = model[1]

  // e.g. "MJXQ4SA/A iPhone 18 Pro Max, Burgundy, 256GB Model A3717"
  const line = flat.match(/\b([A-Z0-9]{4,7}[A-Z]{1,2}\/A)\s+([^\n]+)/)
  if (line) {
    f.partNo = line[1]
    const [product, color, capacity] = line[2]
      .replace(/\s*Model\s*A\d{4}.*$/i, '')
      .split(',')
      .map((s) => s.trim())
    if (product) f.product = product
    if (color) f.color = color
    if (capacity) f.capacity = capacity
  } else {
    const name = flat.match(/Nama Barang\s*:?\s*([^\n]+)/i)
    if (name) f.product = name[1].trim()
  }
  return f
}

/** Merge OCR fields under barcode fields; the IMEI captions from OCR decide which IMEI is which. */
export function mergeFields(barcode: Fields, ocr: Fields): Fields {
  const merged: Fields = { ...ocr, ...barcode }
  const imeis = [barcode.imei1, barcode.imei2].filter(Boolean)
  if (ocr.imei2 && imeis.includes(ocr.imei2)) {
    merged.imei2 = ocr.imei2
    merged.imei1 = imeis.find((i) => i !== ocr.imei2) ?? ocr.imei1
  }
  return merged
}
