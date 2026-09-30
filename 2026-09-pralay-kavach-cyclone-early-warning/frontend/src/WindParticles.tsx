import type { Map as MLMap } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import type { WindField } from './api'

// Animated wind flow: particles drift with the model wind (like earth.nullschool / windy),
// drawn on a canvas over the map. Colour and trail brightness follow wind speed.

const N = 4200
const MAX_AGE = 90

function sample(f: WindField, frame: number, lon: number, lat: number): [number, number] | null {
  const { lats, lons } = f
  const fx = (lon - lons[0]) / (lons[1] - lons[0])
  const fy = (lat - lats[0]) / (lats[1] - lats[0])
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  if (x0 < 0 || y0 < 0 || x0 >= lons.length - 1 || y0 >= lats.length - 1) return null
  const tx = fx - x0, ty = fy - y0
  const U = f.u[frame], V = f.v[frame]
  const bl = (G: number[][]) =>
    G[y0][x0] * (1 - tx) * (1 - ty) + G[y0][x0 + 1] * tx * (1 - ty) + G[y0 + 1][x0] * (1 - tx) * ty + G[y0 + 1][x0 + 1] * tx * ty
  return [bl(U), bl(V)]
}

function colour(speed: number) {
  // km/h: calm blue-grey -> cyan -> amber -> ember -> white-hot
  if (speed < 15) return 'rgba(150,180,200,0.55)'
  if (speed < 30) return 'rgba(111,211,255,0.75)'
  if (speed < 50) return 'rgba(165,228,255,0.9)'
  if (speed < 70) return 'rgba(255,203,107,0.95)'
  if (speed < 100) return 'rgba(255,138,76,1)'
  return 'rgba(255,240,230,1)'
}

export default function WindParticles({ map, field, frame }: { map: MLMap | null; field: WindField | null; frame: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef({ field, frame })
  state.current = { field, frame }

  useEffect(() => {
    if (!map || !canvas.current) return
    const c = canvas.current
    const ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      const r = map.getContainer().getBoundingClientRect()
      c.width = r.width * dpr
      c.height = r.height * dpr
      c.style.width = `${r.width}px`
      c.style.height = `${r.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ps: { lon: number; lat: number; age: number }[] = []
    const spawn = (p?: { lon: number; lat: number; age: number }) => {
      const f = state.current.field
      const b = map.getBounds()
      const lon0 = Math.max(b.getWest(), f ? f.lons[0] : 76), lon1 = Math.min(b.getEast(), f ? f.lons[f.lons.length - 1] : 100)
      const lat0 = Math.max(b.getSouth(), f ? f.lats[0] : 0), lat1 = Math.min(b.getNorth(), f ? f.lats[f.lats.length - 1] : 27)
      const q = p ?? { lon: 0, lat: 0, age: 0 }
      q.lon = lon0 + Math.random() * Math.max(lon1 - lon0, 0.1)
      q.lat = lat0 + Math.random() * Math.max(lat1 - lat0, 0.1)
      q.age = Math.floor(Math.random() * MAX_AGE)
      return q
    }
    for (let i = 0; i < N; i++) ps.push(spawn())
    const clear = () => ctx.clearRect(0, 0, c.width, c.height)
    const onMove = () => { clear(); ps.forEach((p) => spawn(p)) }
    map.on('movestart', clear)
    map.on('moveend', onMove)
    map.on('resize', () => { resize(); onMove() })

    let raf = 0
    const tick = () => {
      const { field: f, frame: fr } = state.current
      // Fade previous trails.
      ctx.globalCompositeOperation = 'destination-in'
      ctx.fillStyle = 'rgba(0,0,0,0.9)'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.globalCompositeOperation = 'source-over'
      if (f) {
        const scale = 0.0009 * Math.pow(2, 7 - map.getZoom()) // degrees per km/h per frame
        ctx.lineWidth = 1.3
        for (const p of ps) {
          const w = p.age++ > MAX_AGE ? null : sample(f, fr, p.lon, p.lat)
          if (!w) { spawn(p); continue }
          const [u, v] = w
          const speed = Math.hypot(u, v)
          const a = map.project([p.lon, p.lat])
          p.lon += (u * scale) / Math.cos((p.lat * Math.PI) / 180)
          p.lat += v * scale
          const b2 = map.project([p.lon, p.lat])
          ctx.strokeStyle = colour(speed)
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b2.x, b2.y)
          ctx.stroke()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      map.off('movestart', clear)
      map.off('moveend', onMove)
    }
  }, [map])

  return <canvas ref={canvas} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }} />
}
