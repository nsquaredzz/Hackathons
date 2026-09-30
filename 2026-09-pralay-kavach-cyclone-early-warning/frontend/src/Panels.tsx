import { useEffect, useMemo, useState } from 'react'
import { api, apiUrl, fmtInt, fmtT, LANG_FONT, LANG_LABEL, type Advisory, type AgentStep, type Asset, type Health, type HelpRequest, type Plan, type Risk, type StormState, type Verify } from './api'

const ist = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...opts })

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#04202F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17 19 7" /></svg>
)
const Spark = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C12.8 7.5 16.5 11.2 22 12 16.5 12.8 12.8 16.5 12 22 11.2 16.5 7.5 12.8 2 12 7.5 11.2 11.2 7.5 12 2Z" /></svg>
)

function LlmNote({ llm }: { llm?: { label: string; model: string; fallback?: boolean; provider: string } }) {
  if (!llm) return null
  if (llm.fallback) return <div className="warn small">Model call failed, so a rule-based answer is shown. Check the API key and model name.</div>
  return (
    <div className="row small" style={{ color: llm.provider === 'mock' ? 'var(--amber)' : 'var(--cyan-soft)' }}>
      <Spark /> {llm.provider === 'mock' ? 'Rule-based (add a Gemini key for model reasoning)' : `${llm.label} · ${llm.model}`}
    </div>
  )
}

/* ------------------------------------------------------------------ Command */

export function CommandPanel({ storm, risk, onNext }: { storm: StormState | null; risk: Risk | null; onNext: () => void }) {
  if (!storm) return <aside className="panel right glass"><div className="empty">Loading storm…</div></aside>
  const maxPeople = Math.max(1, ...(risk?.districts ?? []).map((d) => d.people_at_risk))
  const afterLandfall = storm.t_rel >= 0
  return (
    <aside className="panel right glass fade-in">
      <div className="stack">
        <div className="eyebrow">Active event · Bay of Bengal</div>
        <h1 className="title" style={{ fontSize: 54, lineHeight: '54px' }}>Cyclone <i>Fani</i></h1>
        <span className="chip ember" style={{ alignSelf: 'flex-start' }}>{storm.category}</span>
      </div>
      <div className="hero-stat">
        <b>{storm.wind_kmh}</b>
        <span className="small" style={{ color: 'var(--text-2)', paddingBottom: 4 }}>km/h winds now<br />{storm.pressure_hpa} hPa centre</span>
      </div>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
        <div className="stat" style={{ padding: 12 }}><span className="small muted">Landfall</span><span style={{ fontWeight: 600, color: 'var(--text)' }}>{ist(storm.landfall_time, { day: 'numeric', month: 'short', hour: '2-digit' })}</span></div>
        <div className="stat" style={{ padding: 12 }}><span className="small muted">At landfall</span><span style={{ fontWeight: 600, color: 'var(--text)' }}>{storm.landfall_wind_kmh} km/h</span></div>
        <div className="stat" style={{ padding: 12 }}><span className="small muted">Track spread</span><span style={{ fontWeight: 600, color: 'var(--text)' }}>{afterLandfall ? '—' : `± ${storm.track_spread_km} km`}</span></div>
      </div>
      <div className="stack">
        <div className="eyebrow">People to evacuate, by district</div>
        {!risk && <div className="small muted">Running surge model…</div>}
        {risk?.districts.slice(0, 6).map((d) => (
          <div className="bar-row" key={d.district}>
            <span>{d.district}</span>
            <span className="bar"><span className={d.people_at_risk > maxPeople * 0.5 ? 'ember' : d.people_at_risk > maxPeople * 0.15 ? 'amber' : 'cyan'} style={{ width: `${Math.max(4, (100 * d.people_at_risk) / maxPeople)}%` }} /></span>
            <span className="mono small" style={{ textAlign: 'right' }}>{fmtInt(d.people_at_risk)}</span>
          </div>
        ))}
        {risk && risk.districts.length === 0 && <div className="small muted">No villages need to move yet.</div>}
        {risk && <div className="small muted">Total <b style={{ color: 'var(--text)' }}>{fmtInt(risk.people_to_evacuate)}</b> · {fmtInt(risk.people_in_wind_zone)} from destructive wind near the coast, {fmtInt(risk.people_in_flood_zone)} from storm surge</div>}
      </div>
      <div className="small muted mono">Track: {storm.source} best track (hindcast)<br />Satellite: NASA GIBS MODIS, 2 May 2019</div>
      <button className="btn-primary spacer" onClick={onNext}>Open risk assessment →</button>
    </aside>
  )
}

/* ------------------------------------------------------------------ Risk */

export function RiskPanel(p: {
  risk: Risk | null; loading: boolean; scenario: string; setScenario: (s: string) => void; riskT: number
  onFocus: (a: Asset) => void; onNext: () => void
}) {
  const r = p.risk
  return (
    <aside className="panel right glass fade-in">
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Surge model · forecast from {fmtT(p.riskT)}{p.loading ? ' · running…' : ''}</div>
        <h1 className="title">What's <i className="cool">exposed</i></h1>
      </div>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {[['north', 'Northern track'], ['likely', 'Most likely'], ['south', 'Southern track']].map(([id, label]) => (
          <button key={id} className={p.scenario === id ? 'on' : ''} onClick={() => p.setScenario(id)}>{label}</button>
        ))}
      </div>
      {r && (
        <>
          <div className="stat-grid">
            <div className="stat severe"><b>{r.people_to_evacuate >= 100000 ? (r.people_to_evacuate / 100000).toFixed(1) : fmtInt(r.people_to_evacuate)}{r.people_to_evacuate >= 100000 && <span style={{ fontSize: 20, color: 'inherit' }}> lakh</span>}</b><span>People to evacuate</span></div>
            <div className="stat cyan"><b>{fmtInt(r.people_in_flood_zone)}</b><span>In the storm-surge zone</span></div>
            <div className="stat amber"><b>{r.counts.hospitals}</b><span>Hospitals in flood or extreme wind</span></div>
            <div className="stat amber"><b>{r.counts.substations}</b><span>Substations at risk</span></div>
          </div>
          {r.waterlogging && (
            <div className="row" style={{ gap: 12, padding: '12px 14px', borderRadius: 14, background: 'rgba(143,220,255,0.06)', border: '1px solid rgba(143,220,255,0.18)' }}>
              <span className="swatch" style={{ background: 'rgba(143,220,255,0.7)' }} />
              <span className="small grow" style={{ color: 'var(--text-2)' }}>
                <b style={{ color: 'var(--text)' }}>Waterlogging-prone land</b> under the storm's rain: {fmtInt(r.waterlogging.km2)} km², {fmtInt(r.waterlogging.people)} people living on it
              </span>
            </div>
          )}
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Peak water level <b style={{ color: 'var(--text)' }}>{r.max_level_m} m</b></span>
            <span className="muted">Flooded <b style={{ color: 'var(--text)' }}>{fmtInt(r.flooded_km2)} km²</b></span>
            <span className="muted">Road cut <b style={{ color: 'var(--text)' }}>{r.counts.road_km_cut} km</b></span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">Critical assets at risk</div>
            {r.assets_at_risk.filter((a) => a.kind !== 'shelter').slice(0, 6).map((a) => (
              <button key={a.id} className="district-btn" onClick={() => p.onFocus(a)}>
                <span className="swatch" style={{ background: a.kind === 'hospital' ? 'var(--severe)' : '#c79bff', borderRadius: 5 }} />
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}<span className="muted small"> · {a.district}</span></span>
                <span className="mono small" style={{ color: a.hazard === 'wind' ? 'var(--ember-soft)' : 'var(--cyan-soft)' }}>{a.hazard === 'wind' ? `${a.wind_kmh} km/h` : `${a.depth_m} m`}</span>
              </button>
            ))}
            {r.assets_at_risk.filter((a) => a.kind !== 'shelter').length === 0 && <div className="small muted">No hospitals or substations at risk.</div>}
          </div>
        </>
      )}
      <div className="note">Evacuate where storm surge floods homes, or where winds pass {r?.thresholds.destructive_wind_kmh ?? 120} km/h within {r?.thresholds.wind_evac_coast_km ?? 20} km of the coast. Surge is a first-order screening model (pressure drop, wind setup scaled by real bathymetry, tide), spread over the elevation model: use it to set priorities, not to design embankments.</div>
      <button className="btn-primary spacer" onClick={p.onNext}>Generate action plan →</button>
    </aside>
  )
}

/* ------------------------------------------------------------------ Plan */

const STEP_ORDER = [
  ['bulletin', 'Read the bulletin and satellite image'],
  ['surge', 'Run surge model on 3 track scenarios'],
  ['exposure', 'Find people and assets in the flood zone'],
  ['shelters', 'Match villages to shelters with dry routes'],
  ['roads', 'Check roads against flood timing'],
  ['rank', 'Rank evacuation and explain why'],
]

export function PlanPanels(p: {
  plan: Plan | null; steps: AgentStep[]; running: boolean; selected: number | null
  onSelect: (id: number) => void; onRun: () => void; onApprove: () => void; t: number
}) {
  const sel = p.plan?.ranked.find((r) => r.id === p.selected) ?? p.plan?.ranked[0]
  const scen = p.plan?.scenarios ?? []
  const [lo, hi] = [Math.min(...scen.map((s) => s.max_level_m)), Math.max(...scen.map((s) => s.max_level_m))]
  const showSteps = p.running || p.steps.length > 0
  return (
    <>
      <aside className="panel left glass fade-in">
        <div className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">How the agent built this</div>
          <div className="h2">Six steps, <i className="cool">all logged</i></div>
        </div>
        <ol className="steps">
          {STEP_ORDER.map(([id, title]) => {
            const s = p.steps.find((x) => x.id === id)
            const status = s?.status ?? (showSteps ? 'todo' : p.plan ? 'done' : 'todo')
            return (
              <li key={id}>
                <span className={`step-icon ${status === 'running' ? 'running' : status === 'todo' ? 'todo' : ''}`}>{status === 'done' && <Check />}</span>
                <span>
                  {title}
                  {s?.detail && <><br /><span className="mono small muted">{s.detail}</span></>}
                </span>
              </li>
            )
          })}
        </ol>
        <div className="spacer stack">
          {p.plan?.assessment?.satellite_read && (
            <div className="note" style={{ borderStyle: 'solid' }}><b style={{ color: 'var(--cyan-soft)' }}>Satellite read.</b> {p.plan.assessment.satellite_read}</div>
          )}
          <button className="btn-ghost" onClick={p.onRun} disabled={p.running}>{p.running ? 'Agent running…' : p.plan ? `Re-run at ${fmtT(Math.min(p.t, 0))}` : `Run agent at ${fmtT(Math.min(p.t, 0))}`}</button>
        </div>
      </aside>

      <main className="panel center glass fade-in">
        <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="eyebrow" style={{ color: 'var(--amber)' }}>{p.plan ? `Draft from ${fmtT(p.plan.t_rel)} · awaiting approval` : 'No plan yet'}</div>
            <h1 className="title" style={{ fontSize: 42 }}>Evacuation <i>priority</i></h1>
          </div>
          {p.plan && <LlmNote llm={p.plan.llm} />}
        </div>
        {!p.plan && !p.running && (
          <div className="empty grow">The agent reads the bulletin and satellite image, runs the surge model on three tracks,<br />and ranks villages by who needs to move first.<br /><br />
            <button className="btn-primary" style={{ padding: '0 28px' }} onClick={p.onRun}>Run the agent</button>
          </div>
        )}
        {p.running && !p.plan && <div className="empty grow">Working… watch the steps on the left.</div>}
        {p.plan && (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: '21px' }}>{p.plan.summary}</p>
            <table className="table">
              <thead><tr><th>#</th><th>Village</th><th style={{ textAlign: 'right' }}>To move</th><th>Hazard</th><th>Leave by</th><th>Route</th></tr></thead>
              <tbody>
                {p.plan.ranked.map((c) => (
                  <tr key={c.id} className={c.id === sel?.id ? 'sel' : ''} onClick={() => p.onSelect(c.id)}>
                    <td className="rank">{c.rank}</td>
                    <td><b>{c.name}</b><br /><span className="small muted">{c.district}{c.shelter ? ` · ${c.shelter.name}` : ''}</span></td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 13 }}>{fmtInt(c.people_at_risk)}</td>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {c.hazard.includes('surge') && <span className="chip cyan">{c.peak_depth_m} m surge</span>}
                        {c.hazard.includes('wind') && <span className="chip ember" style={{ border: 'none' }}>{c.peak_wind_kmh} km/h</span>}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 13 }}>{fmtT(c.leave_by_h)}</td>
                    <td><span className={`chip ${c.route === 'dry' ? 'cyan' : c.route === 'none' ? '' : 'severe'}`}>{c.route === 'dry' ? 'Dry' : c.route === 'none' ? 'No shelter' : c.route.replace('floods', 'Floods')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="small muted spacer">Population: WorldPop 2020 · villages: OpenStreetMap · routes: straight-line check against the flood layer.</div>
          </>
        )}
      </main>

      <aside className="panel right glass fade-in">
        {sel ? (
          <>
            <div className="stack" style={{ gap: 8 }}>
              <div className="eyebrow">Why it's ranked #{sel.rank}</div>
              <h2 className="h2" style={{ fontSize: 34, lineHeight: '38px' }}>{sel.name}, <i>{sel.district}</i></h2>
            </div>
            <p style={{ margin: 0, fontSize: 15, lineHeight: '24px', color: '#d3dce2' }}>{sel.reason}</p>
            <div className="stat-grid">
              <div className="stat severe" style={{ padding: 12 }}><b style={{ fontSize: 30, lineHeight: '34px' }}>{fmtInt(sel.people_at_risk)}</b><span>People to move</span></div>
              <div className="stat" style={{ padding: 12 }}><b style={{ fontSize: 30, lineHeight: '34px' }}>{fmtT(sel.leave_by_h)}</b><span>Leave by</span></div>
              <div className="stat amber" style={{ padding: 12 }}><b style={{ fontSize: 30, lineHeight: '34px' }}>{sel.peak_wind_kmh}</b><span>Peak wind km/h{sel.gales_from_h != null ? ` · gales ${fmtT(sel.gales_from_h)}` : ''}</span></div>
              <div className="stat cyan" style={{ padding: 12 }}><b style={{ fontSize: 30, lineHeight: '34px' }}>{sel.peak_depth_m > 0 ? `${sel.peak_depth_m} m` : '—'}</b><span>Surge{sel.water_arrives_h != null ? ` · ${fmtT(sel.water_arrives_h)}` : ''}</span></div>
            </div>
            {sel.shelter && (
              <div className="note" style={{ borderStyle: 'solid' }}>
                Shelter: <b style={{ color: 'var(--text)' }}>{sel.shelter.name}</b>, {sel.shelter.distance_km} km{sel.shelter.proxy ? ' (school used as shelter)' : ''}
              </div>
            )}
            {scen.length > 0 && (
              <div className="stack" style={{ padding: 16, borderRadius: 16, background: 'rgba(255,203,107,0.07)', border: '1px solid rgba(255,203,107,0.2)' }}>
                <div className="row small" style={{ justifyContent: 'space-between' }}><b style={{ color: '#ffd98f', textTransform: 'capitalize' }}>Confidence: {p.plan!.confidence}</b><span className="muted">3 track scenarios</span></div>
                <div style={{ position: 'relative', height: 26 }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 2, background: 'rgba(255,255,255,0.1)' }} />
                  {scen.map((s) => {
                    const x = hi > lo ? ((s.max_level_m - lo) / (hi - lo)) * 88 + 4 : 50
                    return <div key={s.scenario} title={s.scenario} style={{ position: 'absolute', left: `${x}%`, top: s.scenario === 'likely' ? 3 : 6, width: s.scenario === 'likely' ? 20 : 14, height: s.scenario === 'likely' ? 20 : 14, borderRadius: '50%', background: s.scenario === 'likely' ? 'var(--ember)' : s.scenario === 'north' ? 'var(--amber)' : 'var(--severe)', boxShadow: s.scenario === 'likely' ? '0 0 12px rgba(255,138,76,.7)' : undefined }} />
                  })}
                </div>
                <div className="small muted">{scen.map((s) => `${s.scenario} ${s.max_level_m} m`).join(' · ')}</div>
                <div className="small muted">{p.plan!.confidence_note}</div>
              </div>
            )}
            {p.plan!.harden.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="eyebrow">Harden before landfall</div>
                {p.plan!.harden.slice(0, 4).map((a) => (
                  <div key={a.id} className="small"><b>{a.name}</b> <span className="muted">· {a.hazard === 'wind' ? `${a.wind_kmh} km/h` : `${a.depth_m} m water`} · {a.action}</span></div>
                ))}
              </div>
            )}
            <div className="spacer stack">
              <button className="btn-primary" onClick={p.onApprove}>Approve plan → write advisories</button>
              <div className="small muted" style={{ textAlign: 'center' }}>No alert goes out until two people approve it.</div>
            </div>
          </>
        ) : (
          <div className="empty grow">Run the agent to see a ranked plan and the reasoning behind it.</div>
        )}
      </aside>
    </>
  )
}

/* ------------------------------------------------------------------ Dispatch */

const APPROVERS = ['Duty officer', 'Relief Commissioner']

function HelpList({ help, onHelp, onFocus }: { help: HelpRequest[]; onHelp: (id: string, s: string) => void; onFocus: (lon: number, lat: number) => void }) {
  const open = help.filter((h) => h.status !== 'resolved')
  if (!open.length) return null
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="eyebrow" style={{ color: '#ffb3ad' }}>SOS from Sahayak · {open.length}</div>
      {open.slice(0, 5).map((h) => (
        <div key={h.id} className="stack" style={{ gap: 6, padding: 12, borderRadius: 14, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)' }}>
          <button onClick={() => onFocus(h.lon, h.lat)} style={{ border: 'none', background: 'none', color: 'var(--text)', textAlign: 'left', padding: 0, cursor: 'pointer' }}>
            <b style={{ textTransform: 'capitalize' }}>{h.need}</b> <span className="small muted">· {h.district} · {new Date(h.time * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}{h.people ? ` · ${h.people} people` : ''}</span>
            <div className="small" style={{ color: 'var(--text-2)', marginTop: 2 }}>{h.note}</div>
          </button>
          <div className="row" style={{ gap: 6 }}>
            {h.status === 'open' && <button className="btn-ghost" style={{ height: 32, fontSize: 12 }} onClick={() => onHelp(h.id, 'dispatched')}>Team sent</button>}
            <button className="btn-ghost" style={{ height: 32, fontSize: 12 }} onClick={() => onHelp(h.id, 'resolved')}>Resolved</button>
            {h.status === 'dispatched' && <span className="chip cyan">Team on the way</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function DispatchPanel({ plan, risk, onNeedPlan, help = [], onHelp, onFocus }: {
  plan: Plan | null; risk: Risk | null; onNeedPlan: () => void
  help?: HelpRequest[]; onHelp?: (id: string, s: string) => void; onFocus?: (lon: number, lat: number) => void
}) {
  const districts = (plan?.districts ?? risk?.districts ?? []).map((d) => d.district)
  const [district, setDistrict] = useState<string | null>(null)
  const [adv, setAdv] = useState<Advisory | null>(null)
  const [busy, setBusy] = useState(false)
  const [lang, setLang] = useState('or')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!district && districts.length) setDistrict(districts[0])
  }, [districts.join(',')])

  useEffect(() => {
    if (!district) return
    api.advisories().then((all) => {
      const found = all.find((a) => a.district === district) ?? null
      setAdv(found)
      if (found) setLang(found.languages.find((l) => l !== 'en') ?? 'en')
    })
  }, [district])

  const generate = async () => {
    if (!district) return
    setBusy(true); setErr(null)
    try {
      const a = await api.makeAdvisory(district)
      setAdv(a)
      setLang(a.languages.find((l) => l !== 'en') ?? 'en')
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const approve = async (who: string) => {
    if (!district) return
    setErr(null)
    try { setAdv(await api.approve(district, who)) } catch (e: any) { setErr(e.message) }
  }

  if (!plan) {
    return (
      <main className="panel center glass" style={{ left: 346 }}>
        <div className="empty grow">Advisories are written from an approved plan.<br /><br /><button className="btn-primary" style={{ padding: '0 28px' }} onClick={onNeedPlan}>Go to Plan</button></div>
      </main>
    )
  }
  const text = adv?.texts[lang]
  const approvedBy = new Set(adv?.approvals.map((a) => a.by))
  const top = plan.ranked.find((r) => r.district === district)
  return (
    <>
      <aside className="panel left glass fade-in">
        <div className="eyebrow">Districts in the plan</div>
        <div className="stack" style={{ gap: 6 }}>
          {(plan.districts ?? []).map((d) => (
            <button key={d.district} className={`district-btn${d.district === district ? ' on' : ''}`} onClick={() => setDistrict(d.district)}>
              <span className="grow"><b>{d.district}</b><br /><span className="small muted">{d.villages} villages · {fmtInt(d.people_at_risk)} people</span></span>
              <span className="mono small muted">{fmtT(d.earliest_leave_by_h)}</span>
            </button>
          ))}
        </div>
        {onHelp && onFocus && <HelpList help={help} onHelp={onHelp} onFocus={onFocus} />}
        <div className="note spacer">Channels: CAP feed for SACHET, cell broadcast, SMS, WhatsApp, voice call. In this prototype, dispatch goes to the citizen phone view, which rings and reads the alert aloud.</div>
      </aside>

      <main className="panel center glass fade-in">
        <div className="stack" style={{ gap: 8 }}>
          <div className="eyebrow row" style={{ color: 'var(--cyan-soft)', gap: 8 }}><Spark /> Advisory · {district} district</div>
          <h1 className="title" style={{ fontSize: 42 }}>Review the <i>message</i></h1>
        </div>
        {!adv && (
          <div className="empty grow">
            Write the advisory for {district} in {district === 'Ganjam' ? 'English, Odia and Telugu' : district === 'Balasore' || district === 'Bhadrak' ? 'English, Odia and Bengali' : 'English and Odia'}.<br /><br />
            <button className="btn-primary" style={{ padding: '0 28px' }} disabled={busy} onClick={generate}>{busy ? 'Writing…' : 'Write advisory'}</button>
          </div>
        )}
        {adv && (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="seg">
                {adv.languages.map((l) => (
                  <button key={l} className={`${lang === l ? 'on ember' : ''}`} style={{ fontFamily: LANG_FONT[l] }} onClick={() => setLang(l)}>{LANG_LABEL[l]}</button>
                ))}
              </div>
              <LlmNote llm={adv.llm} />
            </div>
            {text?.unavailable ? (
              <div className="warn">{text.unavailable}</div>
            ) : (
              <div className="advisory-card fade-in" key={lang}>
                <header>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 22 20H2Z" /><path d="M12 10v4M12 17v.5" /></svg>
                  EXTREME · CYCLONE FANI
                  <span style={{ marginLeft: 'auto', letterSpacing: 0 }}>Leave by {adv.facts.leave_by_ist}</span>
                </header>
                <div className="body" style={{ fontFamily: LANG_FONT[lang] }}>
                  <div className="headline">{text?.headline}</div>
                  <div className="text">{text?.body}</div>
                </div>
              </div>
            )}
            {text?.back_translation && lang !== 'en' && (
              <div className="stack" style={{ gap: 6, padding: '14px 18px', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)' }}>
                <div className="eyebrow">Back-translation for the reviewer{text.template ? ' · template' : ''}</div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: 19, lineHeight: '27px', color: '#dde5ea' }}>“{text.back_translation}”</div>
              </div>
            )}
            <div className="row small muted spacer" style={{ justifyContent: 'space-between' }}>
              <span>Landfall {adv.facts.landfall_ist} · {adv.facts.wind_kmh} km/h</span>
              <button className="btn-ghost" style={{ height: 36 }} disabled={busy} onClick={generate}>{busy ? 'Rewriting…' : 'Rewrite'}</button>
            </div>
          </>
        )}
      </main>

      <aside className="panel right glass fade-in">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="eyebrow">CAP 1.2 message</div>
          <span className="chip amber">Replay sends as Exercise</span>
        </div>
        <pre className="cap">{adv?.cap ?? '—'}</pre>
        {adv && <a className="small" href={apiUrl(`/api/advisory/${district}/cap.xml`)} target="_blank" rel="noreferrer">Open CAP XML ↗</a>}
        <div className="stack">
          <div className="eyebrow">Two-person sign-off</div>
          {APPROVERS.map((who, i) => (
            <div key={who} className={`approver${approvedBy.has(who) ? ' done' : ''}`}>
              <span className="avatar" style={approvedBy.has(who) ? undefined : { background: 'transparent', border: '1px dashed var(--line-2)', color: 'var(--muted)' }}>{i + 1}</span>
              <span className="grow"><b>{who}</b><br /><span className="small muted">{approvedBy.has(who) ? 'Approved' : 'Waiting'}</span></span>
              {!approvedBy.has(who) && adv && adv.status !== 'dispatched' && (
                <button className="btn-ghost" style={{ height: 36 }} disabled={i === 1 && approvedBy.size === 0} onClick={() => approve(who)}>Approve</button>
              )}
            </div>
          ))}
          {err && <div className="warn small">{err}</div>}
        </div>
        <div className="spacer stack">
          {adv?.status === 'dispatched' ? (
            <>
              <div className="stack" style={{ padding: 14, borderRadius: 14, background: 'rgba(111,211,255,0.08)', border: '1px solid rgba(111,211,255,0.25)' }}>
                <b style={{ color: 'var(--cyan-soft)' }}>Dispatched to {district}</b>
                <span className="small muted">Phones in the district now show the alert with their own shelter and route.</span>
              </div>
              <a className="btn-primary" href={`/citizen${top ? `?lat=${top.lat}&lon=${top.lon}&name=${encodeURIComponent(top.name)}` : ''}`} target="_blank" rel="noreferrer">Open a resident's phone ↗</a>
            </>
          ) : (
            <div className="small muted" style={{ textAlign: 'center' }}>Dispatch happens automatically after the second approval.</div>
          )}
        </div>
      </aside>
    </>
  )
}

/* ------------------------------------------------------------------ Verify */

const lakh = (n: number) => (n >= 100000 ? `${(n / 100000).toFixed(1)} lakh` : fmtInt(n))
const crore = (n: number) => `₹${(n / 1e7).toFixed(1)} crore`

export function VerifyPanel({ health, onFocus }: { health: Health | null; onFocus: (lon: number, lat: number) => void }) {
  const [v, setV] = useState<Verify | null>(null)
  useEffect(() => { api.verify().then(setV).catch(() => {}) }, [])
  const maxWind = useMemo(() => Math.max(200, ...(v?.parametric.by_district ?? []).map((d) => d.peak_wind_kmh)), [v])
  const h = v?.hindcast
  const maxWater = h && h.available ? Math.max(...h.satellite.by_district.map((d) => d.water_km2), 1) : 1
  return (
    <aside className="panel wide-right glass fade-in">
      {!v && <div className="empty">Loading the satellite check…</div>}
      {h && !h.available && (
        <>
          <h1 className="title">How close <i className="cool">was it?</i></h1>
          <div className="warn"><b>Satellite flood map not loaded yet.</b><br />{h.message}
            {health && !health.data['observed_flood.npz'] && <><br /><br /><span className="mono small">python -m pipeline.gee_precompute</span></>}
          </div>
        </>
      )}
      {h && h.available && (
        <>
          <div className="stack" style={{ gap: 8 }}>
            <div className="eyebrow">After landfall · Sentinel-1 radar · {h.satellite.date}</div>
            <h1 className="title">Where water <i>actually stood</i></h1>
          </div>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <div className="stat" style={{ padding: 12, background: 'linear-gradient(160deg, rgba(255,138,76,0.16), rgba(255,138,76,0.03))', borderColor: 'rgba(255,138,76,0.25)' }}><b style={{ fontSize: 32, color: 'var(--ember-soft)' }}>{h.satellite.observed_km2}</b><span>km² standing water</span></div>
            <div className="stat" style={{ padding: 12 }}><b style={{ fontSize: 32 }}>{h.satellite.villages}</b><span>villages affected</span></div>
            <div className="stat" style={{ padding: 12 }}><b style={{ fontSize: 32 }}>{h.satellite.by_district[0]?.district ?? '—'}</b><span>worst hit</span></div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {h.satellite.by_district.slice(0, 5).map((d) => (
              <div key={d.district} className="bar-row" style={{ gridTemplateColumns: '120px minmax(0,1fr) 80px' }}>
                <span>{d.district}</span>
                <span className="bar"><span className="ember" style={{ width: `${(100 * d.water_km2) / maxWater}%` }} /></span>
                <span className="mono small" style={{ textAlign: 'right' }}>{d.water_km2} km²</span>
              </div>
            ))}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">Send relief first to</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {h.satellite.top_villages.slice(0, 6).map((t) => (
                <button key={t.id} className="chip" style={{ border: 'none', cursor: 'pointer' }} onClick={() => onFocus(t.lon, t.lat)}>{t.name} · {t.water_km2} km²</button>
              ))}
            </div>
          </div>

          <div className="stack" style={{ gap: 12, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
            <div className="eyebrow" style={{ paddingTop: 10 }}>Checking the forecast</div>
            {h.waterlogging_check && (
              <div className="row" style={{ gap: 16, padding: 16, borderRadius: 16, background: 'linear-gradient(135deg, rgba(111,211,255,0.14), rgba(111,211,255,0.02))', border: '1px solid rgba(111,211,255,0.2)', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 52, lineHeight: '52px', color: '#bdebff' }}>{h.waterlogging_check.lift}×</span>
                <span className="small" style={{ color: 'var(--text-2)' }}>
                  <b style={{ color: 'var(--text)' }}>Waterlogging forecast beats chance.</b> It flags {(h.waterlogging_check.land_flagged * 100).toFixed(1)}% of the land, which held {Math.round(h.waterlogging_check.flooding_caught * 100)}% of the flooding the radar saw. Scored on areas it was not fitted to.
                </span>
              </div>
            )}
            {h.evacuation_check.model_people != null && (
              <div className="row" style={{ gap: 16, padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', alignItems: 'center' }}>
                <span className="stack" style={{ gap: 0, minWidth: 110 }}>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: 34, lineHeight: '36px' }}>{lakh(h.evacuation_check.model_people)}</span>
                  <span className="small muted">model</span>
                </span>
                <span className="stack" style={{ gap: 0, minWidth: 110 }}>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: 34, lineHeight: '36px', color: 'var(--ember-soft)' }}>~{lakh(h.evacuation_check.people)}</span>
                  <span className="small muted">actually evacuated</span>
                </span>
                <span className="small muted">People to evacuate. {h.evacuation_check.source}.</span>
              </div>
            )}
            <div className="note">{h.surge_check.text}</div>
          </div>
        </>
      )}

      {v && (
        <div className="stack" style={{ paddingTop: 6, borderTop: '1px solid var(--line)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10 }}>
            <div className="eyebrow">Parametric payouts</div>
            <div className="small muted">Total <b style={{ color: 'var(--ember-soft)' }}>{crore(v.parametric.payout_inr + (v.flood_payout?.payout_inr ?? 0))}</b></div>
          </div>
          <div className="small muted">Wind cover: {fmtInt(v.parametric.triggered_units)} villages over {v.parametric.threshold_kmh} km/h · {crore(v.parametric.payout_inr)}</div>
          {v.parametric.by_district.slice(0, 4).map((d) => (
            <div key={d.district} className="bar-row" style={{ gridTemplateColumns: '110px minmax(0,1fr) 92px' }}>
              <span>{d.district}</span>
              <span className="bar">
                <span className={d.peak_wind_kmh >= v.parametric.threshold_kmh ? 'ember' : 'grey'} style={{ width: `${(100 * d.peak_wind_kmh) / maxWind}%` }} />
                <span className="marker" style={{ left: `${(100 * v.parametric.threshold_kmh) / maxWind}%` }} />
              </span>
              <span className="mono small" style={{ textAlign: 'right', color: d.triggered ? 'var(--ember-soft)' : 'var(--muted)' }}>{d.peak_wind_kmh} km/h</span>
            </div>
          ))}
          {v.flood_payout && (
            <div className="small muted">Flood cover: {v.flood_payout.villages} villages with standing water on the radar · {crore(v.flood_payout.payout_inr)}. No field survey needed.</div>
          )}
          <div className="note">Sums insured per village are demo assumptions. Wind from a Holland (1980) model on the IBTrACS best track.</div>
        </div>
      )}
    </aside>
  )
}
