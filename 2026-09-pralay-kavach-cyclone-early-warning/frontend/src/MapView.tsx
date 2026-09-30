/// <reference types="geojson" />
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, ImageSource, MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import type { Asset, Candidate, LngLat, Report, StormState } from './api'

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
// MapLibre v6 loads its worker as a separate ES module; bundlers don't emit it, so serve a copy
// (see the copy-maplibre-worker script) and point MapLibre at it.
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export interface MapProps {
  storm: StormState | null
  showTrack: boolean
  showCone?: boolean
  floodUrl: string | null
  floodCorners: LngLat[] | null
  satellite: boolean
  satelliteCorners: LngLat[] | null
  observedUrl: string | null
  waterlogUrl?: string | null
  baseAssets: Asset[]
  atRisk: Asset[]
  cutRoads: { coords: LngLat[] }[]
  candidates: Candidate[]
  selectedCandidate: number | null
  reports: Report[]
  focus: LngLat | null
  fitTo?: LngLat[] | null
  dim?: boolean
  onSelectCandidate?: (id: number) => void
  onMap?: (m: maplibregl.Map) => void
  satTiles?: { id: string; tiles: string; maxzoom: number; opacity?: number } | null
  liveStorms?: GeoJSON.FeatureCollection | null
  genesis?: { lon: number; lat: number; path: [number, number][]; label: string }[]
  help?: { id: string; lat: number; lon: number; need: string; note: string; status: string; district: string }[]
}

const pt = (lon: number, lat: number, props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: props,
})

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

export default function MapView(p: MapProps) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const onSelect = useRef(p.onSelectCandidate)
  onSelect.current = p.onSelectCandidate

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: STYLE,
      center: [85.95, 19.95],
      zoom: 7.1,
      attributionControl: { compact: true },
    })
    map.current = m
    m.on('load', () => {
      const add = (id: string, data = EMPTY) => m.addSource(id, { type: 'geojson', data })
      m.addSource('satellite', { type: 'image', url: TRANSPARENT_PNG, coordinates: [[80, 25], [92, 25], [92, 13], [80, 13]] })
      m.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-opacity': 0.75 }, layout: { visibility: 'none' } })
      m.addSource('flood', { type: 'image', url: TRANSPARENT_PNG, coordinates: [[84, 22], [88, 22], [88, 18], [84, 18]] })
      m.addLayer({ id: 'flood', type: 'raster', source: 'flood', paint: { 'raster-opacity': 0.95, 'raster-resampling': 'nearest' }, layout: { visibility: 'none' } })
      m.addSource('waterlog', { type: 'image', url: TRANSPARENT_PNG, coordinates: [[84, 22], [88, 22], [88, 18], [84, 18]] })
      m.addLayer({ id: 'waterlog', type: 'raster', source: 'waterlog', paint: { 'raster-opacity': 0.85 }, layout: { visibility: 'none' } })
      m.addSource('observed', { type: 'image', url: TRANSPARENT_PNG, coordinates: [[84, 22], [88, 22], [88, 18], [84, 18]] })
      m.addLayer({ id: 'observed', type: 'raster', source: 'observed', paint: { 'raster-opacity': 0.95 }, layout: { visibility: 'none' } })

      add('cone')
      m.addLayer({ id: 'cone-fill', type: 'fill', source: 'cone', paint: { 'fill-color': '#ff8a4c', 'fill-opacity': 0.13 } })
      m.addLayer({ id: 'cone-line', type: 'line', source: 'cone', paint: { 'line-color': '#ff8a4c', 'line-opacity': 0.55, 'line-width': 1.2, 'line-dasharray': [3, 3] } })
      add('observed-track')
      m.addLayer({ id: 'observed-track', type: 'line', source: 'observed-track', paint: { 'line-color': '#ff8a4c', 'line-width': 3 }, layout: { 'line-cap': 'round' } })
      add('forecast-track')
      m.addLayer({ id: 'forecast-glow', type: 'line', source: 'forecast-track', paint: { 'line-color': '#ff8a4c', 'line-width': 10, 'line-opacity': 0.25, 'line-blur': 6 } })
      m.addLayer({ id: 'forecast-track', type: 'line', source: 'forecast-track', paint: { 'line-color': '#ffb48a', 'line-width': 2, 'line-dasharray': [2, 2] } })
      add('forecast-points')
      m.addLayer({ id: 'forecast-points', type: 'circle', source: 'forecast-points', paint: { 'circle-radius': 5, 'circle-color': '#07131d', 'circle-stroke-color': '#ffb48a', 'circle-stroke-width': 2 } })
      m.addLayer({ id: 'forecast-labels', type: 'symbol', source: 'forecast-points', layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [1.1, 0], 'text-anchor': 'left', 'text-font': ['Montserrat Regular', 'Open Sans Regular', 'Noto Sans Regular'] }, paint: { 'text-color': '#ffd2b6', 'text-halo-color': '#07131d', 'text-halo-width': 1.5 } })
      add('landfall')
      m.addLayer({ id: 'landfall-ring', type: 'circle', source: 'landfall', paint: { 'circle-radius': 18, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ffffff', 'circle-stroke-opacity': 0.5, 'circle-stroke-width': 1.5 } })
      m.addLayer({ id: 'landfall-dot', type: 'circle', source: 'landfall', paint: { 'circle-radius': 5, 'circle-color': '#ffffff' } })
      add('storm')
      m.addLayer({ id: 'storm-halo', type: 'circle', source: 'storm', paint: { 'circle-radius': 60, 'circle-color': '#ffffff', 'circle-opacity': 0.12, 'circle-blur': 1 } })
      m.addLayer({ id: 'storm-dot', type: 'circle', source: 'storm', paint: { 'circle-radius': 9, 'circle-color': '#07131d', 'circle-stroke-color': '#ff8a4c', 'circle-stroke-width': 3 } })

      add('cut-roads')
      m.addLayer({ id: 'cut-roads', type: 'line', source: 'cut-roads', paint: { 'line-color': '#ff6b4a', 'line-width': 3, 'line-dasharray': [2, 1.5] } })
      add('base-assets')
      m.addLayer({
        id: 'base-assets', type: 'circle', source: 'base-assets',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 11, 4],
          'circle-color': ['match', ['get', 'kind'], 'shelter', '#6fd3ff', 'hospital', '#c8d2d9', '#7f91a0'],
          'circle-opacity': 0.55,
        },
      })
      add('at-risk')
      m.addLayer({ id: 'at-risk-glow', type: 'circle', source: 'at-risk', paint: { 'circle-radius': 12, 'circle-color': '#ff6b4a', 'circle-opacity': 0.25, 'circle-blur': 1 } })
      m.addLayer({
        id: 'at-risk', type: 'circle', source: 'at-risk',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 4.5, 11, 8],
          'circle-color': ['match', ['get', 'kind'], 'hospital', '#ff6b4a', 'substation', '#c79bff', '#ffcb6b'],
          'circle-stroke-opacity': ['case', ['==', ['get', 'hazard'], 'wind'], 0.6, 1],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
        },
      })
      add('candidates')
      m.addLayer({
        id: 'candidates', type: 'circle', source: 'candidates',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 11, 7],
          'circle-color': ['case', ['get', 'selected'], '#ff8a4c', '#ffffff'],
          'circle-stroke-color': ['case', ['get', 'selected'], '#ffffff', '#ff8a4c'],
          'circle-stroke-width': 2,
        },
      })
      m.addLayer({ id: 'candidate-labels', type: 'symbol', source: 'candidates', layout: { 'text-field': ['get', 'rank'], 'text-size': 10, 'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'], 'text-allow-overlap': true }, paint: { 'text-color': ['case', ['get', 'selected'], '#ffffff', '#1b0b03'] } })
      add('reports')
      m.addLayer({ id: 'reports-halo', type: 'circle', source: 'reports', paint: { 'circle-radius': 16, 'circle-color': '#6fd3ff', 'circle-opacity': 0.25 } })
      m.addLayer({ id: 'reports', type: 'circle', source: 'reports', paint: { 'circle-radius': 6, 'circle-color': '#6fd3ff', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } })

      const popup = (layer: string, html: (props: any) => string) => {
        m.on('click', layer, (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          if (!f) return
          new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setHTML(html(f.properties)).addTo(m)
        })
        m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'))
        m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''))
      }
      popup('at-risk', (q) => `
        <div class="eyebrow" style="color:#ffb29c">${esc(q.kind)} · ${q.hazard === 'wind' ? q.wind_kmh + ' km/h wind' : q.depth_m + ' m water'}</div>
        <div style="font-family:var(--serif);font-size:20px;line-height:24px;margin:6px 0">${esc(q.name)}</div>
        <div class="small muted">${esc(q.district)} district${q.proxy === true || q.proxy === 'true' ? ' · school used as shelter' : ''}</div>`)
      popup('reports', (q) => `
        <div class="eyebrow" style="color:#a5e4ff">Citizen report · ${esc(q.verified_level)}</div>
        <div style="margin:6px 0;font-size:14px">${esc(q.notes || '')}</div>
        <div class="small muted">Model depth here: ${q.model_depth_m} m · ${q.matches_model === true || q.matches_model === 'true' ? 'matches model' : 'differs from model'}</div>`)
      m.on('click', 'candidates', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id
        if (id != null) onSelect.current?.(Number(id))
      })
      m.on('mouseenter', 'candidates', () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', 'candidates', () => (m.getCanvas().style.cursor = ''))
      add('live-storms')
      m.addLayer({ id: 'live-storm-zones', type: 'fill', source: 'live-storms', filter: ['in', 'Poly_', ['get', 'Class']],
        paint: { 'fill-color': ['match', ['get', 'Class'], 'Poly_Red', '#ff6b4a', 'Poly_Orange', '#ffcb6b', 'Poly_Green', '#6fd3ff', '#ff8a4c'],
          'fill-opacity': ['match', ['get', 'Class'], 'Poly_Cones', 0.08, 0.18] } })
      m.addLayer({ id: 'live-storm-track', type: 'line', source: 'live-storms', filter: ['in', 'Line_', ['get', 'Class']],
        paint: { 'line-color': '#ffb48a', 'line-width': 2.5 } })
      add('genesis')
      m.addLayer({ id: 'genesis-path', type: 'line', source: 'genesis', filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#ffcb6b', 'line-width': 2, 'line-dasharray': [2, 2] } })
      m.addLayer({ id: 'genesis-halo', type: 'circle', source: 'genesis', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 26, 'circle-color': '#ffcb6b', 'circle-opacity': 0.18, 'circle-stroke-color': '#ffcb6b', 'circle-stroke-width': 1.5 } })
      m.addLayer({ id: 'genesis-label', type: 'symbol', source: 'genesis', filter: ['==', ['geometry-type'], 'Point'],
        layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 2.6], 'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'] },
        paint: { 'text-color': '#ffd98f', 'text-halo-color': '#07131d', 'text-halo-width': 1.5 } })
      add('help')
      m.addLayer({ id: 'help-halo', type: 'circle', source: 'help', paint: { 'circle-radius': 22, 'circle-color': '#ff3b30', 'circle-opacity': 0.22, 'circle-blur': 0.4 } })
      m.addLayer({ id: 'help', type: 'circle', source: 'help', paint: { 'circle-radius': 8, 'circle-color': '#ff3b30', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } })
      m.addLayer({ id: 'help-label', type: 'symbol', source: 'help', layout: { 'text-field': 'SOS', 'text-size': 10, 'text-offset': [0, -1.8], 'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'] },
        paint: { 'text-color': '#ffb3ad', 'text-halo-color': '#07131d', 'text-halo-width': 1.5 } })
      popup('help', (q) => `
        <div class="eyebrow" style="color:#ffb3ad">SOS · ${esc(q.need)} · ${esc(q.district)}</div>
        <div style="margin:6px 0;font-size:14px">${esc(q.note || '')}</div>
        <div class="small muted">Status: ${esc(q.status)}</div>`)
      setReady(true)
      p.onMap?.(m)
    })
    return () => m.remove()
  }, [])

  const src = (id: string) => map.current?.getSource(id) as GeoJSONSource | undefined
  const vis = (ids: string[], on: boolean) => ids.forEach((id) => map.current?.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'))

  useEffect(() => {
    if (!ready) return
    const s = p.storm
    const on = p.showTrack && !!s
    vis(['cone-fill', 'cone-line'], on && p.showCone !== false)
    vis(['observed-track', 'forecast-glow', 'forecast-track', 'forecast-points', 'forecast-labels', 'landfall-ring', 'landfall-dot', 'storm-halo', 'storm-dot'], on)
    if (!s) return
    src('cone')?.setData({ type: 'FeatureCollection', features: s.cone.length > 3 ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [s.cone] }, properties: {} }] : [] })
    src('observed-track')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.observed }, properties: {} })
    src('forecast-track')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.forecast }, properties: {} })
    src('forecast-points')?.setData({ type: 'FeatureCollection', features: s.forecast_points.map((f) => pt(f.lon, f.lat, { label: `+${f.lead_h}h` })) })
    src('landfall')?.setData({ type: 'FeatureCollection', features: [pt(...s.landfall_point)] })
    src('storm')?.setData({ type: 'FeatureCollection', features: [pt(...s.center)] })
  }, [ready, p.storm, p.showTrack, p.showCone])

  useEffect(() => {
    if (!ready) return
    const img = map.current!.getSource('flood') as ImageSource
    if (p.floodUrl && p.floodCorners) img.updateImage({ url: p.floodUrl, coordinates: p.floodCorners as any })
    vis(['flood'], !!p.floodUrl)
  }, [ready, p.floodUrl, p.floodCorners])

  useEffect(() => {
    if (!ready) return
    const img = map.current!.getSource('observed') as ImageSource
    if (p.observedUrl && p.floodCorners) img.updateImage({ url: p.observedUrl, coordinates: p.floodCorners as any })
    vis(['observed'], !!p.observedUrl)
  }, [ready, p.observedUrl, p.floodCorners])

  useEffect(() => {
    if (!ready) return
    const img = map.current!.getSource('waterlog') as ImageSource
    if (p.waterlogUrl && p.floodCorners) img.updateImage({ url: p.waterlogUrl, coordinates: p.floodCorners as any })
    vis(['waterlog'], !!p.waterlogUrl)
  }, [ready, p.waterlogUrl, p.floodCorners])

  useEffect(() => {
    if (!ready || !p.satelliteCorners) return
    const img = map.current!.getSource('satellite') as ImageSource
    if (p.satellite) img.updateImage({ url: '/api/layers/satellite.jpg', coordinates: p.satelliteCorners as any })
    vis(['satellite'], p.satellite)
  }, [ready, p.satellite, p.satelliteCorners])

  useEffect(() => {
    if (!ready) return
    src('base-assets')?.setData({ type: 'FeatureCollection', features: p.baseAssets.map((a) => pt(a.lon, a.lat, { kind: a.kind })) })
    src('at-risk')?.setData({ type: 'FeatureCollection', features: p.atRisk.map((a) => pt(a.lon, a.lat, a as any)) })
    src('cut-roads')?.setData({
      type: 'FeatureCollection',
      features: p.cutRoads.map((r) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.coords }, properties: {} })),
    })
  }, [ready, p.baseAssets, p.atRisk, p.cutRoads])

  useEffect(() => {
    if (!ready) return
    src('candidates')?.setData({
      type: 'FeatureCollection',
      features: p.candidates.map((c) => pt(c.lon, c.lat, { id: c.id, rank: String(c.rank ?? ''), selected: c.id === p.selectedCandidate })),
    })
  }, [ready, p.candidates, p.selectedCandidate])

  useEffect(() => {
    if (!ready) return
    src('reports')?.setData({ type: 'FeatureCollection', features: p.reports.map((r) => pt(r.lon, r.lat, r as any)) })
  }, [ready, p.reports])

  useEffect(() => {
    if (!ready || !p.fitTo || p.fitTo.length < 2) return
    const lons = p.fitTo.map((c) => c[0])
    const lats = p.fitTo.map((c) => c[1])
    map.current!.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: { top: 130, bottom: 190, left: 80, right: 480 }, duration: 1200, maxZoom: 8.5 })
  }, [ready, JSON.stringify(p.fitTo)])

  useEffect(() => {
    if (!ready) return
    const m = map.current!
    if (m.getLayer('sat-live')) m.removeLayer('sat-live')
    if (m.getSource('sat-live')) m.removeSource('sat-live')
    if (!p.satTiles) return
    m.addSource('sat-live', { type: 'raster', tiles: [p.satTiles.tiles], tileSize: 256, maxzoom: p.satTiles.maxzoom,
      attribution: 'NASA GIBS' })
    m.addLayer({ id: 'sat-live', type: 'raster', source: 'sat-live', paint: { 'raster-opacity': p.satTiles.opacity ?? 0.8 } }, 'satellite')
  }, [ready, p.satTiles?.id, p.satTiles?.tiles])

  useEffect(() => {
    if (!ready) return
    src('help')?.setData({ type: 'FeatureCollection', features: (p.help ?? []).filter((h) => h.status !== 'resolved').map((h) => pt(h.lon, h.lat, h as any)) })
  }, [ready, p.help])

  useEffect(() => {
    if (!ready) return
    src('live-storms')?.setData(p.liveStorms ?? EMPTY)
  }, [ready, p.liveStorms])

  useEffect(() => {
    if (!ready) return
    const feats: GeoJSON.Feature[] = []
    for (const g of p.genesis ?? []) {
      feats.push(pt(g.lon, g.lat, { label: g.label }))
      if (g.path.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: g.path }, properties: {} })
    }
    src('genesis')?.setData({ type: 'FeatureCollection', features: feats })
  }, [ready, p.genesis])

  useEffect(() => {
    if (ready && p.focus) map.current!.flyTo({ center: p.focus, zoom: Math.max(map.current!.getZoom(), 9.5), duration: 1200 })
  }, [ready, p.focus])

  return <div ref={el} className={`map${p.dim ? ' dim' : ''}`} />
}
