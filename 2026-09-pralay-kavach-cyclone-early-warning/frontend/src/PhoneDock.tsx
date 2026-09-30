import { useEffect, useState } from 'react'
import { PhoneApp } from './Citizen'
import { PRESETS, type Place } from './places'

// The resident's phone docked in the console, so the whole Fani story plays in one window:
// approve the advisory on the left, and this phone rings.

const PHONE_W = 390, PHONE_H = 844, HEAD = 52, PAD = 12

function fit() {
  const avail = window.innerHeight - 92 - 20 - HEAD - PAD
  const scale = Math.max(0.55, Math.min(0.9, avail / PHONE_H))
  return { scale, width: Math.round(PHONE_W * scale) + PAD * 2 }
}

/** Scale and total width of the dock for the current window; the console uses the width to make room. */
export function useDockSize() {
  const [size, setSize] = useState(fit)
  useEffect(() => {
    const on = () => setSize(fit())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

export default function PhoneDock({ scale, width, onClose }: { scale: number; width: number; onClose: () => void }) {
  const [place, setPlace] = useState<Place>(PRESETS[0])
  const full = `/citizen?lat=${place.lat}&lon=${place.lon}&name=${encodeURIComponent(place.name)}`
  return (
    <aside className="phone-dock glass fade-in" style={{ width }} aria-label="Resident's phone">
      <div className="phone-dock-head">
        <span className="eyebrow">Resident's phone</span>
        <select value={place.name} aria-label="Where the resident is" onChange={(e) => setPlace(PRESETS.find((p) => p.name === e.target.value)!)}>
          {PRESETS.map((p) => <option key={p.name}>{p.name}</option>)}
        </select>
        <a href={full} target="_blank" rel="noreferrer" title="Open full screen" aria-label="Open the phone full screen">↗</a>
        <button onClick={onClose} aria-label="Hide the phone">×</button>
      </div>
      <div style={{ width: PHONE_W * scale, height: PHONE_H * scale, margin: '0 auto' }}>
        <div style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <PhoneApp place={place} onPlace={setPlace} replay />
        </div>
      </div>
    </aside>
  )
}
