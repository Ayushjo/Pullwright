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

function HeroPrompt() {
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

      <div className="border-t border-hairline px-gutter py-14 md:px-12 md:py-20">
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
      </div>
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

export default function LandingLab() {
  const { v = '1' } = useParams()
  useSerifFont()
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
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <Frame>
        {v === '2' ? <HeroPrompt /> : <HeroRefined />}
        {rest}
      </Frame>
    </div>
  )
}
