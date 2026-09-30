export type LngLat = [number, number]

export interface LlmInfo {
  provider: 'gemini' | 'anthropic' | 'mock'
  model: string
  label: string
  fallback?: boolean
  error?: string
}

export interface Health {
  llm: LlmInfo
  data: Record<string, boolean>
  replay: { t_min: number; t_max: number; landfall: string }
}

export interface StormState {
  t_rel: number
  time: string
  landfall_time: string
  landfall_point: LngLat
  center: LngLat
  wind_kmh: number
  pressure_hpa: number
  landfall_wind_kmh: number
  category: string
  landfall_category: string
  track_spread_km: number
  observed: LngLat[]
  forecast: LngLat[]
  forecast_points: { lead_h: number; lon: number; lat: number; time: string }[]
  cone: LngLat[]
  source: string
}

export interface Asset {
  id: string
  kind: 'hospital' | 'substation' | 'shelter'
  name: string
  lat: number
  lon: number
  district: string
  proxy: boolean
  depth_m?: number
  wind_kmh?: number
  hazard?: string
  action?: string
}

export interface Candidate {
  id: number
  name: string
  name_or?: string | null
  district: string
  lat: number
  lon: number
  people_total: number
  people_at_risk: number
  people_flooded: number
  peak_depth_m: number
  peak_wind_kmh: number
  coast_km: number
  hazard: string
  gales_from_h: number | null
  water_arrives_h: number | null
  leave_by_h: number
  shelter: (Asset & { distance_km: number }) | null
  route: string
  rank?: number
  reason?: string
}

export interface Risk {
  scenario: string
  max_level_m: number
  flooded_km2: number
  people_in_flood_zone: number
  people_in_wind_zone: number
  people_to_evacuate: number
  thresholds: { destructive_wind_kmh: number; wind_evac_coast_km: number; extreme_wind_kmh: number }
  counts: { hospitals: number; substations: number; shelters_flooded: number; villages: number; road_km_cut: number }
  assets_at_risk: Asset[]
  candidates: Candidate[]
  cut_roads: { ref: string; class: string; coords: LngLat[] }[]
  districts: { district: string; people_at_risk: number; villages: number; earliest_leave_by_h: number }[]
  waterlogging: { villages: number; people: number; km2: number } | null
}

export interface Plan {
  t_rel: number
  status: string
  assessment: {
    storm?: string
    category?: string
    landfall?: { place?: string; time_ist?: string; category?: string; wind_kmh?: number }
    satellite_read?: string
    key_risks?: string[]
  }
  bulletin: string
  scenarios: { scenario: string; max_level_m: number; flooded_km2: number; people_in_flood_zone: number }[]
  ranked: Candidate[]
  harden: Asset[]
  summary: string
  confidence: string
  confidence_note: string
  counts: Risk['counts']
  people_in_flood_zone: number
  people_to_evacuate: number
  people_in_wind_zone: number
  districts: Risk['districts']
  llm: LlmInfo
}

export interface AgentStep {
  type: 'step'
  id: string
  title: string
  status: 'running' | 'done'
  detail: string
  llm?: LlmInfo
  seconds?: number
}

export interface AdvisoryText {
  headline: string | null
  body: string | null
  back_translation: string | null
  unavailable?: string
  template?: boolean
}

export interface Advisory {
  id: string
  district: string
  languages: string[]
  texts: Record<string, AdvisoryText>
  llm: LlmInfo
  facts: { landfall_ist: string; leave_by_ist: string; villages: string[]; wind_kmh: number }
  status: 'draft' | 'awaiting_second_approval' | 'dispatched'
  approvals: { by: string; at: number }[]
  cap: string
}

export interface Shelter {
  id: string
  name: string
  lat: number
  lon: number
  proxy: boolean
  distance_km: number
  route: string
  floods_at_h: number | null
  rerouted?: boolean
  previous?: string
}

export interface Report {
  id: string
  lat: number
  lon: number
  time: number
  district: string
  reported_level: string
  verified_level: string
  verified_depth_m: number
  model_depth_m: number
  matches_model: boolean
  notes: string
  llm: LlmInfo
}

export interface FloodedVillage { id: number; name: string; district: string; lat: number; lon: number; people: number; water_km2: number }

export interface HelpRequest {
  id: string; time: number; lat: number; lon: number; district: string; need: string; people: number | null
  note: string; lang: string; said: string; status: 'open' | 'dispatched' | 'resolved'
}

export interface Verify {
  hindcast:
    | { available: false; message: string }
    | {
        available: true
        satellite: {
          date: string; sensor: string; observed_km2: number; villages: number; people_in_villages: number
          top_villages: FloodedVillage[]
          by_district: { district: string; villages: number; people: number; water_km2: number }[]
        }
        surge_check: { checkable: boolean; text: string }
        waterlogging_check: { method: string; land_flagged: number; flooding_caught: number; lift: number } | null
        evacuation_check: { model_people: number | null; people: number; text: string; source: string }
      }
  parametric: {
    threshold_kmh: number
    insured_units: number
    triggered_units: number
    sum_insured_per_unit_inr: number
    payout_inr: number
    by_district: { district: string; villages: number; triggered: number; peak_wind_kmh: number; payout_inr: number }[]
    note: string
  }
  flood_payout: { trigger: string; villages: number; per_village_inr: number; payout_inr: number } | null
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    throw new Error(detail.detail || `${r.status}`)
  }
  return r.json()
}

export const api = {
  health: () => get<Health>('/api/health'),
  storm: (t: number) => get<StormState>(`/api/storm?t=${t}`),
  meta: () => get<{ flood_corners: LngLat[]; satellite_corners: LngLat[]; bbox: number[] }>('/api/layers/meta'),
  risk: (t: number, scenario: string) => get<Risk>(`/api/risk?t=${t}&scenario=${scenario}`),
  plan: () => get<Plan>('/api/plan'),
  makeAdvisory: (district: string) => post<Advisory>('/api/advisory', { district }),
  approve: (district: string, approver: string) => post<Advisory>(`/api/advisory/${district}/approve`, { approver }),
  advisories: () => get<Advisory[]>('/api/advisories'),
  verify: (scenario = 'likely') => get<Verify>(`/api/verify?scenario=${scenario}`),
  feed: (lat: number, lon: number) =>
    get<{ district: string; alerts: Advisory[]; shelter: Shelter | null; reports: Report[] }>(`/api/citizen/feed?lat=${lat}&lon=${lon}`),
  reports: () => get<Report[]>('/api/reports'),
  report: async (lat: number, lon: number, depth: string, photo?: File | null, home?: { lat: number; lon: number }) => {
    const fd = new FormData()
    fd.append('lat', String(lat))
    fd.append('lon', String(lon))
    if (home) {
      fd.append('home_lat', String(home.lat))
      fd.append('home_lon', String(home.lon))
    }
    fd.append('depth', depth)
    if (photo) fd.append('photo', photo)
    const r = await fetch('/api/citizen/report', { method: 'POST', body: fd })
    if (!r.ok) throw new Error(await r.text())
    return (await r.json()) as { report: Report; shelter: Shelter | null }
  },
  help: () => get<HelpRequest[]>('/api/help'),
  updateHelp: (id: string, status: string) => post<HelpRequest>(`/api/help/${id}`, { status }),
  floodUrl: (t: number, scenario: string) => `/api/layers/flood.png?t=${t}&scenario=${scenario}`,
}

export function runAgent(t: number, onEvent: (ev: any) => void): () => void {
  const es = new EventSource(`/api/agent/run?t=${t}`)
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data)
    onEvent(ev)
    if (ev.type === 'plan') es.close()
  }
  es.onerror = () => {
    onEvent({ type: 'error' })
    es.close()
  }
  return () => es.close()
}

export const fmtT = (h: number) => (h === 0 ? 'Landfall' : `T${h > 0 ? '+' : '−'}${Math.abs(h)}h`)
export const fmtInt = (n: number) => n.toLocaleString('en-IN')
export const LANG_LABEL: Record<string, string> = { en: 'English', or: 'ଓଡ଼ିଆ', te: 'తెలుగు', bn: 'বাংলা', ta: 'தமிழ்' }
export const LANG_FONT: Record<string, string> = {
  or: "'Noto Sans Oriya', sans-serif",
  te: "'Noto Sans Telugu', sans-serif",
  bn: "'Noto Sans Bengali', sans-serif",
  ta: "'Noto Sans Tamil', sans-serif",
}

export interface SatLayer { layer: string; label: string; note: string; time: string; maxzoom: number; tiles: string }
export interface LiveStorm {
  id: number; name: string; alert: string; from: string; to: string; current: boolean
  lon: number; lat: number; severity: string; max_wind_kmh: number; countries: string; report?: string
  geometry?: GeoJSON.FeatureCollection | null
}
export interface Genesis { first_seen: string; lat: number; lon: number; min_pressure_hpa: number; max_wind_kmh: number; path: LngLat[]; hours_seen: number }
export interface LiveOverview {
  model_time: string; fetched: string; model: string
  max_sea_wind_now_kmh: number; max_sea_gust_72h_kmh: number; min_pressure_72h_hpa: number
  sst: { mean_c: number | null; max_c: number | null; fuel: string | null; note: string; error?: string }
  storms: { active: LiveStorm[]; recent: LiveStorm[]; source: string; checked: string; error?: string }
  genesis: Genesis[]
  satellites: Record<string, SatLayer>
  official: { text: string; imd: string; osdma: string }
  stale?: Record<string, number>
}
export interface WindField { times: string[]; lats: number[]; lons: number[]; u: number[][][]; v: number[][][]; pressure: number[][][]; fetched: string; model: string }
export interface Outlook {
  level: 'clear' | 'watch' | 'danger'; headline: string; reasons: string[]
  now: { wind_kmh: number; gust_kmh: number; direction_deg: number; rain_mm: number; pressure_hpa: number; temp_c: number }
  hourly: { time: string[]; gust_kmh: number[]; rain_mm: number[] }
  nearest_storm: { name: string; distance_km: number; severity: string; alert: string } | null
  forming: Genesis[]
  official: string
}

export interface Backtest {
  method: string
  thresholds: { pressure_hpa_max: number; wind_kmh_min: number; match_km: number }
  storms: { storm: string; first_tracked: string; landfall: string | null; spotted: boolean; days_before_landfall?: number;
    days_before_first_tracked?: number; earliest_forecast_issued?: string; lead_days_used?: number; split?: 'train' | 'test' }[]
  false_alarm_checks: { window: string; lead_days: number; flagged: number; false_alarms: number }[]
  baseline?: Record<'train' | 'test', { flagged: number; false_alarms: number }>
}

export const liveApi = {
  backtest: () => get<Backtest>('/api/live/backtest'),
  overview: () => get<LiveOverview>('/api/live/overview'),
  wind: () => get<WindField>('/api/live/wind'),
  outlook: (lat: number, lon: number) => get<Outlook>(`/api/live/outlook?lat=${lat}&lon=${lon}`),
}
