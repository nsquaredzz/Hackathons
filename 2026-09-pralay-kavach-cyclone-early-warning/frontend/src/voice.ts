import { apiUrl } from './api'

// The phone's voice. Every line is spoken with Gemini TTS (natural in Odia, Hindi, Bengali, Telugu, Tamil and English),
// fetched from the backend, which caches each line. If Gemini is slow or unavailable the phone uses its own speech engine.

const DEVICE_LANG: Record<string, string> = { or: 'or-IN', hi: 'hi-IN', bn: 'bn-IN', te: 'te-IN', ta: 'ta-IN', en: 'en-IN' }

let serverOk: boolean | null = null
/** Resolves once we know whether the backend can speak. */
export const voiceReady: Promise<boolean> = fetch(apiUrl('/api/tts/status'))
  .then((r) => r.json()).then((d) => (serverOk = !!d.available)).catch(() => (serverOk = false))
export const serverVoice = () => serverOk

const clips = new Map<string, Promise<string | null>>()
let current: HTMLAudioElement | null = null
let turn = 0

function clip(text: string, lang: string, background = false): Promise<string | null> {
  const key = `${lang}|${text}`
  let p = clips.get(key)
  if (!p) {
    p = fetch(apiUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(text)}${background ? '&bg=1' : ''}`))
      .then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null)
    p.then((u) => { if (!u) clips.delete(key) }) // let a failed line be tried again later
    clips.set(key, p)
  }
  return p
}

function deviceSpeak(text: string, lang: string): boolean {
  const synth = window.speechSynthesis
  if (!synth) return false
  const code = DEVICE_LANG[lang] ?? 'en-IN'
  const voice = synth.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(code.slice(0, 2)))
  const u = new SpeechSynthesisUtterance(text)
  u.lang = code
  if (voice) u.voice = voice
  u.rate = 0.95
  synth.speak(u)
  return !!voice
}

/** Stop whatever the phone is saying. */
export function stopSpeaking() {
  turn++
  current?.pause()
  current = null
  window.speechSynthesis?.cancel()
}

/**
 * Say `text` in `lang`. Resolves true if it was spoken (Gemini voice, or a device voice for that language),
 * false if neither could speak it, so the caller can fall back to English.
 */
export async function speak(text: string, lang: string, waitMs = 9000): Promise<boolean> {
  stopSpeaking()
  const mine = turn
  const line = text.trim()
  if (!line) return true
  await voiceReady
  if (serverOk) {
    const url = await Promise.race([clip(line, lang), new Promise<null>((r) => setTimeout(() => r(null), waitMs))])
    if (mine !== turn) return true // something newer is being said
    if (url) {
      current = new Audio(url)
      try { await current.play(); return true } catch { /* playback blocked: use the device voice */ }
    }
  }
  if (mine !== turn) return true
  return deviceSpeak(line, lang)
}

/** Generate lines ahead of time (one after another), so they play instantly when needed. */
export function prefetchSpeech(lines: string[], lang: string) {
  voiceReady.then((ok) => {
    if (!ok) return
    ;[...new Set(lines.map((l) => l.trim()).filter(Boolean))].reduce<Promise<unknown>>((p, l) => p.then(() => clip(l, lang, true)), Promise.resolve())
  })
}
