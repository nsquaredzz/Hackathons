import { useEffect, useState } from 'react'
import { liveApi, type Backtest, type LiveOverview, type LiveStorm, type Outlook } from './api'

export const SAT_OPTIONS: [string, string][] = [['infrared', 'Clouds'], ['rain', 'Rain'], ['ocean_wind', 'Ocean wind'], ['true_color', 'True colour'], ['none', 'Off']]
const PLACES: [string, number, number][] = [['Puri', 19.81, 85.83], ['Paradip', 20.32, 86.61], ['Gopalpur', 19.26, 84.91], ['Visakhapatnam', 17.69, 83.22], ['Kolkata', 22.57, 88.36], ['Chennai', 13.08, 80.27]]

const utc = (t: string) => {
  const d = new Date(/Z$|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`)
  return isNaN(d.getTime()) ? t : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' IST'
}
const day = (t: string) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

export function levelStyle(level: Outlook['level']) {
  return {
    clear: { bg: 'rgba(111,211,255,0.1)', border: 'rgba(111,211,255,0.3)', color: '#a5e4ff', label: 'All clear' },
    watch: { bg: 'rgba(255,203,107,0.12)', border: 'rgba(255,203,107,0.4)', color: '#ffd98f', label: 'Watch' },
    danger: { bg: 'rgba(255,107,74,0.16)', border: 'rgba(255,107,74,0.5)', color: '#ffb29c', label: 'Danger' },
  }[level]
}

export function GustBars({ o, light = false }: { o: Outlook; light?: boolean }) {
  const max = Math.max(60, ...o.hourly.gust_kmh)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 54 }} aria-label="Gusts over the next 3 days">
      {o.hourly.gust_kmh.map((g, i) => (
        <span key={i} title={`${o.hourly.time[i]} · ${Math.round(g)} km/h`}
          style={{ flex: 1, height: `${Math.max(4, (100 * g) / max)}%`, borderRadius: 2,
            background: g >= 90 ? '#ff6b4a' : g >= 60 ? '#ffcb6b' : light ? '#8fb8d6' : 'rgba(111,211,255,0.55)' }} />
      ))}
    </div>
  )
}

export function LivePanel(p: {
  ov: LiveOverview | null; error: string | null; sat: string; setSat: (s: string) => void
  onFocus: (lon: number, lat: number) => void
}) {
  const [place, setPlace] = useState<[string, number, number]>(PLACES[0])
  const [outlook, setOutlook] = useState<Outlook | null>(null)
  const [bt, setBt] = useState<Backtest | null>(null)
  useEffect(() => { setOutlook(null); liveApi.outlook(place[1], place[2]).then(setOutlook).catch(() => {}) }, [place])
  useEffect(() => { liveApi.backtest().then(setBt).catch(() => {}) }, [])

  if (p.error) return <aside className="panel right glass"><div className="warn">Live feeds unavailable: {p.error}</div></aside>
  if (!p.ov) return <aside className="panel right glass"><div className="empty">Pulling satellites and wind…</div></aside>
  const ov = p.ov
  const active = ov.storms.active ?? []
  const recent: LiveStorm | undefined = ov.storms.recent?.[0]
  const forming = ov.genesis ?? []
  const status = active.length ? 'storm' : forming.length ? 'forming' : 'calm'
  return (
    <aside className="panel right glass fade-in">
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow row" style={{ gap: 8 }}><span className="dot" style={{ background: '#6fd3ff', boxShadow: '0 0 0 4px rgba(111,211,255,0.2)' }} />Live · Bay of Bengal · {utc(ov.fetched)}</div>
        <h1 className="title">
          {status === 'storm' && <>Cyclone <i>{active[0].name}</i> is active</>}
          {status === 'forming' && <>A low may be <i>forming</i></>}
          {status === 'calm' && <>The Bay is <i className="cool">calm</i></>}
        </h1>
      </div>
      {ov.stale && Object.keys(ov.stale).length > 0 && (
        <div className="warn small">A feed could not refresh, so the last good copy is shown ({Object.entries(ov.stale).map(([k, m]) => `${k}: ${m} min old`).join(', ')}).</div>
      )}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
        <div className="stat cyan" style={{ padding: 12 }}><b style={{ fontSize: 30, lineHeight: '34px' }}>{ov.max_sea_wind_now_kmh}</b><span>km/h, strongest wind over the sea now</span></div>
        <div className="stat" style={{ padding: 12 }}><b style={{ fontSize: 30, lineHeight: '34px' }}>{ov.max_sea_gust_72h_kmh}</b><span>km/h, peak gust next 72 h</span></div>
        <div className={`stat ${ov.sst.fuel === 'high' ? 'severe' : 'amber'}`} style={{ padding: 12 }}><b style={{ fontSize: 30, lineHeight: '34px' }}>{ov.sst.mean_c ?? '—'}°</b><span>sea temperature: {ov.sst.fuel ?? '—'} cyclone fuel</span></div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Cyclones · {ov.storms.source}</div>
        {active.map((s) => (
          <button key={s.id} className="district-btn on" onClick={() => p.onFocus(s.lon, s.lat)}>
            <span className="grow"><b>{s.name}</b><br /><span className="small muted">{s.severity} · {s.countries}</span></span>
            <span className="chip severe">{s.alert}</span>
          </button>
        ))}
        {!active.length && (
          <div className="small muted">No active cyclone in the North Indian Ocean.{recent && <> Last: <button className="chip" style={{ border: 'none', cursor: 'pointer' }} onClick={() => p.onFocus(recent.lon, recent.lat)}>{recent.name} · {day(recent.from)}–{day(recent.to)} · {Math.round(recent.max_wind_kmh)} km/h</button></>}</div>
        )}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Forming lows · pattern check on forecast models</div>
        {forming.length ? forming.slice(0, 3).map((g, i) => (
          <button key={i} className="district-btn" onClick={() => p.onFocus(g.lon, g.lat)}>
            <span className="swatch" style={{ background: '#ffcb6b', borderRadius: 5 }} />
            <span className="grow">Closed low {g.min_pressure_hpa} hPa, winds to {g.max_wind_kmh} km/h · GFS + ECMWF agree<br /><span className="small muted">first appears {utc(g.first_seen)} · {g.lat.toFixed(1)}°N {g.lon.toFixed(1)}°E</span></span>
          </button>
        )) : <div className="small muted">No closed low forming over the sea in the next 3 days. Every 30 min it looks for a low under 1004 hPa with 50+ km/h winds that both GFS and ECMWF show, lasting 12+ hours.</div>}
      </div>

      {bt && <TrackRecord bt={bt} />}

      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Satellite layer</div>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {SAT_OPTIONS.map(([k, label]) => (
            <button key={k} className={p.sat === k ? 'on' : ''} onClick={() => p.setSat(k)} disabled={k !== 'none' && !ov.satellites?.[k]}>{label}</button>
          ))}
        </div>
        {p.sat !== 'none' && ov.satellites?.[p.sat] && <div className="small muted">{ov.satellites[p.sat].label} · {utc(ov.satellites[p.sat].time)} · {ov.satellites[p.sat].note}</div>}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">What it means for a place</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {PLACES.map((pl) => (
            <button key={pl[0]} className="chip" style={{ border: 'none', cursor: 'pointer', background: pl[0] === place[0] ? 'rgba(255,255,255,0.16)' : undefined }} onClick={() => { setPlace(pl); p.onFocus(pl[2], pl[1]) }}>{pl[0]}</button>
          ))}
        </div>
        {outlook ? (
          <div className="stack" style={{ gap: 8, padding: 14, borderRadius: 14, background: levelStyle(outlook.level).bg, border: `1px solid ${levelStyle(outlook.level).border}` }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b style={{ color: levelStyle(outlook.level).color }}>{levelStyle(outlook.level).label} · {place[0]}</b>
              <span className="small muted">now {Math.round(outlook.now.wind_kmh)} km/h, gusts {Math.round(outlook.now.gust_kmh)}</span>
            </div>
            <span style={{ fontSize: 14 }}>{outlook.headline}</span>
            <GustBars o={outlook} />
            <span className="small muted">{outlook.reasons.join(' ')}</span>
          </div>
        ) : <div className="small muted">Loading forecast…</div>}
      </div>
      <div className="note">{ov.official.text} Wind: {ov.model}.</div>
    </aside>
  )
}

function TrackRecord({ bt }: { bt: Backtest }) {
  const spotted = bt.storms.filter((s) => s.spotted)
  const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length ? +(b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2).toFixed(1) : 0 }
  const lead = median(spotted.map((s) => s.days_before_landfall ?? 0))
  const max = Math.max(...spotted.map((s) => s.days_before_landfall ?? 0), 1)
  const test = bt.false_alarm_checks.find((f) => f.window.includes('held out'))
  const train = bt.false_alarm_checks.find((f) => !f.window.includes('held out'))
  const pct = (f?: { flagged: number; false_alarms: number }) => (f && f.flagged ? Math.round((100 * f.false_alarms) / f.flagged) : 0)
  return (
    <div className="stack" style={{ gap: 10, padding: 16, borderRadius: 16, background: 'linear-gradient(135deg, rgba(255,203,107,0.12), rgba(255,203,107,0.02))', border: '1px solid rgba(255,203,107,0.25)' }}>
      <div className="eyebrow" style={{ color: '#ffd98f' }}>Track record · tested on real storms</div>
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 46, lineHeight: '46px', color: '#ffd98f' }}>{spotted.length}/{bt.storms.length}</span>
        <span className="small" style={{ color: 'var(--text-2)' }}>Bay of Bengal storms since 2024 flagged using only forecasts issued at the time. Median warning <b style={{ color: 'var(--text)' }}>{lead} days before landfall</b>.</span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {bt.storms.map((s) => (
          <div key={s.storm} className="bar-row" style={{ gridTemplateColumns: '130px minmax(0,1fr) 64px' }}>
            <span className="small">{s.storm}{s.split === 'test' && <span className="muted"> · test</span>}</span>
            <span className="bar"><span className="amber" style={{ width: `${(100 * (s.days_before_landfall ?? 0)) / max}%` }} /></span>
            <span className="mono small" style={{ textAlign: 'right', color: s.spotted ? undefined : 'var(--severe)' }}>{s.spotted ? `${s.days_before_landfall} d` : 'missed'}</span>
          </div>
        ))}
      </div>
      {bt.baseline && test && (
        <div className="stat-grid" style={{ gap: 8 }}>
          <div className="stat" style={{ padding: 10 }}><b style={{ fontSize: 26, lineHeight: '30px', color: '#ffb29c' }}>{pct(bt.baseline.test)}%</b><span>false alarms before ({bt.baseline.test.false_alarms} of {bt.baseline.test.flagged})</span></div>
          <div className="stat cyan" style={{ padding: 10 }}><b style={{ fontSize: 26, lineHeight: '30px' }}>{pct(test)}%</b><span>false alarms now ({test.false_alarms} of {test.flagged})</span></div>
        </div>
      )}
      <div className="small muted">
        Filters chosen on 2024 only{train ? ` (${train.false_alarms} of ${train.flagged} false)` : ''}, then scored on 2025–26, which they never saw: GFS and ECMWF must agree, and the low must last 12+ hours.
        A hit counts only within {bt.thresholds.match_km} km of the real storm (IBTrACS). Small sample: {bt.storms.length} storms.
      </div>
    </div>
  )
}
