import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { apiUrl, LANG_FONT, type Shelter } from './api'
import { dirName, fmtDist, t } from './i18n'
import type { Place } from './places'
import { speak } from './Sahayak'

// Walk me to the shelter: a real walking route, one big arrow, the next turn in the person's language, spoken aloud,
// and a warning before any stretch the forecast floods or residents reported under water.

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')
const STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

interface Step { type: string; modifier: string | null; name: string; distance_m: number; lon: number; lat: number }
interface Wet { lat: number; lon: number; at_m: number; depth_m: number; source: 'forecast' | 'report' }
interface Route { coords: [number, number][]; distance_m: number; duration_s: number; steps: Step[]; source: string; wet: Wet[] }

// Local metres around the start, good enough for a few kilometres.
function projector(lat0: number, lon0: number) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540
  return { to: (lon: number, lat: number) => [(lon - lon0) * kx, (lat - lat0) * ky], from: (x: number, y: number) => [lon0 + x / kx, lat0 + y / ky] }
}

function useLine(route: Route | null) {
  return useMemo(() => {
    if (!route) return null
    const [lon0, lat0] = route.coords[0]
    const P = projector(lat0, lon0)
    const pts = route.coords.map(([lon, lat]) => P.to(lon, lat))
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    const total = cum[cum.length - 1]
    /** Distance along the route of the closest point to (lon, lat). */
    const along = (lon: number, lat: number) => {
      const [x, y] = P.to(lon, lat)
      let best = Infinity, at = 0
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L))
        const d = Math.hypot(ax + u * dx - x, ay + u * dy - y)
        if (d < best) { best = d; at = cum[i - 1] + u * Math.sqrt(L) }
      }
      return { at, off: best }
    }
    /** The point at a given distance along the route. */
    const pointAt = (d: number) => {
      const s = Math.max(0, Math.min(total, d))
      let i = 1
      while (i < cum.length - 1 && cum[i] < s) i++
      const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)
      return P.from(pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])) as [number, number]
    }
    const steps = route.steps.map((s) => ({ ...s, at: along(s.lon, s.lat).at }))
    return { total, along, pointAt, steps }
  }, [route])
}

function bearing(a: [number, number], b: [number, number]) {
  const [lon1, lat1, lon2, lat2] = [a[0], a[1], b[0], b[1]].map((v) => (v * Math.PI) / 180)
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function phrase(lang: string, s: Step) {
  const m = s.modifier ?? ''
  const key = m.includes('uturn') ? 'uturn' : m.includes('slight left') ? 'slightLeft' : m.includes('slight right') ? 'slightRight'
    : m.includes('left') ? 'turnLeft' : m.includes('right') ? 'turnRight' : 'straight'
  return t(lang, key) + (s.name ? ` (${s.name})` : '')
}

/** Speak in the person's language; if the device has no voice for it, say the same thing in English. */
function say(lang: string, text: string, english: string) {
  if (!speak(text, lang) && lang !== 'en') speak(english, 'en')
}

export default function Navigate({ lang, from, shelter, replay, onBack, onArrived, onTellFamily }: {
  lang: string; from: Place; shelter: Shelter; replay: boolean
  onBack: () => void; onArrived: () => void; onTellFamily: () => void
}) {
  const [route, setRoute] = useState<Route | null>(null)
  const [err, setErr] = useState(false)
  const [pos, setPos] = useState<[number, number]>([from.lon, from.lat])
  const [walking, setWalking] = useState(false)
  const [arrived, setArrived] = useState(false)
  const line = useLine(route)
  const mapDiv = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const me = useRef<maplibregl.Marker | null>(null)
  const spoken = useRef<Set<string>>(new Set())
  const simAt = useRef(0)

  useEffect(() => {
    let live = true // ignore a stale answer (React runs this twice in development)
    fetch(apiUrl(`/api/guide/route?lat=${from.lat}&lon=${from.lon}&to_lat=${shelter.lat}&to_lon=${shelter.lon}`))
      .then((r) => (r.ok ? r.json() : Promise.reject())).then((r) => { if (live) setRoute(r) }).catch(() => { if (live) setErr(true) })
    return () => { live = false }
  }, [from.lat, from.lon, shelter.lat, shelter.lon])

  // Real GPS on a real phone, if it puts the person near the route; otherwise the walk is simulated on demand.
  useEffect(() => {
    if (replay || !line || !navigator.geolocation) return
    const id = navigator.geolocation.watchPosition((p) => {
      const here: [number, number] = [p.coords.longitude, p.coords.latitude]
      if (line.along(here[0], here[1]).off < 1500) setPos(here)
    }, () => {}, { enableHighAccuracy: true })
    return () => navigator.geolocation.clearWatch(id)
  }, [line, replay])

  // Map: the route, water on it, the shelter and the person.
  useEffect(() => {
    if (!route || !mapDiv.current || map.current) return
    const m = new maplibregl.Map({ container: mapDiv.current, style: STYLE, attributionControl: { compact: true }, interactive: true })
    map.current = m
    const draw = () => {
      if (m.getSource('route')) return
      m.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coords } } })
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#ffffff', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#1c7bc4', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addSource('wet', { type: 'geojson', data: { type: 'FeatureCollection', features: route.wet.map((w) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [w.lon, w.lat] } })) } })
      m.addLayer({ id: 'wet', type: 'circle', source: 'wet', paint: { 'circle-radius': 11, 'circle-color': '#d9412a', 'circle-opacity': 0.35, 'circle-stroke-color': '#d9412a', 'circle-stroke-width': 2 } })
    }
    // Draw as soon as the style is ready, however fast it loaded.
    if (m.isStyleLoaded()) draw(); else m.on('load', draw)
    const pin = document.createElement('div')
    pin.className = 'walk-shelter'
    pin.textContent = '🏫'
    new maplibregl.Marker({ element: pin }).setLngLat([shelter.lon, shelter.lat]).addTo(m)
    const dot = document.createElement('div')
    dot.className = 'walk-me'
    me.current = new maplibregl.Marker({ element: dot }).setLngLat(pos).addTo(m)
    const b = new maplibregl.LngLatBounds()
    route.coords.forEach((c) => b.extend(c))
    const fit = () => m.fitBounds(b, { padding: { top: 60, bottom: 70, left: 44, right: 44 }, duration: 0 })
    fit()
    m.once('idle', fit) // again once the phone layout has settled
    return () => { m.remove(); map.current = null }
  }, [route])

  useEffect(() => { me.current?.setLngLat(pos); if (walking) map.current?.easeTo({ center: pos, duration: 300 }) }, [pos])

  // Where am I on the route, what comes next.
  const at = line ? line.along(pos[0], pos[1]).at : 0
  const left = line ? Math.max(0, line.total - at) : 0
  const next = line?.steps.find((s) => s.at > at + 8 && s.type !== 'depart')
  const ahead = line ? line.pointAt(at + 30) : pos
  const heading = bearing(pos, ahead)
  const wetAhead = route?.wet.find((w) => w.at_m > at && w.at_m - at < 250)
  const toNext = next ? next.at - at : left
  const instruction = !next || next.type === 'arrive'
    ? t(lang, 'arriveSoon', { d: fmtDist(lang, left) })
    : `${t(lang, 'thenIn', { d: fmtDist(lang, toNext) })}, ${phrase(lang, next)}`

  // Voice: once at the start, before each turn, near water, and on arrival.
  useEffect(() => {
    if (!line || !route) return
    const once = (key: string, text: string, english: string) => {
      if (spoken.current.has(key)) return
      spoken.current.add(key)
      say(lang, text, english)
    }
    if (left < 15) {
      if (!arrived) { setArrived(true); setWalking(false) }
      once('arrive', t(lang, 'arrive', { name: shelter.name }), t('en', 'arrive', { name: shelter.name }))
      return
    }
    once('start', `${t(lang, 'toShelter', { name: shelter.name })}. ${t(lang, 'head', { dir: dirName(lang, heading) })}. ${instruction}`,
      `${t('en', 'toShelter', { name: shelter.name })}. ${t('en', 'head', { dir: dirName('en', heading) })}.`)
    if (wetAhead) {
      const k = wetAhead.source === 'report' ? 'water' : 'waterForecast'
      once(`wet${wetAhead.at_m}`, t(lang, k, { d: fmtDist(lang, wetAhead.at_m - at) }), t('en', k, { d: fmtDist('en', wetAhead.at_m - at) }))
    }
    if (next && next.type !== 'arrive') {
      if (toNext < 120 && toNext > 35) once(`soon${next.at}`, instruction, `${t('en', 'thenIn', { d: fmtDist('en', toNext) })}, ${phrase('en', next)}`)
      if (toNext <= 35) once(`now${next.at}`, phrase(lang, next), phrase('en', next))
    }
  }, [Math.round(at / 5), line])

  // Simulated walk for the replay and for demos: about 25 seconds from door to shelter.
  useEffect(() => {
    if (!walking || !line) return
    simAt.current = Math.max(simAt.current, at)
    const id = setInterval(() => {
      simAt.current = Math.min(line.total, simAt.current + Math.max(3, line.total / 220))
      setPos(line.pointAt(simAt.current))
    }, 110)
    return () => clearInterval(id)
  }, [walking, line])

  const font = LANG_FONT[lang]
  const maps = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${shelter.lat},${shelter.lon}&travelmode=walking`
  return (
    <div className="walk" style={{ fontFamily: font }}>
      <header>
        <button onClick={() => { window.speechSynthesis?.cancel(); onBack() }} aria-label={t(lang, 'back')} className="walk-back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#13181c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5 8 12l7 7" /></svg>
        </button>
        <span className="stack" style={{ gap: 2, minWidth: 0 }}>
          <b style={{ fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(lang, 'toShelter', { name: shelter.name })}</b>
          <span style={{ fontSize: 13, color: '#5f6a73' }}>
            {route ? `${fmtDist(lang, left)} · ${t(lang, 'walkMin', { n: Math.max(1, Math.round((left / Math.max(route.distance_m, 1)) * route.duration_s / 60)) })}` : '…'}
          </span>
        </span>
      </header>

      <div ref={mapDiv} className="walk-map">{err && <div className="walk-err">Route unavailable. <a href={maps} target="_blank" rel="noreferrer">{t(lang, 'openMaps')}</a></div>}</div>

      <div className="walk-card">
        {arrived ? (
          <div className="stack" style={{ gap: 10 }}>
            <div style={{ fontSize: 34 }}>🏫</div>
            <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.35 }}>{t(lang, 'arrive', { name: shelter.name })}</div>
            <button className="primary" onClick={onArrived}>✓ {t(lang, 'reached')}</button>
            <button className="pill-btn" style={{ height: 50 }} onClick={onTellFamily}>💬 {t(lang, 'tellFamily')}</button>
          </div>
        ) : (
          <>
            <div className="row" style={{ gap: 14, alignItems: 'center' }}>
              <div className="walk-arrow" style={{ transform: `rotate(${heading}deg)` }} aria-label={t(lang, 'head', { dir: dirName(lang, heading) })}>
                <svg width="46" height="46" viewBox="0 0 24 24"><path d="M12 2 20 21 12 16.5 4 21Z" fill="#fff" /></svg>
              </div>
              <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.3 }}>{instruction}</div>
                <div style={{ fontSize: 14, color: '#5f6a73' }}>{t(lang, 'head', { dir: dirName(lang, heading) })}</div>
              </div>
            </div>
            {wetAhead ? (
              <div className="walk-wet">🌊 {t(lang, wetAhead.source === 'report' ? 'water' : 'waterForecast', { d: fmtDist(lang, wetAhead.at_m - at) })}</div>
            ) : route && (
              <div className="walk-dry">{route.wet.some((w) => w.at_m > at) ? t(lang, 'routeWet') : `✓ ${t(lang, 'routeDry')}`}</div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button className="primary" style={{ flex: 1 }} disabled={!line} onClick={() => setWalking(!walking)}>
                {walking ? `⏸ ${t(lang, 'pause')}` : `🚶 ${t(lang, 'simulate')}`}
              </button>
              <button className="pill-btn" style={{ height: 54, width: 54, padding: 0, fontSize: 20 }} aria-label={t(lang, 'listen')}
                onClick={() => say(lang, instruction, next ? phrase('en', next) : t('en', 'arriveSoon', { d: fmtDist('en', left) }))}>🔊</button>
            </div>
            <a href={maps} target="_blank" rel="noreferrer" className="walk-maps">{t(lang, 'openMaps')} ↗</a>
          </>
        )}
      </div>
    </div>
  )
}
