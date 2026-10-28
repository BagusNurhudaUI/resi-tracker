import type { Fields, Order, Scan } from './db'
import { normalizeCapacity } from './parse'

export interface ParsedLine {
  line: number
  order?: Omit<Order, 'createdAt'>
  error?: string
}

/** Parses pasted lines of `invoice | name | product`. Tabs work too, so columns copied from a spreadsheet paste fine. */
export function parseOrderLines(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: raw.trim(), line: i + 1 }))
    .filter(({ raw }) => raw)
    .map(({ raw, line }) => {
      const parts = raw.split(/\s*[|\t]\s*/)
      if (parts.length < 3) return { line, error: 'Needs 3 parts: invoice | name | product' }
      const invoice = parts[0].replace(/\s/g, '')
      if (!/^[A-Za-z0-9-]{6,}$/.test(invoice)) return { line, error: `"${parts[0]}" doesn't look like an invoice number` }
      const name = parts[1]
      const product = parts.slice(2).join(' ').trim()
      if (!name || !product) return { line, error: 'Name or product is empty' }
      return { line, order: { invoice, name, product } }
    })
}

/** OCR confuses look-alike characters inside numbers; fold them to digits before searching. */
const digitize = (s: string) =>
  s.toUpperCase().replace(/[OQD]/g, '0').replace(/[IL|!]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8').replace(/G/g, '6').replace(/[^0-9A-Z]/g, '')

function hamming(a: string, b: string) {
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

/**
 * Finds the order whose invoice number appears in the barcodes or label text.
 * Barcodes and exact text matches win; otherwise one or two misread digits are tolerated in long numbers.
 */
export function findOrderByNumber(orders: Order[], sources: string[]): { order: Order; exact: boolean } | undefined {
  const plain = sources.map((s) => s.replace(/\s/g, '').toUpperCase())
  for (const o of orders) if (plain.some((s) => s.includes(o.invoice.toUpperCase()))) return { order: o, exact: true }

  const folded = sources.map(digitize)
  for (const o of orders) if (folded.some((s) => s.includes(digitize(o.invoice)))) return { order: o, exact: true }

  let best: { order: Order; dist: number } | undefined
  for (const o of orders) {
    const inv = digitize(o.invoice)
    if (inv.length < 12) continue
    for (const s of folded) {
      for (let i = 0; i + inv.length <= s.length; i++) {
        const d = hamming(inv, s.slice(i, i + inv.length))
        if (d <= 2 && (!best || d < best.dist)) best = { order: o, dist: d }
      }
    }
  }
  return best && { order: best.order, exact: false }
}

/** Best guess at the invoice number on a label that matched no order, for the "outside orders" list. */
export function detectInvoiceNumber(barcodes: string[], text = '') {
  const fromBarcode = barcodes.map((b) => b.trim()).find((b) => /^\d{12,24}$/.test(b))
  if (fromBarcode) return fromBarcode
  return text.replace(/(\d) (?=\d)/g, '$1').match(/\b\d{14,24}\b/)?.[0]
}

// The box under the invoice number reads "Penerima: … | Pengirim: … / Marketplace: …"; each value
// stops where the next label (or the cell border OCR sees as "|") starts.
const LABEL_END = String.raw`(?=\s*(?:Penerima|Pengirim|Marketplace|Alamat|No\.?\s*HP|Telp|[|\[\]]|\n|$))`
const field = (text: string, label: string) =>
  text.match(new RegExp(String.raw`${label}\s*[:;.]?\s*(.+?)` + LABEL_END, 'i'))?.[1].replace(/[^\p{L}\p{N}\s.'*&-]/gu, '').trim() || undefined

/** Recipient from "Penerima: <name>". */
export const detectRecipient = (text: string) => field(text, 'Penerima')
/** Seller from "Pengirim: <name>". */
export const detectSender = (text: string) => field(text, 'Pengirim')
/** Marketplace from "Marketplace: <name>". */
export const detectMarketplace = (text: string) => field(text, 'Marketplace')

/** Everything read from the strip under the invoice number. */
export const labelParts = (text: string) => ({
  text,
  recipient: detectRecipient(text),
  sender: detectSender(text),
  marketplace: detectMarketplace(text),
})

const words = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}*\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 2)

function similarity(a: string, b: string) {
  if (a === b) return 1
  // Marketplaces often mask names ("a***n"); compare the visible ends.
  if (b.includes('*')) {
    const re = new RegExp('^' + b.replace(/\*+/g, '.*') + '$')
    return re.test(a) ? 0.9 : 0
  }
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length)
}

/**
 * How well an order's name matches the label: 0..1. Each word of the order name is compared with
 * the closest word on the label (the recipient field when found, else all text), so typos,
 * extra surnames and nicknames that are a prefix ("alfin" vs "Alfin Pratama") still match.
 */
export function nameScore(orderName: string, labelText: string, recipient?: string) {
  const want = words(orderName)
  const have = words(recipient || labelText)
  if (!want.length || !have.length) return 0
  const scores = want.map((w) => Math.max(...have.map((h) => similarity(w, h))))
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

export type CheckStatus = 'ok' | 'partial' | 'fail' | 'pending'

export function nameCheck(orderName: string, labelText: string | undefined, recipient?: string): { status: CheckStatus; score: number } {
  if (labelText == null) return { status: 'pending', score: 0 }
  const score = nameScore(orderName, labelText, recipient)
  return { status: score >= 0.8 ? 'ok' : score >= 0.55 ? 'partial' : 'fail', score }
}

/** Open orders whose name clearly matches the label, best first. */
export function suggestByName(orders: Order[], labelText: string, recipient?: string) {
  return orders
    .map((order) => ({ order, score: nameScore(order.name, labelText, recipient) }))
    .filter((s) => s.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

const MODEL_WORDS = new Set(['pro', 'max', 'plus', 'mini', 'air', 'ultra', 'e', 'se'])

const productTokens = (s: string) =>
  s.toLowerCase().replace(/(\d+)\s*(gb|tb)\b/g, '$1$2').split(/[^a-z0-9]+/).filter((t) => t && t !== 'iphone' && t !== 'apple')

/**
 * Compares the order's product text with what the box label says. Every word of the order must be on
 * the box, and model words on the box (Pro, Max…) must be in the order, so "18 Pro" ≠ "18 Pro Max".
 */
export function productCheck(orderProduct: string, fields: Fields): { status: CheckStatus; missing: string[] } {
  if (!fields.product) return { status: 'pending', missing: [] }
  const box = new Set(productTokens([fields.product, fields.color, fields.capacity && normalizeCapacity(fields.capacity)].filter(Boolean).join(' ')))
  const want = productTokens(orderProduct)
  const missing = want.filter((t) => !box.has(t))
  const extra = productTokens(fields.product).filter((t) => MODEL_WORDS.has(t) && !want.includes(t))
  return { status: missing.length || extra.length ? 'fail' : 'ok', missing: [...missing, ...extra] }
}

/** Links each order to its picked box (latest scan wins) and lists boxes outside any order. */
export function linkOrders(orders: Order[], scans: Scan[]) {
  const known = new Set(orders.map((o) => o.invoice))
  const picked = new Map<string, Scan>()
  const outside: Scan[] = []
  for (const s of scans) {
    if (s.orderId && known.has(s.orderId) && !picked.has(s.orderId)) picked.set(s.orderId, s)
    else outside.push(s)
  }
  return { picked, outside }
}
