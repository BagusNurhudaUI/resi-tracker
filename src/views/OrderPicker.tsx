import { useState } from 'react'
import type { Order, Scan } from '../db'
import { Icon } from '../icons'

export function OrderPicker({ orders, picked, onPick, onCancel }: {
  orders: Order[]
  picked: Map<string, Scan>
  onPick: (order: Order) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = orders
    .filter((o) => !q || [o.invoice, o.name, o.product].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => Number(picked.has(a.invoice)) - Number(picked.has(b.invoice)))

  return (
    <>
      <label className="searchbar">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Search name, invoice, product…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </label>
      <div className="card list">
        {shown.map((o) => (
          <button key={o.invoice} className="row" onClick={() => onPick(o)}>
            <span className="row-main">
              <span className="row-title">{o.name}</span>
              <span className="row-sub">{o.product} · <span className="mono">{o.invoice}</span></span>
            </span>
            {picked.has(o.invoice) ? <span className="pill">picked</span> : <Icon name="chevronRight" size={18} />}
          </button>
        ))}
        {!shown.length && <p className="empty">{orders.length ? 'No orders match.' : 'No orders imported yet.'}</p>}
      </div>
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
    </>
  )
}
