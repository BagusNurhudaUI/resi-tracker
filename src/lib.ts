import { useEffect, useState } from 'react'
import type { Fields, Scan } from './db'

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

export function exportCsv(scans: Scan[]) {
  // ="…" keeps long numbers like IMEI/EID from turning into 3.56E+14 in Excel and Sheets.
  const cell = (v = '') => (/^\d{10,}$/.test(v) ? `"=""${v}"""` : `"${v.replace(/"/g, '""')}"`)
  const header = ['Scanned at', ...FIELD_LABELS.map(([, l]) => l), 'Barcodes', 'OCR text']
  const rows = scans.map((s) => [
    cell(fmtDateTime(s.createdAt)),
    ...FIELD_LABELS.map(([k]) => cell(s.fields[k])),
    cell(s.barcodes.map((b) => `${b.format}:${b.text}`).join(' | ')),
    cell(s.ocrText ?? ''),
  ])
  const csv = [header.map((h) => cell(h)), ...rows].map((r) => r.join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `resi-scans-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
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
