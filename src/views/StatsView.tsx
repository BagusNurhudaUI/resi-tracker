import type { Fields, Scan } from '../db'
import { FIELD_LABELS, isToday } from '../lib'

const DAY = 24 * 60 * 60 * 1000

function Bars({ items, unit = '', max = Math.max(1, ...items.map((i) => i.value)) }: {
  items: { label: string; value: number }[]
  unit?: string
  max?: number
}) {
  if (!items.length) return <p className="empty">No data yet.</p>
  return (
    <ul className="bars">
      {items.map((i) => (
        <li key={i.label} title={`${i.label}: ${i.value}${unit}`}>
          <span className="bar-label">{i.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(i.value / max) * 100}%` }} /></span>
          <span className="bar-value">{i.value}{unit}</span>
        </li>
      ))}
    </ul>
  )
}

function countBy(scans: Scan[], key: keyof Fields) {
  const counts = new Map<string, number>()
  for (const s of scans) {
    const v = s.fields[key] ?? 'Unknown'
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const sorted = [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  // Long tails fold into "Other" so the list stays short.
  if (sorted.length <= 6) return sorted
  return [...sorted.slice(0, 5), { label: 'Other', value: sorted.slice(5).reduce((n, i) => n + i.value, 0) }]
}

export function StatsView({ scans, dupes }: { scans: Scan[]; dupes: Set<string> }) {
  const start = new Date().setHours(0, 0, 0, 0)
  const week = scans.filter((s) => s.createdAt >= start - 6 * DAY).length

  const days = Array.from({ length: 7 }, (_, i) => {
    const from = start - (6 - i) * DAY
    return {
      label: i === 6 ? 'Today' : new Date(from).toLocaleDateString([], { weekday: 'short', day: 'numeric' }),
      value: scans.filter((s) => s.createdAt >= from && s.createdAt < from + DAY).length,
    }
  })
  const dayMax = Math.max(1, ...days.map((d) => d.value))

  const completeness = FIELD_LABELS.filter(([k]) => ['product', 'serial', 'imei1', 'imei2', 'eid', 'upc'].includes(k)).map(([k, label]) => ({
    label,
    value: scans.length ? Math.round((scans.filter((s) => s.fields[k]).length / scans.length) * 100) : 0,
  }))

  return (
    <div className="page page-top">
      <div className="page-head"><h1>Statistics</h1></div>

      <div className="tiles">
        <div className="card tile"><span>Total</span><b>{scans.length}</b></div>
        <div className="card tile"><span>Today</span><b>{scans.filter((s) => isToday(s.createdAt)).length}</b></div>
        <div className="card tile"><span>Last 7 days</span><b>{week}</b></div>
        <div className="card tile"><span>Duplicates</span><b>{dupes.size}</b></div>
      </div>

      <section className="card pad">
        <h3 className="card-title">Scans per day</h3>
        <div className="columns" role="img" aria-label={days.map((d) => `${d.label}: ${d.value}`).join(', ')}>
          {days.map((d) => (
            <div key={d.label} className="col" title={`${d.label}: ${d.value} scans`}>
              <span className="col-value">{d.value || ''}</span>
              <span className="col-bar" style={{ height: `${(d.value / dayMax) * 100}%` }} />
              <span className="col-label">{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card pad">
        <h3 className="card-title">By product</h3>
        <Bars items={countBy(scans, 'product')} />
      </section>

      <div className="two-col">
        <section className="card pad">
          <h3 className="card-title">By color</h3>
          <Bars items={countBy(scans, 'color')} />
        </section>
        <section className="card pad">
          <h3 className="card-title">By capacity</h3>
          <Bars items={countBy(scans, 'capacity')} />
        </section>
      </div>

      <section className="card pad">
        <h3 className="card-title">Fields captured</h3>
        <p className="muted small">Share of scans where each field was read.</p>
        <Bars items={completeness} unit="%" max={100} />
      </section>
    </div>
  )
}
