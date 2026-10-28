import { useState } from 'react'
import type { Order, Scan } from '../db'
import { Icon } from '../icons'
import { fmtTime, scanTitle } from '../lib'
import { nameCheck, productCheck } from '../orders'
import { Progress } from '../ui'

export type OrderFilter = 'all' | 'open' | 'picked' | 'check' | 'outside'

const FILTERS: [OrderFilter, string][] = [
  ['all', 'All'],
  ['open', 'Not picked'],
  ['picked', 'Picked'],
  ['check', 'Needs check'],
  ['outside', 'Outside orders'],
]

/** A picked order needs a second look when the name, product or IMEI doesn't line up. */
export function orderIssues(order: Order, scan: Scan | undefined, dupes: Set<string>) {
  if (!scan) return []
  const issues: string[] = []
  if (scan.invoice?.text != null && nameCheck(order.name, scan.invoice.text, scan.invoice.recipient).status !== 'ok') issues.push('name')
  if (productCheck(order.product, scan.fields).status === 'fail') issues.push('product')
  if (!scan.fields.imei1 && scan.ocrStatus !== 'pending') issues.push('no IMEI')
  if (dupes.has(scan.id)) issues.push('duplicate')
  return issues
}

interface Props {
  orders: Order[]
  picked: Map<string, Scan>
  outside: Scan[]
  dupes: Set<string>
  initialFilter: OrderFilter
  onOpenOrder: (invoice: string) => void
  onOpenScan: (id: string) => void
  onImport: () => void
  onExport: () => void
}

export function OrdersView({ orders, picked, outside, dupes, initialFilter, onOpenOrder, onOpenScan, onImport, onExport }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<OrderFilter>(initialFilter)
  const q = query.trim().toLowerCase()

  const rows = orders
    .map((o) => ({ order: o, scan: picked.get(o.invoice), issues: orderIssues(o, picked.get(o.invoice), dupes) }))
    .filter(({ scan, issues }) =>
      filter === 'open' ? !scan : filter === 'picked' ? !!scan : filter === 'check' ? issues.length > 0 : true)
    .filter(({ order, scan }) =>
      !q || [order.invoice, order.name, order.product, scan?.fields.imei1, scan?.fields.serial].some((v) => v?.toLowerCase().includes(q)))
    // Not-picked orders first so the pickup list reads top-down; then by import order.
    .sort((a, b) => Number(!!a.scan) - Number(!!b.scan) || a.order.createdAt - b.order.createdAt)

  const outsideRows = outside.filter((s) =>
    !q || [s.invoice?.number, s.invoice?.recipient, ...Object.values(s.fields)].some((v) => v?.toLowerCase().includes(q)))

  const count = (f: OrderFilter) =>
    f === 'outside' ? outside.length
    : f === 'open' ? orders.length - picked.size
    : f === 'picked' ? picked.size
    : f === 'check' ? orders.filter((o) => orderIssues(o, picked.get(o.invoice), dupes).length).length
    : orders.length

  return (
    <div className="page page-top">
      <div className="page-head">
        <h1>Orders</h1>
        <span className="head-actions">
          <button className="chip-btn ghost" onClick={onImport}><Icon name="plus" size={16} /> Import</button>
          <button className="chip-btn" disabled={!orders.length && !outside.length} onClick={onExport}><Icon name="download" size={16} /> Export</button>
        </span>
      </div>

      {orders.length > 0 && (
        <div className="card pad progress-card">
          <div className="progress-head">
            <span><b>{picked.size}</b> of {orders.length} picked</span>
            <span className="muted small">{orders.length - picked.size} left · {outside.length} outside</span>
          </div>
          <Progress value={picked.size} max={orders.length} />
        </div>
      )}

      <label className="searchbar">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Name, invoice, product, IMEI…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <button aria-label="Clear" onClick={() => setQuery('')}><Icon name="x" size={16} /></button>}
      </label>

      <div className="chips">
        {FILTERS.map(([key, label]) => (
          <button key={key} className={`chip${filter === key ? ' on' : ''}`} onClick={() => setFilter(key)}>
            {label} <span className="chip-count">{count(key)}</span>
          </button>
        ))}
      </div>

      {filter === 'outside' ? (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Invoice read</th><th>Recipient</th><th>Product</th><th>IMEI 1</th><th>Serial</th><th>Sender</th></tr></thead>
            <tbody>
              {outsideRows.map((s) => (
                <tr key={s.id} onClick={() => onOpenScan(s.id)}>
                  <td>{fmtTime(s.createdAt)}</td>
                  <td className="mono">{s.invoice?.number ?? <span className="muted">–</span>}</td>
                  <td>{s.invoice?.recipient ?? <span className="muted">–</span>}</td>
                  <td>{s.fields.product ? `${scanTitle(s)} ${s.fields.color ?? ''}` : <span className="muted">–</span>}</td>
                  <td className="mono">{s.fields.imei1 ?? <span className="muted">–</span>}</td>
                  <td className="mono">{s.fields.serial ?? <span className="muted">–</span>}</td>
                  <td>{[s.invoice?.sender, s.invoice?.marketplace].filter(Boolean).join(' · ') || <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!outsideRows.length && <p className="empty">No boxes outside your orders.</p>}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Product</th><th>IMEI 1</th><th>Invoice</th><th>Picked</th></tr></thead>
            <tbody>
              {rows.map(({ order, scan, issues }) => (
                <tr key={order.invoice} onClick={() => onOpenOrder(order.invoice)}>
                  <td>
                    <span className={`status-dot ${issues.length ? 'warn' : scan ? 'ok' : ''}`} title={issues.length ? `Check: ${issues.join(', ')}` : scan ? 'Picked' : 'Not picked'} />
                    {order.name}
                  </td>
                  <td>{order.product}</td>
                  <td className="mono">{scan?.fields.imei1 ?? (scan?.ocrStatus === 'pending' ? <span className="muted">reading…</span> : <span className="muted">–</span>)}</td>
                  <td className="mono">{order.invoice}</td>
                  <td>{scan ? fmtTime(scan.createdAt) : <span className="muted">–</span>}{issues.length > 0 && <span className="pill warn">{issues[0]}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="empty">
              {orders.length ? 'No orders match.' : <>No orders yet.<br /><button className="link" onClick={onImport}>Import your order list</button></>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
