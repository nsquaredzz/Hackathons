import { useEffect, useRef, useState } from 'react'
import type { Tab } from './Console'

// A floating walkthrough for the hackathon panel: one stop per screen, a "Show me" jump, and a ring on what to click.

type Step = {
  tab?: Tab
  kicker: string
  title: string
  body: string
  look?: string[]
  try?: string
  target?: () => Element | null
  action?: 'replay' | 'phone'
}

const byText = (sel: string, text: string) =>
  [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim().startsWith(text)) ?? null
const TAB_LABEL: Record<Tab, string> = { live: 'Live', command: 'Replay', risk: 'Risk', plan: 'Plan', dispatch: 'Dispatch', verify: 'Verify' }
const navButton = (t: Tab) => byText('nav.nav button', TAB_LABEL[t])

const STEPS: Step[] = [
  {
    kicker: 'Guide for the judges',
    title: 'Pralay Kavach in 5 minutes',
    body: 'AI cyclone early warning for India\'s east coast: from the first forecast to a family in a shelter. '
      + 'Press Next to move through each screen; a glowing ring marks what to click.',
    look: ['Gemini does the reading, writing and talking; Earth Engine supplies the satellite flood data.',
      'If the model is busy, the app falls back to rules and says so in the top bar and on the answer.'],
  },
  {
    tab: 'live', kicker: '1 · Watch', title: 'The Bay of Bengal, right now',
    body: 'Live wind from global forecast models, satellite clouds and rain, and a detector for storms that are starting to form.',
    look: ['Right panel: today\'s outlook and the track record (5 of 6 storms spotted, median 7.1 days ahead, 0 false alarms on held-out years).',
      'The satellite switch on the right changes between infrared clouds, rain rate and more.'],
    try: 'Press ▶ at the bottom to play the next 72 hours of wind.',
    target: () => document.querySelector('button.play'),
  },
  {
    tab: 'command', kicker: '2 · Replay', title: 'Cyclone Fani, May 2019',
    body: 'We replay a real storm on real data: the observed track, the forecast cone and landfall at Puri.',
    try: 'Press ▶ on the timeline and watch the cone narrow onto Puri. You can also drag the slider.',
    target: () => document.querySelector('button.play'), action: 'replay',
  },
  {
    tab: 'risk', kicker: '3 · Assess', title: 'Who and what is exposed',
    body: 'Storm surge spreads over real terrain and population: people to evacuate, hospitals and substations in danger, roads cut.',
    look: ['Most likely track: about 9.2 lakh people to move.', 'Layer buttons at the top left: surge, waterlogging, assets, cut roads.'],
    try: 'Switch to the Northern or Southern track to see how the numbers change.',
    target: () => byText('button', 'Northern track'),
  },
  {
    tab: 'plan', kicker: '4 · Plan', title: 'A Gemini agent plans the evacuation',
    body: 'The agent reads the cyclone bulletin and a satellite image together, runs the models on three tracks, '
      + 'and ranks villages by who must leave first, with a reason for each. It may only use numbers the models produced.',
    look: ['Left: the six steps it took. Middle: the ranked villages. Right: why the selected village ranks where it does.'],
    try: 'Click any village. "Re-run" streams the agent live (about a minute).',
    target: () => document.querySelector('tbody tr:nth-child(2)'),
  },
  {
    tab: 'dispatch', kicker: '5 · Warn', title: 'One warning, every language',
    body: 'Gemini drafts the advisory in Odia, Telugu, Bengali and English, with an English back-translation so the officer can check it. '
      + 'Two officers must approve before it goes out as a standard CAP alert. The phone on the right belongs to a resident of Puri.',
    try: 'Press "Write advisory", then approve as the Duty officer and the Relief Commissioner. Within seconds the phone on the right rings.',
    target: () => byText('button', 'Write advisory') ?? byText('button', 'Approve'),
  },
  {
    tab: 'dispatch', kicker: '6 · Resident', title: 'The phone rings',
    body: 'Answer the call: the warning is read aloud, then the phone shows this person\'s own shelter and whether the route there stays dry.',
    look: ['The phone adapts to its owner: a 3-tap setup picks their language (six Indian languages), place and who is at home, and every screen and tip follows.'],
    try: 'After answering, tap "Guide me there" and then "Show me the walk": a real walking route, turn-by-turn in the resident\'s language, spoken aloud, with water warnings. Or tap "I need help" and type "Water is coming into my house" to see the SOS arrive here.',
    target: () => document.querySelector('.phone-dock') ?? byText('.topbar-right button', 'Phone'),
  },
  {
    tab: 'verify', kicker: '7 · Verify', title: 'Checked against what really happened',
    body: 'Sentinel-1 radar from Earth Engine shows where water actually stood after Fani. We score the forecast against it, list villages to send relief to first, and work out parametric payouts.',
    look: ['Waterlogging forecast: 5.4× better than chance on areas it was not fitted to.',
      'Evacuation estimate about 9 lakh vs about 12 lakh actually moved.'],
    target: () => byText('.panel *', 'Where water'),
  },
  {
    kicker: 'That\'s the tour', title: 'Thank you',
    body: 'Built for Odisha, ready for any coast: every input is a global dataset, and Gemini handles the local languages.',
    look: ['Code, pitch deck and video: github.com/nsquaredzz/Hackathons', 'Reset (top bar) clears the demo for a fresh run.'],
  },
]

export default function Guide({ tab, setTab, onReplay, onClose }: {
  tab: Tab; setTab: (t: Tab) => void; onReplay: () => void; onClose: () => void
}) {
  const [i, setI] = useState(0)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [ring, setRing] = useState<DOMRect | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const step = STEPS[i]
  const onTab = !step.tab || step.tab === tab

  // Ring the thing to click; on the wrong screen, ring that screen's tab instead.
  useEffect(() => {
    const find = () => (onTab ? step.target?.() : step.tab ? navButton(step.tab) : null) ?? null
    const tick = () => { const el = find(); setRing(el ? el.getBoundingClientRect() : null) }
    tick()
    const id = setInterval(tick, 300)
    window.addEventListener('resize', tick)
    return () => { clearInterval(id); window.removeEventListener('resize', tick) }
  }, [i, tab, onTab, step])

  const go = () => {
    if (step.tab) setTab(step.tab)
    if (step.action === 'replay') onReplay()
    if (step.action === 'phone') window.open('/citizen', '_blank', 'noopener')
  }

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const r = box.current!.getBoundingClientRect()
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !box.current) return
    const w = box.current.offsetWidth, h = box.current.offsetHeight
    setPos({
      x: Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - h - 8),
    })
  }

  return (
    <>
      {ring && (
        <div className="guide-ring" style={{ left: ring.left - 6, top: ring.top - 6, width: ring.width + 12, height: ring.height + 12 }} />
      )}
      <div ref={box} className="guide glass" role="dialog" aria-label="Guide for the judges"
        style={pos ? { left: pos.x, top: pos.y, bottom: 'auto' } : undefined}>
        <div className="guide-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
          <span className="guide-kicker">{step.kicker}</span>
          <span className="guide-count">{i + 1}/{STEPS.length}</span>
          <button className="guide-x" aria-label="Close guide" onClick={onClose}>×</button>
        </div>
        <div className="guide-title">{step.title}</div>
        <p className="guide-body">{step.body}</p>
        {step.look && (
          <ul className="guide-look">{step.look.map((l) => <li key={l}>{l}</li>)}</ul>
        )}
        {step.try && <div className="guide-try"><b>Try it</b>{step.try}</div>}
        <div className="guide-dots">
          {STEPS.map((s, k) => (
            <button key={k} className={k === i ? 'on' : ''} aria-label={`Step ${k + 1}: ${s.title}`} onClick={() => setI(k)} />
          ))}
        </div>
        <div className="guide-actions">
          <button className="btn-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          {(step.action || (step.tab && !onTab)) && (
            <button className="btn-ghost guide-go" onClick={go}>
              {step.action === 'phone' ? 'Open phone ↗' : step.action === 'replay' ? 'Play replay' : 'Show me'}
            </button>
          )}
          {i < STEPS.length - 1
            ? <button className="btn-primary" onClick={() => { const n = STEPS[i + 1]; setI(i + 1); if (n.tab) setTab(n.tab) }}>Next</button>
            : <button className="btn-primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </>
  )
}
