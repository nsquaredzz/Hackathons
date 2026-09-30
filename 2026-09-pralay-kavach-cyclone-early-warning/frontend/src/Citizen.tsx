import { useEffect, useMemo, useRef, useState } from 'react'
import { api, apiUrl, LANG_FONT, liveApi, type Advisory, type Outlook, type Report, type Shelter } from './api'
import { loadProfile, NEEDS_VEHICLE, saveProfile, suggestLang, t, type Profile } from './i18n'
import Navigate from './Navigate'
import Onboarding from './Onboarding'
import { GustBars } from './Live'
import Sahayak from './Sahayak'
import { prefetchSpeech, speak as sayAloud } from './voice'

export { PRESETS, type Place } from './places'
import { PRESETS, type Place } from './places'
const DEPTHS = [['ankle', 'Ankle'], ['knee', 'Knee'], ['waist', 'Waist'], ['higher', 'Higher']] as const
export default function Citizen() {
  const params = new URLSearchParams(location.search)
  const initial = params.get('lat')
    ? { name: params.get('name') ?? 'Your village', lat: Number(params.get('lat')), lon: Number(params.get('lon')) }
    : PRESETS[0]
  const [place, setPlace] = useState(initial)
  const [places, setPlaces] = useState(params.get('lat') ? [initial, ...PRESETS.filter((p) => p.name !== initial.name)] : PRESETS)
  const [district, setDistrict] = useState('')

  useEffect(() => {
    api.plan().then((p) => {
      const extra = p.ranked.slice(0, 6).map((r) => ({ name: `${r.name} (#${r.rank})`, lat: r.lat, lon: r.lon }))
      setPlaces((cur) => [...cur, ...extra.filter((e) => !cur.some((c) => c.name === e.name))])
    }).catch(() => {})
  }, [])

  return (
    <div className="phone-page">
      <div className="phone-side">
        <div className="brand"><span className="brand-mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7a5 5 0 1 0 5 5" /></svg></span>Resident view</div>
        <div>This is what a person in the district sees. It checks for new alerts every 3 seconds, so keep it open next to the console and approve an advisory to watch it arrive.</div>
        <label className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Phone location</span>
          <select value={place.name} onChange={(e) => setPlace(places.find((x) => x.name === e.target.value)!)}>
            {places.map((p) => <option key={p.name}>{p.name}</option>)}
          </select>
        </label>
        <div className="small muted">District: {district || '…'} · {place.lat.toFixed(3)}, {place.lon.toFixed(3)}</div>
      </div>
      <PhoneApp place={place} onDistrict={setDistrict} onPlace={(p) => { setPlaces((cur) => (cur.some((c) => c.name === p.name) ? cur : [p, ...cur])); setPlace(p) }} />
    </div>
  )
}

// Two-tone ring (like a phone call) while an alert call is waiting, made with Web Audio so there is no sound file.
function useRingtone(on: boolean) {
  useEffect(() => {
    if (!on) return
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const burst = (at: number) => {
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.12, at + 0.02)
      gain.gain.setValueAtTime(0.12, at + 0.38)
      gain.gain.linearRampToValueAtTime(0, at + 0.42)
      gain.connect(ctx.destination)
      for (const f of [440, 480]) {
        const o = ctx.createOscillator()
        o.frequency.value = f
        o.connect(gain)
        o.start(at)
        o.stop(at + 0.45)
      }
    }
    const ring = () => { const t = ctx.currentTime + 0.05; burst(t); burst(t + 0.6) }
    ring()
    const id = setInterval(ring, 2600)
    return () => { clearInterval(id); ctx.close().catch(() => {}) }
  }, [on])
}

/** The resident's phone. It adapts to the person (language, household) and, with `replay`, sits in the Cyclone Fani story. */
export function PhoneApp({ place, onPlace, onDistrict, replay = false }: {
  place: Place; onPlace?: (p: Place) => void; onDistrict?: (d: string) => void; replay?: boolean
}) {
  const [profile, setProfile] = useState<Profile | null>(loadProfile)
  const [setup, setSetup] = useState(!profile)
  const [district, setDistrict] = useState('')
  const lang = profile?.lang ?? suggestLang(district)
  const [alerts, setAlerts] = useState<Advisory[]>([])
  const [shelter, setShelter] = useState<Shelter | null>(null)
  const [screen, setScreen] = useState<'chat' | 'report' | 'bot' | 'guide'>('chat')
  const [ringing, setRinging] = useState<Advisory | null>(null)
  const [english, setEnglish] = useState(false)
  const [reached, setReached] = useState(false)
  const [vehicle, setVehicle] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [lastReport, setLastReport] = useState<Report | null>(null)
  const [outlook, setOutlook] = useState<Outlook | null>(null)

  useEffect(() => {
    setOutlook(null)
    liveApi.outlook(place.lat, place.lon).then(setOutlook).catch(() => {})
    const id = setInterval(() => liveApi.outlook(place.lat, place.lon).then(setOutlook).catch(() => {}), 600000)
    return () => clearInterval(id)
  }, [place.lat, place.lon])

  // A different location is a different person: start their screen fresh.
  useEffect(() => { setShelter(null); setLastReport(null); setReached(false); setVehicle('idle'); setScreen('chat') }, [place.lat, place.lon])

  useEffect(() => {
    let live = true
    const load = () => api.feed(place.lat, place.lon).then((f) => {
      if (!live) return
      setDistrict(f.district)
      onDistrict?.(f.district)
      setAlerts(f.alerts)
      if (f.shelter) setShelter((s) => (lastReport ? s ?? f.shelter : f.shelter))
    }).catch(() => {})
    load()
    const id = setInterval(load, 3000)
    return () => { live = false; clearInterval(id) }
  }, [place.lat, place.lon, lastReport])

  const alert = alerts[alerts.length - 1]

  // A newly dispatched alert "calls" the phone and reads itself out, like a voice call from the helpline.
  useEffect(() => {
    if (!alert) return
    let seen: string[] = []
    try { seen = JSON.parse(localStorage.getItem('pk-announced') || '[]') } catch { /* ignore */ }
    if (seen.includes(alert.id)) return
    try { localStorage.setItem('pk-announced', JSON.stringify([...seen, alert.id])) } catch { /* ignore */ }
    setRinging(alert)
  }, [alert?.id])
  useRingtone(!!ringing)

  // When an alert is live, warm up the walking map and route so "Guide me there" opens instantly.
  useEffect(() => {
    if (!alert || !shelter) return
    fetch('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json').catch(() => {})
    fetch(apiUrl(`/api/guide/route?lat=${place.lat}&lon=${place.lon}&to_lat=${shelter.lat}&to_lon=${shelter.lon}`)).catch(() => {})
  }, [alert?.id, shelter?.id, place.lat, place.lon])

  // Show the alert in the person's own language when the district wrote one, else in the district's language.
  const alertLang = alert ? (alert.texts[lang]?.body ? lang : alert.languages.find((l) => l !== 'en' && alert.texts[l]?.body) ?? 'en') : 'en'
  const shown = english ? 'en' : alertLang
  const text = alert?.texts[shown]
  const household = profile?.household ?? []
  const tips = ['general', ...household].map((k) => t(lang, `tip_${k}`))
  const needsVehicle = household.some((n) => NEEDS_VEHICLE.includes(n))
  const font = LANG_FONT[lang]

  const alertSpeech = (a: Advisory) => {
    const l = a.texts[lang]?.body ? lang : a.languages.find((x) => x !== 'en' && a.texts[x]?.body) ?? 'en'
    const x = a.texts[l]
    return { l, line: `${x.headline}. ${x.body}` }
  }
  const readAlert = (a: Advisory) => {
    const { l, line } = alertSpeech(a)
    const en = a.texts.en
    sayAloud(line, l, 15000).then((ok) => { if (!ok && l !== 'en' && en?.body) sayAloud(`${en.headline}. ${en.body}`, 'en') })
  }
  // While the phone rings, have the voice ready so the warning plays the moment the call is answered.
  useEffect(() => {
    if (!ringing) return
    const { l, line } = alertSpeech(ringing)
    prefetchSpeech([line], l)
  }, [ringing?.id])
  const askVehicle = async () => {
    setVehicle('sending')
    try {
      const r = await fetch(apiUrl('/api/help/request'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: place.lat, lon: place.lon, need: 'transport', lang, household }) })
      setVehicle(r.ok ? 'sent' : 'idle')
      if (r.ok) sayAloud(t(lang, 'vehicleSent'), lang)
    } catch { setVehicle('idle') }
  }
  const tellFamily = () => {
    const msg = t(lang, 'safeMsg', { shelter: shelter?.name ?? '' })
    let first = ''
    try { first = (JSON.parse(localStorage.getItem('pk-contacts') || '[]')[0]?.phone ?? '').replace(/[^\d]/g, '') } catch { /* none saved */ }
    window.open(`https://wa.me/${first}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
  }

  const settingsButton = (
    <button onClick={() => setSetup(true)} aria-label={t(lang, 'settings')} title={t(lang, 'settings')}
      style={{ marginLeft: 'auto', width: 40, height: 40, borderRadius: 20, border: 'none', background: '#f0ece4', fontSize: 18 }}>⚙︎</button>
  )

  return (
      <div className={`phone${ringing ? ' ringing' : ''}`}>
        {ringing && (
          <IncomingCall lang={lang} district={district} onDecline={() => setRinging(null)} onAnswer={() => {
            readAlert(ringing)
            setRinging(null)
            setSetup(false)
            setScreen('chat')
          }} />
        )}
        {setup ? (
          <Onboarding replay={replay} place={place} onPlace={(p) => onPlace?.(p)}
            initial={profile ?? { lang: suggestLang(district), household: [], done: false }}
            onDone={(p) => { saveProfile(p); setProfile(p); setSetup(false) }} />
        ) : screen === 'guide' && shelter ? (
          <Navigate lang={lang} from={place} shelter={shelter} replay={replay} onBack={() => setScreen('chat')}
            onArrived={() => { setReached(true); setScreen('chat') }} onTellFamily={tellFamily} />
        ) : screen === 'bot' ? (
          <Sahayak place={place} initialLang={lang} opening={undefined} onClose={() => setScreen('chat')} />
        ) : screen === 'chat' ? (
          <>
            <header>
              <span className="brand-mark" style={{ width: 42, height: 42, borderRadius: 21 }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7a5 5 0 1 0 5 5" /></svg></span>
              <span className="stack" style={{ gap: 1 }}>
                <b style={{ fontSize: 16 }}>Pralay Kavach</b>
                <span style={{ fontSize: 12, color: '#5f6a73' }}>{district ? `${district} · ${place.name}` : '…'}</span>
              </span>
              {settingsButton}
            </header>
            <div className="scroll" style={{ fontFamily: font }}>
              {alert && (
                <div className="act fade-in">
                  <div className="act-head">⚠ {t(lang, 'officialAlert')} · Cyclone Fani</div>
                  <div className="act-body">
                    <div className="act-title">{reached ? `✓ ${t(lang, 'markedSafe')}` : t(lang, 'actNow')}</div>
                    {shelter && (
                      <div className="act-line">🏫 <b>{shelter.name}</b> · {t(lang, 'walkMin', { n: Math.max(1, Math.round((shelter.distance_km * 1000) / 75)) })}
                        <span className={`act-chip${shelter.route === 'dry' ? '' : ' wet'}`}>{shelter.route === 'dry' ? `✓ ${t(lang, 'routeDry')}` : shelter.route}</span>
                      </div>
                    )}
                    <div className="act-line">⏰ {t(lang, 'leaveBy', { time: alert.facts.leave_by_ist })}</div>
                    {!reached && (
                      <>
                        <button className="primary act-go" disabled={!shelter} onClick={() => setScreen('guide')}>🧭 {t(lang, 'guideMe')}</button>
                        {needsVehicle && (vehicle === 'sent'
                          ? <div className="act-sent">🚐 {t(lang, 'vehicleSent')}</div>
                          : <button className="act-vehicle" disabled={vehicle === 'sending'} onClick={askVehicle}>🚐 {t(lang, 'sendVehicle')}</button>)}
                        <div className="row" style={{ gap: 8 }}>
                          <button className="pill-btn act-small" onClick={() => readAlert(alert)}>🔊 {t(lang, 'listen')}</button>
                          <button className="pill-btn act-small hot" onClick={() => setScreen('bot')}>🆘 {t(lang, 'needHelp')}</button>
                        </div>
                      </>
                    )}
                    {reached && <button className="pill-btn act-small" onClick={tellFamily}>💬 {t(lang, 'tellFamily')}</button>}
                  </div>
                </div>
              )}
              {!alert && replay && (
                <div className="card fade-in" style={{ width: 326, alignSelf: 'flex-start', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--sans)' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', color: '#8a5a00' }}>REPLAY · CYCLONE FANI · 2 MAY 2019</span>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: 22, lineHeight: '26px' }}>A severe cyclone is heading for the Odisha coast</span>
                  <span style={{ fontSize: 13, lineHeight: '19px', color: '#3a434b' }}>This is the phone of a resident in {place.name}. When the district approves its advisory, this phone rings and reads the warning aloud.</span>
                </div>
              )}
              {!alert && !replay && outlook && <OutlookCard o={outlook} place={place.name} />}
              {!alert && (
                <div style={{ color: '#3a434b', fontSize: 15, lineHeight: '22px', padding: '2px 6px' }}>
                  {t(lang, 'noAlert', { place: place.name })} {t(lang, 'alertWillCome')}
                </div>
              )}
              {!reached && (
                <div className="card fade-in tips">
                  <b>🎒 {t(lang, 'getReady')}</b>
                  <ul>{tips.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
              {alert && text && (
                <div className="bubble fade-in">
                  <div className="alert-head">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 22 20H2Z" /><path d="M12 10v4M12 17v.5" /></svg>
                    EXTREME ALERT<span style={{ marginLeft: 'auto', letterSpacing: 0 }}>Cyclone Fani</span>
                  </div>
                  <div className="alert-body" style={{ fontFamily: LANG_FONT[shown] }}>
                    <div style={{ fontSize: 18, lineHeight: '28px', fontWeight: 600 }}>{text.headline}</div>
                    <div style={{ fontSize: 15.5, lineHeight: '26px', color: '#2e363d' }}>{text.body}</div>
                  </div>
                  <div className="alert-foot">
                    {alertLang !== 'en' ? <button onClick={() => setEnglish(!english)} style={{ border: 'none', background: 'none', color: '#0f5e9c', fontWeight: 600, padding: 0 }}>{english ? t(lang, 'showOriginal') : t(lang, 'seeEnglish')}</button> : <span />}
                    <span>{(alert as any).dispatched_at ? new Date((alert as any).dispatched_at * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  </div>
                </div>
              )}
              {alert && shelter && <ShelterCard shelter={shelter} from={place} />}
              {alert && (
                <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {!reached && <button className="pill-btn" onClick={() => setReached(true)}>✓ {t(lang, 'reached')}</button>}
                  <button className="pill-btn hot" onClick={() => setScreen('report')}>🌊 {t(lang, 'reportWater')}</button>
                </div>
              )}
              {lastReport && (
                <div className="card fade-in" style={{ padding: 14, fontSize: 14, lineHeight: '21px' }}>
                  <b>Your report was checked.</b> {lastReport.notes} {lastReport.matches_model ? 'It matches the flood forecast for this spot.' : 'The forecast did not expect water here; the control room has been told.'}
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0, padding: '10px 14px 18px' }}>
              <button onClick={() => setScreen('bot')} style={{ width: '100%', height: 60, borderRadius: 30, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                background: '#13181c', color: '#fff', fontSize: 16, fontWeight: 700, boxShadow: '0 10px 26px rgba(19,24,28,0.35)', fontFamily: font }}>
                <span style={{ width: 38, height: 38, borderRadius: 19, background: 'linear-gradient(135deg,#ff9d62,#d9412a)', display: 'grid', placeItems: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </span>
                {t(lang, 'talk')}
              </button>
            </div>
          </>
        ) : (
          <ReportScreen place={place} shelter={shelter} onBack={() => setScreen('chat')} onDone={(r, s) => { setLastReport(r); if (s) setShelter(s); setScreen('chat') }} />
        )}
      </div>
  )
}

const LEVEL = {
  clear: { bg: '#e8f4fb', fg: '#0f5e9c', dot: '#1c9a6c', label: 'All clear' },
  watch: { bg: '#fff4dc', fg: '#8a5a00', dot: '#e8a23c', label: 'Keep watch' },
  danger: { bg: '#fde6de', fg: '#a3301b', dot: '#d9412a', label: 'Danger' },
}

function OutlookCard({ o, place }: { o: Outlook; place: string }) {
  const L = LEVEL[o.level]
  const dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(o.now.direction_deg / 45) % 8]
  return (
    <div className="card fade-in" style={{ width: 326, alignSelf: 'flex-start' }}>
      <div style={{ padding: '12px 16px', background: L.bg, color: L.fg, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 5, background: L.dot }} />
        <b style={{ fontSize: 13, letterSpacing: '0.04em' }}>{L.label.toUpperCase()} · NEXT 3 DAYS</b>
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.8 }}>live · satellite + GFS</span>
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 22, lineHeight: '26px' }}>{o.headline}</div>
        <div className="row" style={{ gap: 14, fontSize: 13, color: '#3a434b' }}>
          <span><b style={{ fontSize: 18, color: '#13181c' }}>{Math.round(o.now.wind_kmh)}</b> km/h {dir}</span>
          <span>gusts <b style={{ color: '#13181c' }}>{Math.round(o.now.gust_kmh)}</b></span>
          <span>{Math.round(o.now.temp_c)}°C</span>
          <span>{o.now.pressure_hpa} hPa</span>
        </div>
        <div>
          <GustBars o={o} light />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#5f6a73', marginTop: 4 }}><span>Now</span><span>Gusts, next 72 h</span><span>+3 days</span></div>
        </div>
        <div style={{ fontSize: 13, lineHeight: '19px', color: '#3a434b' }}>{o.reasons.join(' ')}</div>
        <div style={{ fontSize: 11.5, color: '#5f6a73' }}>Guidance for {place}. {o.official}</div>
      </div>
    </div>
  )
}

function IncomingCall({ lang, district, onAnswer, onDecline }: { lang: string; district: string; onAnswer: () => void; onDecline: () => void }) {
  return (
    <div className="fade-in" style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
      padding: '90px 30px 70px', color: '#fff', background: 'radial-gradient(ellipse at top, #3b1a10, #13181c 70%)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
        <span style={{ width: 96, height: 96, borderRadius: 48, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#ff9d62,#d9412a)',
          boxShadow: '0 0 0 14px rgba(255,138,76,0.15), 0 0 0 30px rgba(255,138,76,0.07)', animation: 'fade 1s infinite alternate' }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7a5 5 0 1 0 5 5" /><circle cx="12" cy="12" r="1.4" fill="#fff" /></svg>
        </span>
        <span style={{ fontSize: 14, letterSpacing: '0.06em', opacity: 0.85, fontFamily: LANG_FONT[lang] }}>{t(lang, 'incoming')}</span>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 34, lineHeight: '38px' }}>Pralay Kavach</span>
        <span style={{ fontSize: 14, opacity: 0.8, fontFamily: LANG_FONT[lang] }}>{district} · {t(lang, 'cycloneWarning')}</span>
      </div>
      <div style={{ display: 'flex', gap: 70 }}>
        <button onClick={onDecline} aria-label="Decline" style={{ width: 70, height: 70, borderRadius: 35, border: 'none', background: '#c0392b', display: 'grid', placeItems: 'center' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M4 14c4-4 12-4 16 0l-2 3-3-1v-2a9 9 0 0 0-6 0v2l-3 1Z" /></svg>
        </button>
        <button onClick={onAnswer} aria-label="Answer" style={{ width: 70, height: 70, borderRadius: 35, border: 'none', background: '#1c9a6c', display: 'grid', placeItems: 'center', boxShadow: '0 0 0 10px rgba(28,154,108,0.2)' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
        </button>
      </div>
    </div>
  )
}

function ShelterCard({ shelter, from }: { shelter: Shelter; from: { lat: number; lon: number } }) {
  const dry = shelter.route === 'dry'
  const map = useMemo(() => {
    // Schematic: a fixed-length line through the card's centre, pointing the real direction.
    const dx = (shelter.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180)
    const dy = shelter.lat - from.lat
    const a = Math.atan2(dy, dx)
    const half = 110
    return {
      x1: 163 - half * Math.cos(a), y1: 50 + 26 * Math.sin(a),
      x2: 163 + half * Math.cos(a), y2: 50 - 26 * Math.sin(a),
    }
  }, [shelter, from])
  const directions = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${shelter.lat},${shelter.lon}&travelmode=walking`
  return (
    <div className="card fade-in" style={{ width: 326, alignSelf: 'flex-start' }}>
      <svg width="326" height="112" viewBox="0 0 326 112" style={{ display: 'block' }} aria-label="Route to your shelter">
        <rect width="326" height="112" fill="#edefe6" />
        <path d="M0 88 C60 78 110 96 170 84 C230 72 270 88 326 76 V112 H0 Z" fill="#9fcde8" />
        <path d={`M${map.x1} ${map.y1} L${map.x2} ${map.y2}`} stroke="#fff" strokeWidth="9" strokeLinecap="round" />
        <path d={`M${map.x1} ${map.y1} L${map.x2} ${map.y2}`} stroke={dry ? '#1c7bc4' : '#d9412a'} strokeWidth="5" strokeLinecap="round" strokeDasharray={dry ? undefined : '8 6'} />
        <circle cx={map.x1} cy={map.y1} r="6" fill="#1c7bc4" stroke="#fff" strokeWidth="2" />
        <circle cx={map.x2} cy={map.y2} r="8" fill="#d9412a" stroke="#fff" strokeWidth="2" />
      </svg>
      <div style={{ padding: '12px 16px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shelter.rerouted && <span style={{ fontSize: 12, fontWeight: 700, color: '#b3361f' }}>Rerouted: the way to {shelter.previous} is flooded</span>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 22, lineHeight: '26px' }}>{shelter.name}</span>
          <span style={{ padding: '3px 10px', borderRadius: 999, background: '#e4eff7', color: '#0f5e9c', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{shelter.distance_km} km</span>
        </div>
        <span className="row" style={{ gap: 6, fontSize: 13.5, color: '#3a434b' }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: dry ? '#1c9a6c' : '#d9412a' }} />
          {dry ? 'Route stays dry in the forecast' : `Route: ${shelter.route}`}
        </span>
        {shelter.proxy && <span style={{ fontSize: 12, color: '#5f6a73' }}>School building used as a cyclone shelter</span>}
      </div>
      <a href={directions} target="_blank" rel="noreferrer" style={{ margin: '0 10px 10px', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14, background: '#eef4f9', fontWeight: 700, color: '#0f5e9c', textDecoration: 'none' }}>Open directions</a>
    </div>
  )
}

function ReportScreen({ place, shelter, onBack, onDone }: { place: { lat: number; lon: number; name: string }; shelter: Shelter | null; onBack: () => void; onDone: (r: Report, s: Shelter | null) => void }) {
  const [depth, setDepth] = useState('knee')
  const [where, setWhere] = useState<'here' | 'route'>(shelter ? 'route' : 'here')
  const spot = where === 'route' && shelter
    ? { lat: (place.lat + shelter.lat) / 2, lon: (place.lon + shelter.lon) / 2 }
    : { lat: place.lat, lon: place.lon }
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await api.report(spot.lat, spot.lon, depth, photo, { lat: place.lat, lon: place.lon })
      onDone(res.report, res.shelter)
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <>
      <header style={{ background: 'transparent', borderBottom: 'none' }}>
        <button onClick={onBack} aria-label="Back" style={{ width: 44, height: 44, border: 'none', background: 'none', display: 'grid', placeItems: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#13181c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5 8 12l7 7" /></svg>
        </button>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 30 }}>Report <i style={{ color: '#1c7bc4' }}>water</i></span>
      </header>
      <div className="scroll" style={{ gap: 14 }}>
        <div className="photo-drop" onClick={() => input.current?.click()}>
          {preview ? <img src={preview} alt="Your photo" /> : (
            <>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#5f6a73" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h3l2-3h6l2 3h3v12H4Z" /><circle cx="12" cy="13" r="4" /></svg>
              Take or choose a photo of the water
            </>
          )}
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Where is the water?</div>
          <div className="seg-light" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <button className={where === 'here' ? 'on' : ''} onClick={() => setWhere('here')}>Where I am</button>
            <button className={where === 'route' ? 'on' : ''} disabled={!shelter} onClick={() => setWhere('route')}>On my way to shelter</button>
          </div>
        </div>
        <div className="row" style={{ fontSize: 14 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d9412a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12Z" /><circle cx="12" cy="9" r="2.5" /></svg>
          <span><b>{where === 'route' && shelter ? `Road to ${shelter.name}` : place.name}</b><br /><span style={{ fontSize: 12, color: '#5f6a73', fontFamily: 'var(--mono)' }}>{spot.lat.toFixed(4)}° N, {spot.lon.toFixed(4)}° E</span></span>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>How deep is it?</div>
          <div className="seg-light">
            {DEPTHS.map(([id, label]) => <button key={id} className={depth === id ? 'on' : ''} onClick={() => setDepth(id)}>{label}</button>)}
          </div>
        </div>
        <div style={{ fontSize: 13, color: '#5f6a73', lineHeight: '19px' }}>The photo is checked by AI and compared with the flood forecast. If your route is affected, you'll get a new one.</div>
        {err && <div style={{ color: '#b3361f', fontSize: 13 }}>{err}</div>}
        <button className="primary" style={{ marginTop: 'auto' }} disabled={busy} onClick={submit}>{busy ? 'Checking…' : 'Send report'}</button>
      </div>
    </>
  )
}
