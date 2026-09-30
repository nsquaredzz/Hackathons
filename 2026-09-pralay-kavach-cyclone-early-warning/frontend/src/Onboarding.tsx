import { useEffect, useState } from 'react'
import { LANG_FONT } from './api'
import { HOUSEHOLD, LANG_EN, LANG_NAME, LANGS, t, type Lang, type Need, type Profile } from './i18n'
import { PRESETS, type Place } from './places'
import { speak } from './voice'

// Three taps and the phone speaks the person's language, knows where they are and who they are looking after.

const ICON: Record<Need, string> = { elderly: '👵', children: '👶', disabled: '♿', pregnant: '🤰', livestock: '🐄', boat: '🚣' }

export default function Onboarding({ initial, place, replay, onPlace, onDone }: {
  initial: Profile; place: Place; replay: boolean; onPlace: (p: Place) => void; onDone: (p: Profile) => void
}) {
  const [step, setStep] = useState(0)
  const [lang, setLang] = useState<Lang>(initial.lang)
  const [picked, setPicked] = useState(false)
  // Until the person picks, follow the suggestion (it improves once the phone knows its district).
  useEffect(() => { if (!picked) setLang(initial.lang) }, [initial.lang, picked])
  const [household, setHousehold] = useState<Need[]>(initial.household)
  const [gps, setGps] = useState<'idle' | 'finding' | 'failed'>('idle')
  const font = LANG_FONT[lang]
  const title = [t(lang, 'chooseLang'), t(lang, 'whereAreYou'), t(lang, 'whoWithYou')][step]

  // Read each question aloud once the person has tapped something (browsers only speak after a tap).
  useEffect(() => { if (step > 0) speak(title, lang) }, [step])

  const locate = () => {
    if (!navigator.geolocation) { setGps('failed'); return }
    setGps('finding')
    navigator.geolocation.getCurrentPosition(
      (p) => { setGps('idle'); onPlace({ name: 'My location', lat: p.coords.latitude, lon: p.coords.longitude }); setStep(2) },
      () => setGps('failed'), { enableHighAccuracy: true, timeout: 10000 })
  }
  const toggle = (n: Need) => setHousehold((h) => (h.includes(n) ? h.filter((x) => x !== n) : [...h, n]))

  return (
    <div className="setup" style={{ fontFamily: font }}>
      <div className="setup-dots">{[0, 1, 2].map((i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
      <h2 className="setup-title">{title}</h2>
      {step === 2 && <div className="setup-hint">{t(lang, 'whoHint')}</div>}

      <div className="setup-body">
        {step === 0 && (
          <div className="setup-grid">
            {LANGS.map((l) => (
              <button key={l} className={`setup-opt${l === lang ? ' on' : ''}`} style={{ fontFamily: LANG_FONT[l] }}
                onClick={() => { setLang(l); setPicked(true); speak(LANG_NAME[l], l) }}>
                <b>{LANG_NAME[l]}</b><span>{LANG_EN[l]}</span>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="setup-list">
            {!replay && (
              <button className="setup-gps" onClick={locate} disabled={gps === 'finding'}>
                <span style={{ fontSize: 26 }}>📍</span>{gps === 'finding' ? t(lang, 'locating') : t(lang, 'useGps')}
              </button>
            )}
            {gps === 'failed' && <div className="setup-hint" style={{ color: '#b3361f' }}>{t(lang, 'gpsFailed')}</div>}
            {!replay && <div className="setup-hint">{t(lang, 'pickVillage')}</div>}
            {PRESETS.map((p) => (
              <button key={p.name} className={`setup-row${p.name === place.name ? ' on' : ''}`} onClick={() => onPlace(p)}>
                <span>🏠</span>{p.name}
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="setup-grid">
            {HOUSEHOLD.map((n) => (
              <button key={n} className={`setup-opt${household.includes(n) ? ' on' : ''}`} onClick={() => toggle(n)}>
                <span style={{ fontSize: 30 }}>{ICON[n]}</span><b style={{ fontSize: 15 }}>{t(lang, n)}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="setup-foot">
        {step > 0 && <button className="setup-back" onClick={() => setStep(step - 1)} aria-label={t(lang, 'back')}>‹</button>}
        <button className="primary" style={{ flex: 1 }}
          onClick={() => (step < 2 ? setStep(step + 1) : onDone({ lang, household, done: true }))}>
          {step < 2 ? t(lang, 'next') : t(lang, 'start')}
        </button>
      </div>
    </div>
  )
}
