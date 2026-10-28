import { useState } from 'react'
import { putOrders, type Order } from '../db'
import { parseOrderLines } from '../orders'
import { Sheet } from '../ui'

const EXAMPLE = `586812466702616208 | alfin | 18 Pro Max Burgundy
586718537521857978 | Nandito Geri Ragil | 18 Pro Max Silver 256GB`

export function ImportOrders({ orders, onDone, onClose }: { orders: Order[]; onDone: (count: number) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const parsed = parseOrderLines(text)
  const valid = parsed.filter((p) => p.order)
  const errors = parsed.filter((p) => p.error)
  const existing = new Map(orders.map((o) => [o.invoice, o]))
  const updates = valid.filter((p) => existing.has(p.order!.invoice)).length

  async function save() {
    setSaving(true)
    const now = Date.now()
    // Later lines win when the same invoice is pasted twice; re-imports keep the original order date.
    const byInvoice = new Map(valid.map((p, i) => [p.order!.invoice, { ...p.order!, createdAt: existing.get(p.order!.invoice)?.createdAt ?? now + i }]))
    await putOrders([...byInvoice.values()])
    onDone(byInvoice.size)
  }

  return (
    <Sheet title="Import orders" subtitle="One order per line: invoice | name | product" onClose={onClose}>
      <textarea
        className="paste"
        placeholder={EXAMPLE}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        autoFocus
        spellCheck={false}
      />
      {parsed.length > 0 && (
        <div className="card pad import-summary">
          <span><b>{valid.length}</b> orders ready{updates > 0 && <span className="muted"> ({updates} already in the list will be updated)</span>}</span>
          {errors.length > 0 && (
            <ul className="errors">
              {errors.map((e) => <li key={e.line}>Line {e.line}: {e.error}</li>)}
            </ul>
          )}
        </div>
      )}
      <button className="btn primary big" disabled={!valid.length || saving} onClick={() => void save()}>
        {valid.length ? `Add ${valid.length} orders` : 'Paste orders above'}
      </button>
      <p className="muted small">Columns copied from a spreadsheet (tab separated) work too. Pickups already made are kept.</p>
    </Sheet>
  )
}
