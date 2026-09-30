import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as MLMap } from 'maplibre-gl'
import { LivePanel } from './Live'
import MapView from './MapView'
import WindParticles from './WindParticles'
import { CommandPanel, DispatchPanel, PlanPanels, RiskPanel, VerifyPanel } from './Panels'
import { api, apiUrl, fmtT, liveApi, runAgent, type AgentStep, type Asset, type Health, type HelpRequest, type LiveOverview, type LngLat, type Plan, type Report, type Risk, type StormState, type WindField } from './api'

export type Tab = 'live' | 'command' | 'risk' | 'plan' | 'dispatch' | 'verify'
const TABS: [Tab, string][] = [['live', 'Live'], ['command', 'Replay'], ['risk', 'Risk'], ['plan', 'Plan'], ['dispatch', 'Dispatch'], ['verify', 'Verify']]

export interface Layers { flood: boolean; satellite: boolean; assets: boolean; roads: boolean; waterlog: boolean }

export default function Console() {
  const [health, setHealth] = useState<Health | null>(null)
  const [meta, setMeta] = useState<{ flood_corners: LngLat[]; satellite_corners: LngLat[] } | null>(null)
  const [tab, setTab] = useState<Tab>('live')
  const [mapInst, setMapInst] = useState<MLMap | null>(null)
  const [liveOv, setLiveOv] = useState<LiveOverview | null>(null)
  const [liveErr, setLiveErr] = useState<string | null>(null)
  const [windField, setWindField] = useState<WindField | null>(null)
  const [windFrame, setWindFrame] = useState(0)
  const [windPlaying, setWindPlaying] = useState(false)
  const [sat, setSat] = useState('infrared')
  const [t, setT] = useState(-48)
  const [playing, setPlaying] = useState(false)
  const [scenario, setScenario] = useState('likely')
  const [storm, setStorm] = useState<StormState | null>(null)
  const [risk, setRisk] = useState<Risk | null>(null)
  const [riskLoading, setRiskLoading] = useState(false)
  const [allAssets, setAllAssets] = useState<Asset[]>([])
  const [layers, setLayers] = useState<Layers>({ flood: true, satellite: false, assets: false, roads: true, waterlog: true })
  const [plan, setPlan] = useState<Plan | null>(null)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [agentRunning, setAgentRunning] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [focus, setFocus] = useState<LngLat | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [help, setHelp] = useState<HelpRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const stopAgent = useRef<() => void>(() => {})

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(`Backend not reachable: ${e.message}`))
    api.meta().then(setMeta).catch(() => {})
    fetch(apiUrl('/api/assets')).then((r) => r.json()).then(setAllAssets).catch(() => {})
    api.plan().then(setPlan).catch(() => {})
  }, [])

  useEffect(() => {
    api.storm(t).then(setStorm).catch(() => {})
  }, [t])

  // Live feeds: refresh every 10 minutes.
  useEffect(() => {
    const load = () => {
      liveApi.overview().then((o) => { setLiveOv(o); setLiveErr(null) }).catch((e) => setLiveErr(e.message))
      liveApi.wind().then(setWindField).catch(() => {})
    }
    load()
    const id = setInterval(load, 600000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!windPlaying || !windField) return
    const id = setInterval(() => setWindFrame((f) => (f + 1) % windField.times.length), 900)
    return () => clearInterval(id)
  }, [windPlaying, windField])

  // Surge only changes in 6 h buckets, so fetch risk per bucket.
  const riskT = Math.max(-72, Math.min(0, 6 * Math.round(t / 6)))
  useEffect(() => {
    let live = true
    setRiskLoading(true)
    api.risk(riskT, scenario)
      .then((r) => live && setRisk(r))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setRiskLoading(false))
    return () => { live = false }
  }, [riskT, scenario])

  useEffect(() => {
    const poll = () => { api.reports().then(setReports).catch(() => {}); api.help().then(setHelp).catch(() => {}) }
    poll()
    const id = setInterval(poll, 4000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      setT((v) => {
        if (v >= 12) { setPlaying(false); return v }
        return v + 3
      })
    }, 700)
    return () => clearInterval(id)
  }, [playing])

  const startAgent = useCallback(() => {
    stopAgent.current()
    setSteps([])
    setAgentRunning(true)
    setTab('plan')
    stopAgent.current = runAgent(Math.min(t, 0), (ev) => {
      if (ev.type === 'step') {
        setSteps((prev) => {
          const i = prev.findIndex((s) => s.id === ev.id)
          if (i === -1) return [...prev, ev]
          const next = prev.slice()
          next[i] = ev
          return next
        })
      } else if (ev.type === 'plan') {
        setPlan(ev.plan)
        setSelected(ev.plan.ranked[0]?.id ?? null)
        setAgentRunning(false)
      } else if (ev.type === 'error') {
        setAgentRunning(false)
      }
    })
  }, [t])

  const selectCandidate = (id: number) => {
    setSelected(id)
    const c = plan?.ranked.find((r) => r.id === id)
    if (c) setFocus([c.lon, c.lat])
  }

  // Frame the storm and its landfall when the replay starts or the tab changes; not on every slider tick.
  const [fitTo, setFitTo] = useState<LngLat[] | null>(null)
  const framed = useRef('')
  useEffect(() => {
    if (!storm) return
    const key = `${tab}`
    if (framed.current === key) return
    framed.current = key
    if (tab === 'command') setFitTo([storm.center, storm.landfall_point])
    if (tab === 'live') setFitTo([[79, 7], [97, 23.5]])
    if (tab === 'risk') setFitTo([[85.0, 19.2], [87.0, 21.0]])
    if (tab === 'verify') setFitTo([[85.3, 19.5], [87.1, 21.6]])
  }, [storm, tab])

  const floodVisible = tab !== 'command' && layers.flood
  const showRiskLayers = tab === 'risk'
  const replayLabel = fmtT(t)
  const liveStorms = liveOv ? {
    type: 'FeatureCollection' as const,
    features: [...(liveOv.storms.active ?? []), ...(liveOv.storms.recent ?? []).slice(0, 1)].flatMap((s) => s.geometry?.features ?? []),
  } : null
  const genesisMarks = (liveOv?.genesis ?? []).map((g) => ({ lon: g.lon, lat: g.lat, path: g.path, label: `Low ${g.min_pressure_hpa} hPa` }))
  const satLayer = tab === 'live' && sat !== 'none' && liveOv?.satellites?.[sat]
    ? { id: sat, tiles: liveOv.satellites[sat].tiles, maxzoom: liveOv.satellites[sat].maxzoom, opacity: sat === 'true_color' ? 0.85 : 0.55 } : null

  return (
    <div className="console">
      <MapView
        storm={storm}
        showTrack={tab === 'command' || tab === 'risk'}
        showCone={tab === 'command'}
        floodUrl={floodVisible && tab !== 'verify' ? api.floodUrl(riskT, scenario) : null}
        floodCorners={meta?.flood_corners ?? null}
        satellite={layers.satellite && (tab === 'command' || tab === 'risk')}
        satelliteCorners={meta?.satellite_corners ?? null}
        observedUrl={tab === 'verify' && health?.data['observed_flood.npz'] ? apiUrl('/api/layers/observed.png') : null}
        waterlogUrl={health?.data['hydro.npz'] && ((tab === 'risk' && layers.waterlog) || tab === 'verify') ? apiUrl('/api/layers/waterlogging.png') : null}
        baseAssets={showRiskLayers && layers.assets ? allAssets : []}
        atRisk={showRiskLayers && risk ? risk.assets_at_risk : []}
        cutRoads={showRiskLayers && layers.roads && risk ? risk.cut_roads : []}
        candidates={tab === 'plan' && plan ? plan.ranked : []}
        selectedCandidate={selected}
        reports={reports}
        focus={focus}
        fitTo={fitTo}
        dim={tab === 'plan' || tab === 'dispatch'}
        onSelectCandidate={selectCandidate}
        onMap={setMapInst}
        satTiles={satLayer}
        liveStorms={tab === 'live' ? liveStorms : null}
        genesis={tab === 'live' ? genesisMarks : []}
        help={help}
      />
      {tab === 'live' && <WindParticles map={mapInst} field={windField} frame={windFrame} />}

      <header className="topbar glass">
        <div className="brand">
          <span className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7a5 5 0 1 0 5 5" /><circle cx="12" cy="12" r="1.4" fill="#fff" /></svg>
          </span>
          Pralay Kavach
        </div>
        {tab === 'live'
          ? <div className="event-pill" style={{ background: 'rgba(111,211,255,0.1)', borderColor: 'rgba(111,211,255,0.3)', color: '#a5e4ff' }}><span className="dot" style={{ background: '#6fd3ff', boxShadow: '0 0 0 4px rgba(111,211,255,0.2)' }} />Live · Bay of Bengal</div>
          : <div className="event-pill"><span className="dot" />Cyclone Fani · Replay · {replayLabel}</div>}
        <nav className="nav">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="topbar-right">
          {help.some((h) => h.status === 'open') && (
            <button onClick={() => setTab('dispatch')} className="event-pill" style={{ cursor: 'pointer', background: 'rgba(255,59,48,0.16)', borderColor: 'rgba(255,59,48,0.5)', color: '#ffb3ad' }}>
              <span className="dot" style={{ background: '#ff3b30', boxShadow: '0 0 0 4px rgba(255,59,48,0.25)' }} />SOS · {help.filter((h) => h.status === 'open').length} open
            </button>
          )}
          {health && (
            <span className={`llm-badge${health.llm.provider === 'mock' ? ' mock' : ''}`} title={health.llm.model}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C12.8 7.5 16.5 11.2 22 12 16.5 12.8 12.8 16.5 12 22 11.2 16.5 7.5 12.8 2 12 7.5 11.2 11.2 7.5 12 2Z" /></svg>
              {health.llm.label}
            </span>
          )}
          <button className="btn-ghost" style={{ height: 36, fontSize: 13 }} title="Clear the plan, advisories and reports"
            onClick={async () => { await fetch(apiUrl('/api/reset'), { method: 'POST' }); setPlan(null); setSteps([]); setSelected(null); setReports([]); setHelp([]); setTab('live'); setT(-48) }}>Reset</button>
          <a className="btn-ghost" style={{ height: 36, fontSize: 13 }} href="/citizen" target="_blank" rel="noreferrer">Phone ↗</a>
        </div>
      </header>

      {error && (
        <div className="overlay glass warn" style={{ left: '50%', transform: 'translateX(-50%)', top: 92, zIndex: 9 }} onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {tab === 'live' && windField && (
        <div className="overlay glass timeline" style={{ left: 20, right: 436, bottom: 20 }}>
          <button className="play" aria-label={windPlaying ? 'Pause forecast' : 'Play forecast'} onClick={() => setWindPlaying(!windPlaying)}>
            {windPlaying
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="#1b0b03"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="#1b0b03"><path d="M7 4 20 12 7 20Z" /></svg>}
          </button>
          <div style={{ width: 170, flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 22 }}>{windFrame === 0 ? 'Now' : `+${windFrame * 3} h`}</div>
            <div className="small muted">{new Date(windField.times[windFrame] + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit' })} IST · wind flow</div>
          </div>
          <div className="grow stack" style={{ gap: 6 }}>
            <input type="range" min={0} max={windField.times.length - 1} step={1} value={windFrame} aria-label="Forecast hour" onChange={(e) => { setWindPlaying(false); setWindFrame(Number(e.target.value)) }} />
            <div className="ticks"><span className={windFrame === 0 ? 'now' : ''}>Now</span><span>+24 h</span><span>+48 h</span><span>+72 h</span></div>
          </div>
        </div>
      )}
      {tab === 'live' && (
        <div className="overlay glass legend" style={{ left: 20, top: 92 }}>
          <span><i style={{ width: 22, height: 3, borderRadius: 2, background: 'rgba(111,211,255,0.8)' }} />Wind &lt;30</span>
          <span><i style={{ width: 22, height: 3, borderRadius: 2, background: '#ffcb6b' }} />50–70</span>
          <span><i style={{ width: 22, height: 3, borderRadius: 2, background: '#ff8a4c' }} />70–100</span>
          <span><i style={{ width: 22, height: 3, borderRadius: 2, background: '#fff0e6' }} />100+ km/h</span>
        </div>
      )}

      {(tab === 'command' || tab === 'risk') && (
        <div className="overlay glass timeline" style={{ left: 20, right: 436, bottom: 20 }}>
          <button className="play" aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => { if (t >= 12) setT(-72); setPlaying(!playing) }}>
            {playing
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="#1b0b03"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="#1b0b03"><path d="M7 4 20 12 7 20Z" /></svg>}
          </button>
          <div style={{ width: 150, flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 22 }}>{replayLabel}</div>
            <div className="small muted">{storm ? new Date(storm.time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' IST' : ''}</div>
          </div>
          <div className="grow stack" style={{ gap: 6 }}>
            <input type="range" min={-72} max={24} step={3} value={t} aria-label="Replay time" onChange={(e) => { setPlaying(false); setT(Number(e.target.value)) }} />
            <div className="ticks">
              {[-72, -48, -36, -24, -12, 0, 12, 24].map((h) => (
                <span key={h} className={Math.abs(h - t) < 3 ? 'now' : ''}>{fmtT(h)}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {(tab === 'command' || tab === 'risk') && (
        <div className="overlay glass" style={{ left: 20, top: 92, padding: 4, display: 'flex', gap: 4 }}>
          <div className="seg" style={{ background: 'transparent' }}>
            <button className={layers.satellite ? 'on' : ''} onClick={() => setLayers({ ...layers, satellite: !layers.satellite })}>Satellite 2 May</button>
            {tab === 'risk' && <button className={layers.flood ? 'on' : ''} onClick={() => setLayers({ ...layers, flood: !layers.flood })}>Surge</button>}
            {tab === 'risk' && <button className={layers.waterlog ? 'on' : ''} onClick={() => setLayers({ ...layers, waterlog: !layers.waterlog })}>Waterlogging</button>}
            {tab === 'risk' && <button className={layers.assets ? 'on' : ''} onClick={() => setLayers({ ...layers, assets: !layers.assets })}>All assets</button>}
            {tab === 'risk' && <button className={layers.roads ? 'on' : ''} onClick={() => setLayers({ ...layers, roads: !layers.roads })}>Cut roads</button>}
          </div>
        </div>
      )}

      {tab === 'risk' && (
        <div className="overlay glass legend" style={{ left: 20, bottom: 112 }}>
          <span><i className="swatch" style={{ width: 28, height: 8, borderRadius: 4, background: 'linear-gradient(90deg,#a5e4ff,#2f8fd8,#154e86)' }} />Surge 0.5–3.5 m</span>
          {health?.data['hydro.npz'] && <span><i className="swatch" style={{ background: 'rgba(143,220,255,0.6)' }} />Waterlogging-prone</span>}
          <span><i className="swatch" style={{ background: '#ff6b4a', borderRadius: 6 }} />Hospital</span>
          <span><i className="swatch" style={{ background: '#c79bff', borderRadius: 6 }} />Substation</span>
          <span><i className="swatch" style={{ background: '#ffcb6b', borderRadius: 6 }} />Shelter flooded</span>
          <span><i style={{ width: 20, borderTop: '3px dashed #ff6b4a' }} />Road cut</span>
        </div>
      )}
      {tab === 'verify' && health?.data['observed_flood.npz'] && (
        <div className="overlay glass legend" style={{ left: 20, bottom: 20 }}>
          <span><i className="swatch" style={{ background: '#ff8a4c' }} />Standing water seen by Sentinel-1, 4 May</span>
          <span><i className="swatch" style={{ background: 'rgba(143,220,255,0.6)' }} />Forecast waterlogging-prone land</span>
        </div>
      )}

      {tab === 'live' && <LivePanel ov={liveOv} error={liveErr} sat={sat} setSat={setSat} onFocus={(lon, lat) => setFocus([lon, lat])} />}
      {tab === 'command' && <CommandPanel storm={storm} risk={risk} onNext={() => setTab('risk')} />}
      {tab === 'risk' && (
        <RiskPanel risk={risk} loading={riskLoading} scenario={scenario} setScenario={setScenario} riskT={riskT}
          onFocus={(a) => setFocus([a.lon, a.lat])} onNext={startAgent} />
      )}
      {tab === 'plan' && (
        <PlanPanels plan={plan} steps={steps} running={agentRunning} selected={selected} onSelect={selectCandidate}
          onRun={startAgent} t={t} onApprove={() => setTab('dispatch')} />
      )}
      {tab === 'dispatch' && <DispatchPanel plan={plan} risk={risk} onNeedPlan={() => setTab('plan')} help={help}
        onHelp={async (id, status) => { await api.updateHelp(id, status); api.help().then(setHelp) }} onFocus={(lon, lat) => setFocus([lon, lat])} />}
      {tab === 'verify' && <VerifyPanel health={health} onFocus={(lon, lat) => setFocus([lon, lat])} />}
    </div>
  )
}
