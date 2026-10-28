import { openDB, type DBSchema } from 'idb'

export interface Fields {
  product?: string
  color?: string
  capacity?: string
  partNo?: string
  model?: string
  serial?: string
  imei1?: string
  imei2?: string
  eid?: string
  upc?: string
}

export interface Barcode {
  format: string
  text: string
}

export type OcrStatus = 'pending' | 'done' | 'error'

export interface Scan {
  id: string
  createdAt: number
  photo: Blob
  thumb: Blob
  barcodes: Barcode[]
  fields: Fields
  ocrText: string | null
  ocrStatus: OcrStatus
}

interface ResiDB extends DBSchema {
  scans: { key: string; value: Scan; indexes: { createdAt: number } }
}

const dbPromise = openDB<ResiDB>('resi-tracker', 1, {
  upgrade(db) {
    db.createObjectStore('scans', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
  },
})

export async function listScans(): Promise<Scan[]> {
  const all = await (await dbPromise).getAllFromIndex('scans', 'createdAt')
  return all.reverse()
}

export async function getScan(id: string) {
  return (await dbPromise).get('scans', id)
}

export async function putScan(scan: Scan) {
  await (await dbPromise).put('scans', scan)
}

export async function deleteScan(id: string) {
  await (await dbPromise).delete('scans', id)
}
