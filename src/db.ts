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

/** How the invoice photo taken before a box scan was tied to an order. */
export type MatchedBy = 'invoice' | 'name' | 'manual' | 'none'

export interface InvoiceInfo {
  number?: string
  recipient?: string
  sender?: string
  marketplace?: string
  text?: string
  photo?: Blob
  matchedBy: MatchedBy
}

export interface Scan {
  id: string
  createdAt: number
  photo: Blob
  thumb: Blob
  barcodes: Barcode[]
  fields: Fields
  ocrText: string | null
  ocrStatus: OcrStatus
  /** Invoice number of the order this box was picked for; missing means outside any order. */
  orderId?: string
  invoice?: InvoiceInfo
}

export interface Order {
  invoice: string
  name: string
  product: string
  createdAt: number
}

interface ResiDB extends DBSchema {
  scans: { key: string; value: Scan; indexes: { createdAt: number } }
  orders: { key: string; value: Order; indexes: { createdAt: number } }
}

const dbPromise = openDB<ResiDB>('resi-tracker', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) db.createObjectStore('scans', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
    if (oldVersion < 2) db.createObjectStore('orders', { keyPath: 'invoice' }).createIndex('createdAt', 'createdAt')
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

/** Read-modify-write so background OCR and order linking don't overwrite each other. */
export async function patchScan(id: string, patch: (s: Scan) => Scan) {
  const tx = (await dbPromise).transaction('scans', 'readwrite')
  const scan = await tx.store.get(id)
  if (scan) await tx.store.put(patch(scan))
  await tx.done
}

export async function deleteScan(id: string) {
  await (await dbPromise).delete('scans', id)
}

export async function clearScans() {
  await (await dbPromise).clear('scans')
}

export async function listOrders(): Promise<Order[]> {
  return (await dbPromise).getAllFromIndex('orders', 'createdAt')
}

export async function putOrders(orders: Order[]) {
  const tx = (await dbPromise).transaction('orders', 'readwrite')
  await Promise.all([...orders.map((o) => tx.store.put(o)), tx.done])
}

export async function deleteOrder(invoice: string) {
  await (await dbPromise).delete('orders', invoice)
}

export async function clearOrders() {
  await (await dbPromise).clear('orders')
}
