import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, CircleDot, Sparkles } from 'lucide-react'
import { Button } from '../components/ui'
import Logo from '../components/svgs/Logo'
import SiteNav from '../components/site/SiteNav'
import SiteFooter from '../components/site/SiteFooter'
import { Frame } from '../components/site/Layout'
import { MonoLabel } from '../components/site/Typography'
import ProductShot from '../components/site/ProductShot'
import { HeroMock, CodeMock, PlanMock, ReviewMock, ShipMock } from '../components/site/home/Mocks'
import { BuiltOn, ClosingCta, Demo, Features, Keys, Safety, Steps } from '../components/site/home/Sections'
import { DEMO_REPLAY_URL } from '../content/site'
import { useSeo } from '../lib/seo'
import { cn } from '../lib/cn'

/*
 * Landing-page lab: three hero directions from docs/research/landing-ui-research.md, rendered over the real
 * sections so they can be compared as screenshots. Not linked anywhere and noindex; the chosen one moves
 * into Home.tsx and this file goes away.
 */

const SERIF = "'Instrument Serif', Georgia, serif"
function useSerifFont() {
  useEffect(() => {
    const id = 'lab-serif'
    if (document.getElementById(id)) return
    const l = document.createElement('link')
    l.id = id
    l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap'
    document.head.appendChild(l)
  }, [])
}
const Serif = ({ children, italic = true, className }: { children: ReactNode; italic?: boolean; className?: string }) => (
  <span className={cn('font-normal tracking-[-0.01em]', italic && 'italic', className)} style={{ fontFamily: SERIF }}>
    {children}
  </span>
)

/** Real example issues that fill the box (Jules-style task chips). */
const EXAMPLES = ['Fix a failing test', 'Add input validation', 'Bump a dependency', 'Handle an edge case']
const DEMO_ISSUE = 'github.com/Ayushjo/devin-test-app/issues/3'

/** Eval numbers from docs/architecture/claude-eval.md — honest numbers instead of logos we don't have. */
const STATS = [
  ['34 / 40', 'issues solved on the free model', 'hard and vague ones included'],
  ['$0.016', 'average model cost per task', 'Claude Haiku, measured'],
  ['5 checks', 'before you see a diff', 'plan, edits, tests, gate, review'],
  ['0', 'PRs opened without your approval', 'you publish, always'],
] as const

function IssueBox({ big, dark, value, onChange }: { big?: boolean; dark?: boolean; value: string; onChange: (v: string) => void }) {
  return (
    <label
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-pill border pl-4 pr-1.5 transition focus-within:ring-4',
        big ? 'h-14' : 'h-12',
        dark ? 'border-white/15 bg-white/[.06] focus-within:border-primary focus-within:ring-primary/20' : 'border-black/15 bg-card focus-within:border-primary focus-within:ring-primary/10',
      )}
    >
      <CircleDot className={cn('h-4 w-4 shrink-0', dark ? 'text-white/50' : 'text-muted-foreground')} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="github.com/owner/repo/issues/42"
        aria-label="GitHub issue URL"
        className={cn('min-w-0 flex-1 bg-transparent text-[15px] outline-none', dark ? 'text-white placeholder:text-white/40' : 'placeholder:text-muted-foreground/80')}
      />
      <Button variant="primary" shape="pill" className={cn('px-4', big ? 'h-11' : 'h-9')}>
        <span className="hidden sm:inline">Start free</span> <ArrowRight className="h-4 w-4" />
      </Button>
    </label>
  )
}

function Chips({ onPick, dark, center }: { onPick: () => void; dark?: boolean; center?: boolean }) {
  return (
    <div className={cn('mt-3 flex flex-wrap items-center gap-2', center && 'justify-center')}>
      <span className={cn('font-mono text-[11px] uppercase tracking-[0.08em]', dark ? 'text-white/45' : 'text-muted-foreground')}>Try</span>
      {EXAMPLES.map((e) => (
        <button
          key={e}
          type="button"
          onClick={onPick}
          className={cn(
            'rounded-pill border px-3 py-1 text-[13px] transition-colors',
            dark ? 'border-white/12 text-white/75 hover:border-white/30 hover:text-white' : 'border-hairline bg-card text-foreground/75 hover:border-black/20 hover:text-foreground',
          )}
        >
          {e}
        </button>
      ))}
    </div>
  )
}

function StatsRow({ dark }: { dark?: boolean }) {
  return (
    <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-lg border lg:grid-cols-4', dark ? 'border-white/10 bg-white/10' : 'border-hairline bg-hairline')}>
      {STATS.map(([n, l, s]) => (
        <div key={l} className={cn('px-5 py-5 sm:px-6', dark ? 'bg-[#0d1017]' : 'bg-card')}>
          <p className={cn('text-[30px] leading-none tracking-[-0.03em] tabular-nums sm:text-[34px]', dark ? 'text-white' : 'text-foreground')}>{n}</p>
          <p className={cn('mt-2.5 text-sm', dark ? 'text-white/80' : 'text-foreground')}>{l}</p>
          <p className={cn('mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em]', dark ? 'text-white/40' : 'text-muted-foreground')}>{s}</p>
        </div>
      ))}
    </div>
  )
}

const Announce = ({ dark }: { dark?: boolean }) => (
  <Link
    to="/pricing"
    className={cn(
      'inline-flex items-center gap-2 rounded-pill border py-1 pl-1 pr-3 text-[13px] transition-colors',
      dark ? 'border-white/12 bg-white/[.04] text-white/80 hover:text-white' : 'border-hairline bg-card text-foreground/80 hover:text-foreground',
    )}
  >
    <span className="rounded-pill bg-primary px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-white">New</span>
    Free Claude tasks — no key, no card
    <ArrowRight className="h-3.5 w-3.5" />
  </Link>
)

/* ───────────────────────── V1 · Refined: today's layout, sharpened ───────────────────────── */
function HeroRefined() {
  const [url, setUrl] = useState('')
  return (
    <section className="overflow-hidden">
      <div className="px-gutter pb-12 pt-14 md:px-12 md:pt-20">
        <div className="max-w-3xl">
          <Announce />
          <h1 className="mt-6 text-balance text-display font-normal text-foreground">
            Issue in. <br />
            <span className="text-primary">
              Reviewed <Serif className="text-[1.08em]">pull request</Serif> out.
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-lead text-muted-foreground">Pullwright plans, codes in a sandbox, runs your tests and gets an independent review — then opens the PR when you say so.</p>
          <div className="mt-8 max-w-2xl">
            <div className="flex flex-col gap-2 sm:flex-row">
              <IssueBox value={url} onChange={setUrl} />
              <Link to={DEMO_REPLAY_URL}>
                <Button variant="outline" shape="pill" size="lg" className="h-12 w-full whitespace-nowrap" tabIndex={-1}>
                  Watch a replay
                </Button>
              </Link>
            </div>
            <Chips onPick={() => setUrl(DEMO_ISSUE)} />
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Free to start · no key, no card · sign in with GitHub</p>
          </div>
        </div>
      </div>
      <div className="px-gutter pb-10 md:px-12">
        <ProductShot backdrop="sky" bleed inner="sm:p-10 lg:p-14">
          <HeroMock />
        </ProductShot>
      </div>
      <div className="px-gutter pb-14 md:px-12 md:pb-20">
        <StatsRow />
      </div>
    </section>
  )
}

/* ───────────────────── V2 · Prompt-first: the input is the hero (Motion, Factory) ───────────────────── */
const PIPE = [
  { n: '01', t: 'Plan', d: 'Maps the repo, lists every requirement, proposes the files. You approve.', m: <PlanMock /> },
  { n: '02', t: 'Code and test', d: 'Small checked edits in a sandbox. Your tests and type-checks run live.', m: <CodeMock /> },
  { n: '03', t: 'Review', d: 'A gate and a separate reviewer check the diff against each requirement.', m: <ReviewMock /> },
  { n: '04', t: 'Ship', d: 'You read the diff and publish. The PR opens from your account.', m: <ShipMock /> },
]

function HeroPrompt({ topOnly }: { topOnly?: boolean }) {
  const [url, setUrl] = useState('')
  return (
    <section className="overflow-hidden">
      <div className="relative px-gutter pb-16 pt-16 text-center md:px-12 md:pb-20 md:pt-24">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,#dce8ff_0%,rgba(247,247,246,0)_70%)]" />
        <div className="relative mx-auto max-w-4xl">
          <MonoLabel dot>Autonomous PR agent</MonoLabel>
          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-[clamp(3rem,7vw,5.75rem)] leading-[0.98] tracking-[-0.02em] text-foreground" style={{ fontFamily: SERIF }}>
            Hand it an issue. <br />
            Get a <em className="text-primary">pull request.</em>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lead text-muted-foreground">It plans, edits in a sandbox, runs your tests and gets a second opinion. Nothing ships until you approve it.</p>

          <div className="mx-auto mt-10 max-w-2xl rounded-[22px] border border-black/10 bg-card p-2 text-left shadow-[0_20px_60px_-30px_rgba(43,127,255,0.45)]">
            <div className="flex items-center gap-2 px-3 pt-3">
              <CircleDot className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a GitHub issue URL"
                aria-label="GitHub issue URL"
                className="min-w-0 flex-1 bg-transparent py-2 text-[17px] outline-none placeholder:text-muted-foreground/70"
              />
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 px-1.5 pb-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-black/[.05] px-2.5 py-1 text-foreground/80">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Claude Haiku · free
                </span>
                <span className="rounded-pill bg-black/[.05] px-2.5 py-1 text-foreground/80">Ask before guessing</span>
                <span className="hidden rounded-pill bg-black/[.05] px-2.5 py-1 text-foreground/80 sm:inline">Review: on</span>
              </div>
              <Button variant="primary" shape="pill" className="h-10 px-5">
                Start <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Chips center onPick={() => setUrl(DEMO_ISSUE)} />
          <p className="mt-6 text-sm text-muted-foreground">
            Free to start — no key, no card.{' '}
            <Link to={DEMO_REPLAY_URL} className="text-primary hover:underline">
              Watch a real run →
            </Link>
          </p>
        </div>
      </div>

      {!topOnly && <div className="border-t border-hairline px-gutter py-14 md:px-12 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="max-w-xl text-title font-normal text-foreground">
            Four steps. <Serif className="text-muted-foreground">You make every call.</Serif>
          </h2>
          <MonoLabel>Issue → plan → code → review → PR</MonoLabel>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PIPE.map((p) => (
            <article key={p.n} className="flex flex-col overflow-hidden rounded-lg border border-hairline bg-card">
              <div className="p-5">
                <MonoLabel index={p.n}>{p.t}</MonoLabel>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{p.d}</p>
              </div>
              <div className="relative mt-auto h-[230px] overflow-hidden bg-[radial-gradient(120%_90%_at_20%_10%,#dbe8ff_0%,#eef3fb_45%,#e9ecef_100%)]">
                <div className="absolute left-5 top-5 w-[440px] origin-top-left scale-[0.72]">{p.m}</div>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-10">
          <StatsRow />
        </div>
      </div>}
    </section>
  )
}

/* ─────────────── V3 · Dark: a dark hero band over the light page (CodeRabbit, Graphite, Linear) ─────────────── */
function DarkNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0b0d12]/80 backdrop-blur">
      <div className="mx-auto flex h-[52px] max-w-frame items-center justify-between px-gutter md:px-12">
        <div className="flex items-center gap-8">
          <Logo height={26} linked={false} animated={false} className="brightness-0 invert" />
          <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
            <span>Product</span>
            <Link to="/pricing" className="hover:text-white">Pricing</Link>
            <Link to={DEMO_REPLAY_URL} className="hover:text-white">Replay</Link>
            <span className="inline-flex items-center gap-1">GitHub <ArrowUpRight className="h-3.5 w-3.5" /></span>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden px-3 text-sm text-white/70 sm:inline">Log in</span>
          <Button variant="primary" shape="pill" className="h-8 px-3.5 text-[13px]">Start free</Button>
        </div>
      </div>
    </header>
  )
}

function HeroDark() {
  const [url, setUrl] = useState('')
  return (
    <section className="relative overflow-hidden bg-[#0b0d12] text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_85%_0%,rgba(43,127,255,0.35)_0%,rgba(11,13,18,0)_70%),radial-gradient(40%_40%_at_0%_100%,rgba(120,80,255,0.18)_0%,rgba(11,13,18,0)_70%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />
      <div className="relative mx-auto max-w-frame px-gutter pb-16 pt-16 md:px-12 md:pt-24">
        <Announce dark />
        <div className="mt-8 grid gap-10 lg:grid-cols-[1.7fr_1fr] lg:items-end">
          <h1 className="text-balance text-[clamp(2.5rem,5.4vw,4.25rem)] font-normal leading-[1.02] tracking-[-0.035em]">
            Issue in. <br />
            <span className="bg-gradient-to-r from-[#8db8ff] via-[#5b9bff] to-[#2b7fff] bg-clip-text text-transparent">Reviewed pull request out.</span>
          </h1>
          <div className="lg:pb-2">
            <p className="text-lead text-white/65">An autonomous agent that plans, codes in a sandbox, runs your tests and gets an independent review. The PR only opens when you approve it.</p>
          </div>
        </div>
        <div className="mt-10 max-w-2xl">
          <IssueBox big dark value={url} onChange={setUrl} />
          <Chips dark onPick={() => setUrl(DEMO_ISSUE)} />
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.06em] text-white/40">Free to start · no key, no card · sign in with GitHub</p>
        </div>

        <div className="relative mt-14 overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(160deg,#1a2338_0%,#10141d_45%,#0d1017_100%)] p-4 sm:p-10 lg:p-14">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-primary/30 blur-[90px]" />
          <div className="relative -mr-16 sm:mr-0">
            <HeroMock />
          </div>
        </div>
        <div className="mt-8">
          <StatsRow dark />
        </div>
        <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-8 md:flex-row md:items-center md:gap-10">
          <MonoLabel className="shrink-0 text-white/40">Bring any model</MonoLabel>
          <ul className="flex flex-wrap gap-x-8 gap-y-2 text-[17px] tracking-[-0.01em] text-white/40">
            {['Anthropic', 'OpenAI', 'Google Gemini', 'OpenRouter', 'Groq', 'Vercel AI Gateway'].map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════ Round 2: V2's hero over V1's page, then three bolder directions ═════════════════════ */

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600&display=swap'
function useLabFonts() {
  useEffect(() => {
    if (document.getElementById('lab-fonts')) return
    const l = document.createElement('link')
    l.id = 'lab-fonts'
    l.rel = 'stylesheet'
    l.href = FONTS
    document.head.appendChild(l)
  }, [])
}

/** Each theme re-points the design tokens, so every real section below the hero follows it. */
const THEMES: Record<string, React.CSSProperties> = {
  ink: {
    '--background': '#f1ece2', '--background-rgb': '241 236 226', '--foreground': '#17140f', '--foreground-rgb': '23 20 15',
    '--card': '#fbf8f2', '--card-foreground': '#17140f', '--primary': '#c8432b', '--primary-rgb': '200 67 43', '--ring': '#c8432b',
    '--muted-foreground': 'rgba(23,20,15,.6)', '--faint': 'rgba(23,20,15,.42)', '--hairline': 'rgba(23,20,15,.1)', '--border': 'rgba(23,20,15,.13)',
    '--font-sans': "'Inter Tight', system-ui, sans-serif",
  } as React.CSSProperties,
  midnight: {
    '--background': '#08080a', '--background-rgb': '8 8 10', '--foreground': '#f3f3f5', '--foreground-rgb': '243 243 245',
    '--card': '#121216', '--card-foreground': '#f3f3f5', '--popover': '#121216', '--popover-foreground': '#f3f3f5',
    '--secondary': '#1b1b21', '--muted': '#1b1b21', '--elevated': '#1b1b21', '--accent': '#1b1b21', '--input': '#26262c',
    '--primary': '#8f7cff', '--primary-rgb': '143 124 255', '--ring': '#8f7cff',
    '--muted-foreground': 'rgba(243,243,245,.56)', '--faint': 'rgba(243,243,245,.36)', '--hairline': 'rgba(255,255,255,.07)', '--border': 'rgba(255,255,255,.1)',
    '--font-sans': "'Geist', system-ui, sans-serif",
  } as React.CSSProperties,
  signal: {
    '--background': '#ecebe7', '--background-rgb': '236 235 231', '--foreground': '#0d0d0d', '--foreground-rgb': '13 13 13',
    '--card': '#f8f7f4', '--card-foreground': '#0d0d0d', '--primary': '#ff4d00', '--primary-rgb': '255 77 0', '--ring': '#ff4d00',
    '--muted-foreground': 'rgba(13,13,13,.58)', '--faint': 'rgba(13,13,13,.4)', '--hairline': 'rgba(13,13,13,.12)', '--border': 'rgba(13,13,13,.15)',
    '--font-sans': "'Geist', system-ui, sans-serif",
  } as React.CSSProperties,
}

const THEME_CSS = `
.theme-ink, .theme-midnight, .theme-signal { font-family: var(--font-sans); }
.theme-ink h1, .theme-ink h2 { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; letter-spacing: -0.015em; }
.theme-ink h2 { font-size: clamp(2.3rem, 4.4vw, 3.6rem); line-height: 1.02; }
.theme-ink [class*="bg-[radial-gradient"] { background: radial-gradient(120% 90% at 15% 0%, #f2d9c2 0%, #ece2d2 48%, #e5ddcf 100%) !important; }
.theme-midnight h1, .theme-midnight h2 { font-weight: 500; letter-spacing: -0.04em; }
.theme-midnight [class*="bg-[radial-gradient"] { background: radial-gradient(120% 90% at 20% 0%, rgba(143,124,255,.24) 0%, #121217 55%, #0d0d11 100%) !important; }
.theme-midnight [class*="border-black/"] { border-color: rgba(255,255,255,.1) !important; }
.theme-signal h1, .theme-signal h2 { font-family: 'Space Grotesk', sans-serif; text-transform: uppercase; font-weight: 500; letter-spacing: -0.045em; line-height: .95; }
.theme-signal .font-mono { font-family: 'Geist Mono', monospace; }
.theme-signal [class*="bg-[radial-gradient"] { background: #dfded9 radial-gradient(rgba(13,13,13,.16) 1px, transparent 1px) 0 0 / 14px 14px !important; }
.theme-signal [class*="rounded-lg"] { border-radius: 4px; }
`

function PromptCard({ value, onChange, dark, square }: { value: string; onChange: (v: string) => void; dark?: boolean; square?: boolean }) {
  const chip = cn('rounded-pill px-2.5 py-1', dark ? 'bg-white/[.07] text-white/80' : 'bg-black/[.05] text-foreground/80')
  return (
    <div className={cn('border bg-card p-2 text-left', square ? 'rounded-[6px]' : 'rounded-[22px]', dark ? 'border-white/10' : 'border-black/10')}>
      <div className="flex items-center gap-2 px-3 pt-3">
        <CircleDot className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Paste a GitHub issue URL" aria-label="GitHub issue URL" className="min-w-0 flex-1 bg-transparent py-2 text-[17px] text-foreground outline-none placeholder:text-muted-foreground/70" />
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 px-1.5 pb-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className={cn(chip, 'inline-flex items-center gap-1.5')}>
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Claude Haiku · free
          </span>
          <span className={chip}>Ask before guessing</span>
          <span className={cn(chip, 'hidden sm:inline')}>Review: on</span>
        </div>
        <Button variant="primary" shape="pill" className="h-10 px-5">
          Start <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/** V1's lower hero: the product window and the eval numbers. */
function ShotAndStats({ dark }: { dark?: boolean }) {
  return (
    <>
      <div className="px-gutter pb-10 md:px-12">
        <ProductShot backdrop="sky" bleed inner="sm:p-10 lg:p-14">
          <HeroMock />
        </ProductShot>
      </div>
      <div className="px-gutter pb-14 md:px-12 md:pb-20">
        <StatsRow dark={dark} />
      </div>
    </>
  )
}

/* ── V5 · Ink: editorial cream, serif display, vermilion (Resend, Motion, Empowrd, Parvu) ── */
const RUN = ['Plan approved · 5 requirements', 'patch src/math.js +12', 'npm test · 18 passed', 'review 5/5 met', 'PR #4 ready to publish']
function HeroInk() {
  const [url, setUrl] = useState('')
  return (
    <section className="overflow-hidden">
      <div className="relative px-gutter pb-14 pt-16 text-center md:px-12 md:pb-16 md:pt-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Nº 01 — the autonomous pull-request agent</p>
        <h1 className="mx-auto mt-7 max-w-5xl text-balance text-[clamp(3.4rem,8.4vw,7.25rem)] leading-[0.9] text-foreground">
          Hand it an issue. <br />
          Get a <em className="text-primary">pull request.</em>
        </h1>
        <p className="mx-auto mt-7 max-w-xl text-[18px] leading-relaxed text-muted-foreground">It plans, edits in a sandbox, runs your tests and gets a second opinion. Nothing ships until you approve it.</p>
        <div className="mx-auto mt-10 max-w-2xl shadow-[0_30px_60px_-35px_rgba(120,60,20,0.45)]">
          <PromptCard value={url} onChange={setUrl} />
        </div>
        <Chips center onPick={() => setUrl(DEMO_ISSUE)} />
        <p className="mt-6 text-sm text-muted-foreground">
          Free to start — no key, no card.{' '}
          <Link to={DEMO_REPLAY_URL} className="text-primary underline decoration-primary/30 underline-offset-4">Watch a real run</Link>
        </p>
      </div>
      <div className="mb-12 overflow-hidden border-y border-hairline py-3">
        <div className="flex justify-center gap-6 whitespace-nowrap font-mono text-[12px] text-muted-foreground">
          {RUN.map((r, i) => (
            <span key={r} className="inline-flex items-center gap-6">
              {i > 0 && <span className="text-primary">✦</span>}
              {r}
            </span>
          ))}
        </div>
      </div>
      <ShotAndStats />
    </section>
  )
}

/* ── V6 · Midnight: near-black, Geist, violet glow, tilted product (Linear, Graphite, Deskmodes, Omnisavant) ── */
function HeroMidnight() {
  const [url, setUrl] = useState('')
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 45% at 50% 0%, rgba(143,124,255,.30), transparent 70%), radial-gradient(35% 30% at 88% 18%, rgba(43,127,255,.16), transparent 70%), radial-gradient(30% 30% at 8% 40%, rgba(255,120,180,.08), transparent 70%)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)', backgroundSize: '64px 64px', maskImage: 'radial-gradient(60% 50% at 50% 20%, black, transparent)', WebkitMaskImage: 'radial-gradient(60% 50% at 50% 20%, black, transparent)' }} />
      <div className="relative px-gutter pb-6 pt-16 text-center md:px-12 md:pt-24">
        <Announce dark />
        <h1 className="mx-auto mt-8 max-w-5xl text-balance text-[clamp(3rem,7.4vw,6.25rem)] leading-[0.98] text-foreground">
          Issue in. <br />
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(92deg, #ffffff 0%, #c9c0ff 35%, #8f7cff 70%, #5b8cff 100%)' }}>Pull request out.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lead text-muted-foreground">The agent that plans, codes in a sandbox, runs your tests and gets an independent review. The PR opens only when you approve it.</p>
        <div className="mx-auto mt-10 max-w-2xl rounded-[23px] p-px shadow-[0_0_90px_-25px_rgba(143,124,255,.75)]" style={{ background: 'linear-gradient(135deg, rgba(143,124,255,.9), rgba(255,255,255,.08) 40%, rgba(255,255,255,.06) 60%, rgba(91,140,255,.8))' }}>
          <PromptCard dark value={url} onChange={setUrl} />
        </div>
        <Chips dark center onPick={() => setUrl(DEMO_ISSUE)} />
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.08em] text-white/40">Free to start · no key, no card · GitHub sign-in</p>
      </div>
      <div className="relative mt-10 px-gutter md:px-12" style={{ perspective: '2200px' }}>
        <div className="origin-top" style={{ transform: 'rotateX(16deg)', maskImage: 'linear-gradient(black 55%, transparent)', WebkitMaskImage: 'linear-gradient(black 55%, transparent)' }}>
          <ProductShot backdrop="sky" inner="sm:p-10 lg:p-14">
            <HeroMock />
          </ProductShot>
        </div>
      </div>
      <div className="relative -mt-24 px-gutter pb-14 md:px-12 md:pb-20">
        <StatsRow dark />
      </div>
    </section>
  )
}

/* ── V7 · Signal: grey, uppercase grotesk, international orange, terminal-native (Factory, Jules, WeMakeDevs, Kush) ── */
const LOG = [
  ['$', 'pullwright run github.com/acme/api/issues/128', 'cmd'],
  ['→', 'mapping repo · 214 files · express + vitest', ''],
  ['✓', 'plan approved · 4 requirements', 'ok'],
  ['→', 'patch src/routes/users.ts +18 −3', ''],
  ['→', 'patch test/users.test.ts +24', ''],
  ['✓', 'npm test · 61 passed · 0 new failures', 'ok'],
  ['✓', 'review · 4/4 requirements met', 'ok'],
  ['■', 'waiting for you · publish PR?', 'wait'],
] as const
function HeroSignal() {
  const [url, setUrl] = useState('')
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(13,13,13,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(13,13,13,.06) 1px, transparent 1px)', backgroundSize: '96px 96px' }} />
      <div className="relative px-gutter pt-10 md:px-12">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
          <span>[ pullwright / v1 ]</span>
          <span className="hidden sm:inline">autonomous pr agent · free to start</span>
          <span className="inline-flex items-center gap-2"><span className="h-2 w-2 bg-primary" /> live</span>
        </div>
        <div className="mt-12 grid gap-12 pb-14 lg:grid-cols-[1.25fr_1fr] lg:items-end md:pb-20">
          <div>
            <h1 className="text-[clamp(3.4rem,8.6vw,8.25rem)] text-foreground">
              Issue in.<br />
              <span className="text-primary">PR out.</span>
            </h1>
            <p className="mt-7 max-w-lg text-[18px] leading-relaxed text-muted-foreground">Paste a GitHub issue. Pullwright plans, codes in a sandbox, runs your tests and gets an independent review. You press publish.</p>
            <div className="mt-8 flex max-w-xl items-stretch overflow-hidden rounded-[4px] border border-foreground bg-[#0d0d0d]">
              <span className="flex items-center pl-4 pr-2 font-mono text-[14px] text-primary">$ run</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="github.com/owner/repo/issues/42" aria-label="GitHub issue URL" className="min-w-0 flex-1 bg-transparent py-4 font-mono text-[14px] text-white outline-none placeholder:text-white/35" />
              <button className="bg-primary px-5 font-mono text-[13px] uppercase tracking-[0.06em] text-black">Run ↵</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" onClick={() => setUrl(DEMO_ISSUE)} className="rounded-[3px] border border-foreground/20 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-foreground/70 hover:border-foreground hover:text-foreground">
                  {e}
                </button>
              ))}
            </div>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">No key · no card · sign in with GitHub</p>
          </div>
          <div className="rounded-[6px] border border-black bg-[#0d0d0d] p-5 font-mono text-[12.5px] leading-[1.9] text-white/70 shadow-[10px_10px_0_0_#ff4d00]">
            <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3 text-[10.5px] uppercase tracking-[0.1em] text-white/40">
              <span>task · acme/api#128</span>
              <span>$0.014 · 2m 41s</span>
            </div>
            {LOG.map(([g, t, k], i) => (
              <div key={i} className="flex gap-3">
                <span className={cn('w-3 shrink-0', k === 'ok' ? 'text-[#7dffa1]' : k === 'cmd' || k === 'wait' ? 'text-primary' : 'text-white/35')}>{g}</span>
                <span className={cn(k === 'cmd' && 'text-white', k === 'wait' && 'text-primary')}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="relative mb-12 overflow-hidden bg-[#0d0d0d] py-3">
        <p className="whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.18em] text-primary">
          {Array.from({ length: 6 }, () => 'issue → plan → code → test → review → you publish').join('   ✦   ')}
        </p>
      </div>
      <div className="relative">
        <ShotAndStats />
      </div>
    </section>
  )
}

export default function LandingLab() {
  const { v = '1' } = useParams()
  useSerifFont()
  useLabFonts()
  useSeo({ title: `Landing lab ${v}`, description: 'Internal landing page variants.', noindex: true })
  const rest = (
    <>
      {v !== '3' && <BuiltOn />}
      <Features />
      {v !== '2' && <Steps />}
      <Demo />
      <Keys />
      <Safety />
      <ClosingCta onStart={() => {}} />
      <SiteFooter />
    </>
  )
  if (v === '3')
    return (
      <div className="min-h-screen bg-background text-foreground">
        <DarkNav />
        <HeroDark />
        <Frame>{rest}</Frame>
      </div>
    )
  const theme = ({ '5': 'ink', '6': 'midnight', '7': 'signal' } as Record<string, string>)[v]
  const hero =
    v === '2' ? <HeroPrompt /> : v === '4' ? <><HeroPrompt topOnly /><ShotAndStats /></> : v === '5' ? <HeroInk /> : v === '6' ? <HeroMidnight /> : v === '7' ? <HeroSignal /> : <HeroRefined />
  return (
    <div className={cn('min-h-screen bg-background text-foreground', theme && `theme-${theme}`)} style={theme ? THEMES[theme] : undefined}>
      {theme && <style>{THEME_CSS}</style>}
      <SiteNav />
      <Frame>
        {hero}
        {rest}
      </Frame>
    </div>
  )
}
