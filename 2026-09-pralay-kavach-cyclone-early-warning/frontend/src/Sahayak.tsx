import { useEffect, useRef, useState } from 'react'
import { LANG_FONT } from './api'

// Sahayak: talk to it in your language; it answers aloud and gives one-tap actions.
// Voice uses the phone's own speech engine (Android Chrome speaks and understands Indian languages well);
// the same backend can sit behind a phone line or WhatsApp.

export const BOT_LANGS: [string, string, string][] = [
  ['or', 'ଓଡ଼ିଆ', 'or-IN'], ['hi', 'हिन्दी', 'hi-IN'], ['bn', 'বাংলা', 'bn-IN'],
  ['te', 'తెలుగు', 'te-IN'], ['ta', 'தமிழ்', 'ta-IN'], ['en', 'English', 'en-IN'],
]
const SPEECH = Object.fromEntries(BOT_LANGS.map(([k, , c]) => [k, c]))
export const GREETING: Record<string, string> = {
  or: 'ନମସ୍କାର, ମୁଁ ସହାୟକ। ଆପଣଙ୍କୁ କଣ ସାହାଯ୍ୟ ଦରକାର, କୁହନ୍ତୁ।',
  hi: 'नमस्ते, मैं सहायक हूँ। बताइए, आपको क्या मदद चाहिए?',
  bn: 'নমস্কার, আমি সহায়ক। বলুন, আপনার কী সাহায্য দরকার?',
  te: 'నమస్కారం, నేను సహాయక్. మీకు ఏ సహాయం కావాలో చెప్పండి.',
  ta: 'வணக்கம், நான் சகாயக். உங்களுக்கு என்ன உதவி வேண்டும் என்று சொல்லுங்கள்.',
  en: "Hello, I'm Sahayak. Tell me what's happening and I'll help.",
}
export const AFTER_ALERT: Record<string, string> = {
  or: 'ଆଶ୍ରୟସ୍ଥଳୀକୁ ଯିବାରେ ସାହାଯ୍ୟ ଦରକାର କି?',
  hi: 'क्या आश्रय स्थल तक पहुँचने में मदद चाहिए?',
  bn: 'আশ্রয়কেন্দ্রে যেতে কি সাহায্য লাগবে?',
  te: 'ఆశ్రయ కేంద్రానికి వెళ్ళడానికి సహాయం కావాలా?',
  ta: 'பாதுகாப்பு மையத்துக்குச் செல்ல உதவி வேண்டுமா?',
  en: 'Do you need help getting to your shelter?',
}
const QUICK = ['Where is my shelter?', 'Water is coming into my house', 'Someone is hurt', "Tell my family I'm safe", 'What should I carry?']

type Action =
  | { type: 'call'; number: string; label: string; detail: string }
  | { type: 'directions'; label: string; lat: number; lon: number }
  | { type: 'family'; label: string; message: string; safe: boolean }
  | { type: 'contacts'; label: string; contacts: { number: string; label: string }[] }

interface Msg { role: 'user' | 'bot'; text: string; english?: string; actions?: Action[]; urgent?: boolean; pending?: boolean; filed?: Record<string, string> }
interface Contact { name: string; phone: string }

function loadContacts(): Contact[] {
  try { return JSON.parse(localStorage.getItem('pk-contacts') || '[]') } catch { return [] }
}

export function speak(text: string, lang: string): boolean {
  const synth = window.speechSynthesis
  if (!synth) return false
  synth.cancel()
  const code = SPEECH[lang] ?? 'en-IN'
  const voice = synth.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(code.slice(0, 2)))
  const u = new SpeechSynthesisUtterance(text)
  u.lang = code
  if (voice) u.voice = voice
  u.rate = 0.95
  synth.speak(u)
  return !!voice
}

export default function Sahayak({ place, initialLang, opening, onClose }: {
  place: { lat: number; lon: number; name: string }
  initialLang: string
  opening?: Msg[]
  onClose: () => void
}) {
  const [lang, setLang] = useState(initialLang)
  const [msgs, setMsgs] = useState<Msg[]>(opening ?? [{ role: 'bot', text: GREETING[initialLang] ?? GREETING.en }])
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [noVoice, setNoVoice] = useState(false)
  const [contacts, setContacts] = useState<Contact[]>(loadContacts)
  const [editContacts, setEditContacts] = useState(false)
  const rec = useRef<any>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const session = useRef(Math.random().toString(36).slice(2, 10))

  useEffect(() => { scroller.current?.scrollTo({ top: 1e6, behavior: 'smooth' }) }, [msgs])
  useEffect(() => { try { localStorage.setItem('pk-contacts', JSON.stringify(contacts)) } catch { /* private mode */ } }, [contacts])
  useEffect(() => {
    // Voices load asynchronously in Chrome.
    const check = () => setNoVoice(!window.speechSynthesis?.getVoices().some((v) => v.lang.toLowerCase().startsWith((SPEECH[lang] ?? 'en').slice(0, 2))))
    check()
    window.speechSynthesis?.addEventListener?.('voiceschanged', check)
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', check)
  }, [lang])

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    setInput('')
    const history = msgs.filter((m) => !m.pending).map((m) => ({ role: m.role === 'bot' ? 'assistant' : 'person', text: m.english || m.text }))
    setMsgs((m) => [...m, { role: 'user', text: t }, { role: 'bot', text: '…', pending: true }])
    setBusy(true)
    try {
      const r = await fetch('/api/bot/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: place.lat, lon: place.lon, lang, message: t, history, session: session.current }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'failed')
      setMsgs((m) => [...m.filter((x) => !x.pending), { role: 'bot', text: d.reply, english: d.english, actions: d.actions, urgent: d.urgent, filed: d.filed }])
      speak(d.reply, lang)
    } catch {
      setMsgs((m) => [...m.filter((x) => !x.pending), { role: 'bot', text: 'I could not reach the helpline server. Call 112 if you are in danger.', urgent: true,
        actions: [{ type: 'call', number: '112', label: 'Call 112', detail: 'Emergency' }] }])
    } finally {
      setBusy(false)
    }
  }

  const listen = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Voice input is not supported in this browser. Type your message, or use Chrome on Android.'); return }
    if (listening) { rec.current?.stop(); return }
    const r = new SR()
    r.lang = SPEECH[lang] ?? 'en-IN'
    r.interimResults = true
    r.maxAlternatives = 1
    let finalText = ''
    r.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript
        else interim += e.results[i][0].transcript
      }
      setInput(finalText || interim)
    }
    r.onerror = (e: any) => { setListening(false); if (e.error === 'language-not-supported') alert('This browser cannot listen in this language yet. Type instead, or switch language.') }
    r.onend = () => { setListening(false); if (finalText.trim()) send(finalText) }
    rec.current = r
    window.speechSynthesis?.cancel()
    setListening(true)
    r.start()
  }

  const font = LANG_FONT[lang]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{ height: 'auto', padding: '14px 12px 10px', flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={onClose} aria-label="Back" style={{ width: 40, height: 40, border: 'none', background: 'none', display: 'grid', placeItems: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#13181c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5 8 12l7 7" /></svg>
          </button>
          <span className="stack" style={{ gap: 0 }}>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 26, lineHeight: '28px' }}>Sahayak</span>
            <span style={{ fontSize: 11.5, color: '#5f6a73' }}>Voice help · {place.name}</span>
          </span>
          <button onClick={() => setEditContacts(!editContacts)} style={{ marginLeft: 'auto', height: 34, padding: '0 12px', borderRadius: 17, border: '1px solid #d9d3c7', background: '#fff', fontSize: 12.5, fontWeight: 600, color: '#13181c' }}>
            Family ({contacts.length})
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {BOT_LANGS.map(([k, label]) => (
            <button key={k} onClick={() => setLang(k)} style={{ flexShrink: 0, height: 32, padding: '0 12px', borderRadius: 16, border: 'none', fontFamily: LANG_FONT[k] ?? 'inherit', fontSize: 13.5,
              background: lang === k ? 'linear-gradient(135deg,#3a93d4,#0f5e9c)' : '#fff', color: lang === k ? '#fff' : '#3a434b', fontWeight: lang === k ? 700 : 500, boxShadow: '0 2px 8px rgba(60,40,20,0.08)' }}>{label}</button>
          ))}
        </div>
      </header>

      {editContacts && <ContactsEditor contacts={contacts} setContacts={setContacts} onDone={() => setEditContacts(false)} />}

      <div ref={scroller} className="scroll" style={{ gap: 10 }}>
        {msgs.map((m, i) => (
          <div key={i} className="fade-in" style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              padding: '11px 14px', borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
              background: m.role === 'user' ? 'linear-gradient(135deg,#3a93d4,#0f5e9c)' : m.urgent ? '#fde6de' : '#fff',
              color: m.role === 'user' ? '#fff' : m.urgent ? '#6b1d0f' : '#13181c', border: m.urgent ? '1px solid #f0b3a0' : 'none',
              boxShadow: '0 6px 18px rgba(60,40,20,0.08)', fontFamily: m.role === 'bot' ? font : undefined, fontSize: 15.5, lineHeight: '24px',
            }}>
              {m.pending ? <span className="row" style={{ gap: 4 }}>{[0, 1, 2].map((d) => <span key={d} style={{ width: 7, height: 7, borderRadius: 4, background: '#8fa3b3', animation: `fade 0.9s ${d * 0.2}s infinite alternate` }} />)}</span> : m.text}
              {m.role === 'bot' && !m.pending && (
                <button onClick={() => speak(m.text, lang)} aria-label="Play aloud" style={{ marginLeft: 8, border: 'none', background: 'none', verticalAlign: 'middle', cursor: 'pointer', padding: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={m.urgent ? '#a3301b' : '#0f5e9c'} strokeWidth="2" strokeLinecap="round"><path d="M4 9v6h4l5 4V5L8 9Z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></svg>
                </button>
              )}
            </div>
            {m.filed && (m.filed.help || m.filed.report) && (
              <span style={{ fontSize: 11.5, color: '#5f6a73' }}>{m.filed.help ? 'Rescue request sent to the control room. ' : ''}{m.filed.report ? 'Water report added to the live map.' : ''}</span>
            )}
            {m.actions && m.actions.length > 0 && <Actions actions={m.actions} contacts={contacts} onAddContact={() => setEditContacts(true)} />}
          </div>
        ))}
        {msgs.length <= 2 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {QUICK.map((q) => <button key={q} className="pill-btn" style={{ height: 36, fontSize: 13 }} onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {noVoice && <div style={{ fontSize: 11.5, color: '#8a5a00', background: '#fff4dc', padding: '8px 10px', borderRadius: 10 }}>This device has no voice for this language, so replies are shown as text. Android phones with Google speech services read Indian languages aloud.</div>}
      </div>

      <div style={{ flexShrink: 0, padding: '10px 12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <label htmlFor="bot-msg" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Message</label>
        <input id="bot-msg" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(input)}
          placeholder={listening ? 'Listening…' : 'Speak or type'} style={{ flex: 1, height: 50, padding: '0 18px', borderRadius: 25, border: 'none', background: '#fff', boxShadow: '0 6px 20px rgba(60,40,20,0.1)', fontFamily: font ?? 'inherit', fontSize: 15 }} />
        <button onClick={listen} aria-label={listening ? 'Stop listening' : 'Speak'} style={{
          width: 62, height: 62, borderRadius: 31, border: 'none', flexShrink: 0, display: 'grid', placeItems: 'center',
          background: listening ? 'linear-gradient(180deg,#ff8a4c,#d9412a)' : '#13181c',
          boxShadow: listening ? '0 0 0 8px rgba(217,65,42,0.18), 0 8px 20px rgba(217,65,42,0.4)' : '0 8px 20px rgba(19,24,28,0.3)',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
        {input.trim() && !listening && (
          <button onClick={() => send(input)} aria-label="Send" style={{ width: 46, height: 46, borderRadius: 23, border: 'none', background: '#0f5e9c', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M3 20 21 12 3 4v6l12 2-12 2Z" /></svg>
          </button>
        )}
      </div>
    </div>
  )
}

function Actions({ actions, contacts, onAddContact }: { actions: Action[]; contacts: Contact[]; onAddContact: () => void }) {
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, padding: '0 16px', borderRadius: 14,
    background: bg, color: fg, fontWeight: 700, fontSize: 14, textDecoration: 'none', border: 'none', boxShadow: '0 4px 14px rgba(60,40,20,0.12)',
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {actions.map((a, i) => {
        if (a.type === 'call') return (
          <a key={i} href={`tel:${a.number}`} style={btn(a.number === '112' ? 'linear-gradient(180deg,#ff8a4c,#d9412a)' : '#13181c')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
            {a.label} <span style={{ fontWeight: 500, opacity: 0.85 }}>· {a.detail}</span>
          </a>
        )
        if (a.type === 'directions') return (
          <a key={i} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}&travelmode=walking`} style={btn('#e4eff7', '#0f5e9c')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0f5e9c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12Z" /><circle cx="12" cy="9" r="2.5" /></svg>
            {a.label}
          </a>
        )
        if (a.type === 'family') return contacts.length ? (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {contacts.map((c) => (
              <div key={c.phone} style={{ display: 'flex', gap: 6 }}>
                <a target="_blank" rel="noreferrer" href={`https://wa.me/${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(a.message)}`} style={{ ...btn('#1c9a6c'), flex: 1 }}>WhatsApp {c.name}</a>
                <a href={`sms:${c.phone}?&body=${encodeURIComponent(a.message)}`} style={{ ...btn('#fff', '#13181c'), flex: 0.6 }}>SMS</a>
              </div>
            ))}
          </div>
        ) : (
          <button key={i} onClick={onAddContact} style={btn('#fff', '#13181c')}>Add a family number first</button>
        )
        if (a.type === 'contacts') return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 }}>
            {a.contacts.map((c) => <a key={c.number} href={`tel:${c.number}`} style={{ ...btn('#fff', '#13181c'), flexDirection: 'column', gap: 0, padding: '6px 8px' }}><b>{c.number}</b><span style={{ fontSize: 11, fontWeight: 500, color: '#5f6a73' }}>{c.label}</span></a>)}
          </div>
        )
        return null
      })}
    </div>
  )
}

function ContactsEditor({ contacts, setContacts, onDone }: { contacts: Contact[]; setContacts: (c: Contact[]) => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  return (
    <div className="card fade-in" style={{ margin: '0 12px', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b style={{ fontSize: 14 }}>Family and friends to alert</b>
      {contacts.map((c) => (
        <div key={c.phone} className="row" style={{ fontSize: 14, justifyContent: 'space-between' }}>
          <span>{c.name} · {c.phone}</span>
          <button onClick={() => setContacts(contacts.filter((x) => x.phone !== c.phone))} style={{ border: 'none', background: 'none', color: '#a3301b', fontWeight: 600 }}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, height: 40, borderRadius: 10, border: '1px solid #d9d3c7', padding: '0 10px', fontFamily: 'inherit', minWidth: 0 }} />
        <input aria-label="Phone with country code" placeholder="+91…" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ flex: 1.2, height: 40, borderRadius: 10, border: '1px solid #d9d3c7', padding: '0 10px', fontFamily: 'inherit', minWidth: 0 }} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button disabled={!name.trim() || phone.replace(/\D/g, '').length < 8} onClick={() => { setContacts([...contacts, { name: name.trim(), phone: phone.trim() }]); setName(''); setPhone('') }}
          style={{ flex: 1, height: 40, borderRadius: 10, border: 'none', background: '#0f5e9c', color: '#fff', fontWeight: 700 }}>Add</button>
        <button onClick={onDone} style={{ flex: 1, height: 40, borderRadius: 10, border: '1px solid #d9d3c7', background: '#fff', fontWeight: 600 }}>Done</button>
      </div>
      <span style={{ fontSize: 11.5, color: '#5f6a73' }}>Saved only on this phone.</span>
    </div>
  )
}
