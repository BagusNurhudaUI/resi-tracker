import type { InvoiceInfo, Order } from './db'
import { detectInvoiceNumber, findOrderByNumber, labelParts, nameCheck } from './orders'
import { readInvoice } from './scan'

/**
 * Reads an invoice photo completely (barcodes and the recipient strip) and finds its order.
 * Used when an invoice is added to a box after the fact; the pickup flow has its own faster path.
 */
export async function readInvoiceForOrder(file: Blob, orders: Order[]) {
  const { photo, barcodes, details } = await readInvoice(file)
  const { text } = await details.catch(() => ({ text: '' }))
  const hit = findOrderByNumber(orders, [...barcodes, text])
  const invoice: InvoiceInfo = {
    ...labelParts(text),
    photo,
    number: hit?.order.invoice ?? detectInvoiceNumber(barcodes, text),
    matchedBy: hit ? 'invoice' : 'none',
  }
  return { order: hit?.order, exact: hit?.exact, invoice }
}

export const invoiceNameCheck = (order: Order, invoice: InvoiceInfo) =>
  nameCheck(order.name, invoice.text, invoice.recipient).status
