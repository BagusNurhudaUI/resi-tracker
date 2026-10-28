import { useEffect, useState } from 'react'
import type { Fields, Order, Scan } from './db'
import { nameCheck, productCheck } from './orders'

export const FIELD_LABELS: [keyof Fields, string][] = [
  ['product', 'Product'],
  ['color', 'Color'],
  ['capacity', 'Capacity'],
  ['partNo', 'Part no.'],
  ['model', 'Model'],
  ['serial', 'Serial'],
  ['imei1', 'IMEI 1'],
  ['imei2', 'IMEI 2'],
  ['eid', 'EID'],
  ['upc', 'UPC'],
]

export const scanTitle = (s: Scan) =>
  [s.fields.product, s.fields.capacity].filter(Boolean).join(' ') || s.fields.serial || 'Unknown item'

export const isToday = (t: number) => new Date(t).toDateString() === new Date().toDateString()

export const fmtTime = (t: number) =>
  isToday(t)
    ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' })

export const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Ids of scans whose serial or IMEI 1 also appears on another scan. */
export function duplicateIds(scans: Scan[]) {
  const seen = new Map<string, string[]>()
  for (const s of scans) {
    for (const key of new Set([s.fields.serial, s.fields.imei1].filter(Boolean) as string[])) {
      seen.set(key, [...(seen.get(key) ?? []), s.id])
    }
  }
  return new Set([...seen.values()].filter((ids) => ids.length > 1).flat())
}

export function matchesQuery(s: Scan, q: string) {
  if (!q) return true
  const hay = [...Object.values(s.fields), ...s.barcodes.map((b) => b.text), s.ocrText ?? '']
  return hay.some((v) => v?.toLowerCase().includes(q))
}

function downloadCsv(name: string, header: string[], rows: (string | undefined)[][]) {
  // ="…" keeps long numbers like IMEI/EID/invoice from turning into 3.56E+14 in Excel and Sheets.
  const cell = (v = '') => (/^\d{10,}$/.test(v) ? `"=""${v}"""` : `"${v.replace(/"/g, '""')}"`)
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function exportCsv(scans: Scan[]) {
  downloadCsv(
    'resi-scans',
    ['Scanned at', 'Order invoice', ...FIELD_LABELS.map(([, l]) => l), 'Barcodes', 'OCR text'],
    scans.map((s) => [
      fmtDateTime(s.createdAt),
      s.orderId,
      ...FIELD_LABELS.map(([k]) => s.fields[k]),
      s.barcodes.map((b) => `${b.format}:${b.text}`).join(' | '),
      s.ocrText ?? '',
    ]),
  )
}

const CHECK_TEXT = { ok: 'OK', partial: 'Partial', fail: 'Mismatch', pending: '' }

export function exportOrdersCsv(orders: Order[], picked: Map<string, Scan>, outside: Scan[]) {
  const rows = orders.map((o) => {
    const s = picked.get(o.invoice)
    return [
      o.invoice, o.name, o.product, s ? 'Picked' : 'Not picked',
      s?.fields.imei1, s?.fields.imei2, s?.fields.serial,
      s && [s.fields.product, s.fields.color, s.fields.capacity].filter(Boolean).join(' '),
      s && fmtDateTime(s.createdAt),
      s?.invoice?.text != null ? CHECK_TEXT[nameCheck(o.name, s.invoice.text, s.invoice.recipient).status] : '',
      s ? CHECK_TEXT[productCheck(o.product, s.fields).status] : '',
      s?.invoice?.recipient, s?.invoice?.sender, s?.invoice?.marketplace,
    ]
  })
  const extra = outside.map((s) => [
    s.invoice?.number ?? '', s.invoice?.recipient ?? '', '', 'Outside orders',
    s.fields.imei1, s.fields.imei2, s.fields.serial,
    [s.fields.product, s.fields.color, s.fields.capacity].filter(Boolean).join(' '),
    fmtDateTime(s.createdAt), '', '',
    s.invoice?.recipient, s.invoice?.sender, s.invoice?.marketplace,
  ])
  downloadCsv(
    'resi-orders',
    ['Invoice', 'Name', 'Product', 'Status', 'IMEI 1', 'IMEI 2', 'Serial', 'Box product', 'Picked at', 'Name check', 'Product check', 'Penerima (label)', 'Pengirim', 'Marketplace'],
    [...rows, ...extra],
  )
}

export function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
