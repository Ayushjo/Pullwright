import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, CircleDot, Sparkles } from 'lucide-react'
import { Button } from '../../ui'
import { MonoLabel } from '../Typography'
import { ChecksMock, CodeMock, PlanMock, ReviewMock, ShipMock } from './Mocks'
import { DEMO_REPLAY_URL } from '../../../content/site'
import { fadeUp, stagger } from '../../../lib/motion'
import { cn } from '../../../lib/cn'

/*
 * Home, as chosen from the landing lab (V15): a centred serif hero with the issue box as the main
 * action, "Measured, not promised" on a black band, then "01 · Not autocomplete" in staggered columns
 * (tabs on phones). See docs/research/landing-ui-research.md.
 */

/** An italic serif accent inside sans copy ("not promised.", "pull request."). */
export const Accent = ({ children, className }: { children: ReactNode; className?: string }) => <em className={cn('font-serif italic font-normal tracking-[-0.01em]', className)}>{children}</em>

/** A settings chip that switches on and off (the hero's "Ask before guessing" and "Review"). */
function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={hint}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-pill px-2.5 py-1 transition-colors',
        on ? 'bg-primary/10 text-primary' : 'bg-black/[.05] text-muted-foreground line-through decoration-black/30',
      )}
      data-track="hero_toggle"
      data-track-setting={label}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-primary' : 'border border-current')} />
      {label}
    </button>
  )
}

const EXAMPLES = ['Fix a failing test', 'Add input validation', 'Bump a dependency', 'Handle an edge case']
const DEMO_ISSUE = 'https://github.com/Ayushjo/devin-test-app/issues/3'

export function HomeHero({
  url,
  onUrl,
  onSubmit,
  loading,
  signedIn,
  settings,
  onSettings,
}: {
  settings: { askFirst: boolean; review: boolean }
  onSettings: (s: { askFirst: boolean; review: boolean }) => void
  url: string
  onUrl: (v: string) => void
  onSubmit: (e: FormEvent) => void
  loading: boolean
  signedIn: boolean
}) {
  const chip = 'rounded-pill bg-black/[.05] px-2.5 py-1 text-foreground/80'
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,#dce8ff_0%,rgba(247,247,246,0)_70%)]" />
      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="relative mx-auto max-w-4xl px-gutter pb-16 pt-16 text-center md:px-12 md:pb-20 md:pt-24">
        <motion.div variants={fadeUp}>
          <MonoLabel dot>Autonomous PR agent</MonoLabel>
        </motion.div>
        <motion.h1 variants={fadeUp} className="mx-auto mt-6 max-w-3xl text-balance font-serif text-[clamp(3rem,7vw,5.75rem)] font-normal leading-[0.98] tracking-[-0.02em] text-foreground">
          Hand it an issue. <br />
          Get a <em className="text-primary">pull request.</em>
        </motion.h1>
        <motion.p variants={fadeUp} className="mx-auto mt-6 max-w-xl text-lead text-muted-foreground">
          It plans, edits in a sandbox, runs your tests and gets a second opinion. Nothing ships until you approve it.
        </motion.p>

        <motion.form variants={fadeUp} onSubmit={onSubmit} className="mx-auto mt-10 max-w-2xl rounded-[22px] border border-black/10 bg-card p-2 text-left shadow-[0_20px_60px_-30px_rgba(43,127,255,0.45)] focus-within:border-primary/50">
          <label className="flex items-center gap-2 px-3 pt-3">
            <CircleDot className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="url"
              value={url}
              onChange={(e) => onUrl(e.target.value)}
              placeholder="Paste a GitHub issue URL"
              aria-label="GitHub issue URL"
              disabled={loading}
              className="min-w-0 flex-1 bg-transparent py-2 text-[17px] outline-none placeholder:text-muted-foreground/70"
            />
          </label>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 px-1.5 pb-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              {!signedIn && (
                <span className={cn(chip, 'inline-flex items-center gap-1.5')}>
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Claude Haiku · free
                </span>
              )}
              <Toggle on={settings.askFirst} onClick={() => onSettings({ ...settings, askFirst: !settings.askFirst })} label="Ask before guessing" hint="Stop and ask when the issue leaves something open" />
              <Toggle on={settings.review} onClick={() => onSettings({ ...settings, review: !settings.review })} label="Review" hint="A second model checks the diff against every requirement" />
            </div>
            <Button type="submit" variant="primary" shape="pill" loading={loading} className="h-11 w-full px-5 sm:h-10 sm:w-auto" data-track="hero_submit" data-track-where="hero">
              {signedIn ? 'Start' : 'Sign in to start'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </div>
        </motion.form>

        <motion.div variants={fadeUp} className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Try</span>
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => onUrl(DEMO_ISSUE)} className="min-h-8 rounded-pill border border-hairline bg-card px-3 py-1 text-[13px] text-foreground/75 transition-colors hover:border-black/20 hover:text-foreground" data-track="example_chip" data-track-example={e}>
              {e}
            </button>
          ))}
        </motion.div>
        <motion.p variants={fadeUp} className="mt-6 text-sm text-muted-foreground">
          Free to start — no key, no card.{' '}
          <Link to="/demo" className="text-primary hover:underline" data-track="try_demo" data-track-where="hero">
            Try a live demo, no account →
          </Link>
        </motion.p>
      </motion.div>
    </section>
  )
}

/** Results of the 40-issue eval per model (docs/architecture/claude-eval.md). */
const MODELS = [
  { name: 'Haiku 5.5', role: 'Free tasks', rows: [['Solved', '34 / 40'], ['Hard issues', '9 / 10'], ['Vague issues', '6 / 8'], ['Avg cost', '$0.016']] },
  { name: 'Sonnet 5.5', role: 'Credits and Pro', rows: [['Solved', '34 / 40'], ['Hard issues', '10 / 10'], ['Base ladder', '26 / 26'], ['Avg cost', '$0.18']] },
  { name: 'Opus 5.5', role: 'Benchmark only, not offered yet', rows: [['Solved', '36 / 40'], ['Hard issues', '10 / 10'], ['Vague issues', '7 / 8'], ['Avg cost', '$0.43']] },
]

/** "Measured, not promised": three spec cards; a swipe row on phones. Meant for a black band. */
export function Measured() {
  return (
    <section id="measured" className="px-gutter py-16 md:px-12 md:py-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-title font-normal text-foreground">
          Measured, <Accent className="text-muted-foreground">not promised.</Accent>
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">The same 40 issues — easy, hard, real repos, screenshots, vague — run on each model. Hidden tests decide pass or fail.</p>
      </div>
      <div className="no-scrollbar -mx-gutter mt-10 flex snap-x snap-mandatory scroll-pl-[22px] gap-3 overflow-x-auto px-gutter md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0">
        {MODELS.map((m) => (
          <article key={m.name} className="flex w-[82%] shrink-0 snap-start flex-col rounded-[18px] border border-hairline bg-card p-6 md:w-auto">
            <p className="text-[22px] tracking-[-0.02em] text-foreground">{m.name}</p>
            <p className="text-[15px] text-muted-foreground">{m.role}</p>
            <dl className="mt-8 divide-y divide-hairline border-y border-hairline">
              {m.rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-2.5">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground/70">{k}</dt>
                  <dd className="text-[15px] tabular-nums text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
            <Link to={DEMO_REPLAY_URL} className="mt-6 inline-flex h-9 items-center gap-1.5 self-start rounded-pill bg-foreground px-4 text-[13px] text-background" data-track="measured_runs" data-track-model={m.name}>
              See a run <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}

const STEPS = [
  { id: 'plan', t: 'Plan.', d: 'Every requirement pulled from the issue, the files it will touch. You approve.', m: <PlanMock />, off: 'lg:mt-0' },
  { id: 'code', t: 'Code.', d: 'Small edits, each syntax-checked and reverted if it breaks.', m: <CodeMock />, off: 'lg:mt-16' },
  { id: 'test', t: 'Test.', d: 'Your tests and type-checks in a sandbox, before and after.', m: <ChecksMock />, off: 'lg:mt-32' },
  { id: 'review', t: 'Review.', d: 'A second model checks the diff against each requirement.', m: <ReviewMock />, off: 'lg:mt-10' },
  { id: 'ship', t: 'Ship.', d: 'You publish. The PR opens from your account, linked to the issue.', m: <ShipMock />, off: 'lg:mt-24' },
]

function Shot({ children, zoom, wide }: { children: ReactNode; zoom: string; wide?: boolean }) {
  // CSS zoom (unlike transform: scale) shrinks the layout box too, so the card hugs the mockup with no dead space.
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-hairline bg-[radial-gradient(120%_90%_at_20%_10%,#dbe8ff_0%,#eef3fb_45%,#e9ecef_100%)] p-3">
      <div aria-hidden className={cn('w-[420px]', wide && 'sm:w-full sm:max-w-[560px]', zoom)}>
        {children}
      </div>
    </div>
  )
}

/** "01 · Not autocomplete": a giant index numeral and a two-tone sentence, then five staggered steps (tabs on phones). */
export function HowItWorks() {
  const [tab, setTab] = useState(0)
  const cur = STEPS[tab]!
  return (
    <section id="how" className="scroll-mt-16 px-gutter py-16 md:px-12 md:py-24">
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground">
            <span className="h-1.5 w-1.5 bg-primary" />
            How it works
          </p>
          <p aria-hidden className="mt-2 font-mono text-[88px] leading-none tracking-[-0.06em] text-foreground/[.08]">
            01
          </p>
        </div>
        <h2 className="max-w-4xl text-[clamp(1.8rem,3.4vw,2.9rem)] font-normal leading-[1.1] tracking-[-0.03em] text-foreground">
          Not autocomplete. <span className="text-muted-foreground">Pullwright takes one issue all the way to a reviewed pull request, and stops for you twice.</span>
        </h2>
      </div>

      <div className="mt-14 hidden grid-cols-5 gap-5 lg:grid">
        {STEPS.map((s) => (
          <div key={s.id} id={s.id} className={cn('scroll-mt-24', s.off)}>
            <p className="text-[15px] leading-snug text-foreground">
              {s.t} <span className="text-muted-foreground">{s.d}</span>
            </p>
            <Shot zoom="[zoom:0.34] xl:[zoom:0.46]">{s.m}</Shot>
          </div>
        ))}
      </div>

      <div className="mt-10 lg:hidden">
        <div role="tablist" aria-label="Steps" className="no-scrollbar -mx-gutter flex gap-1.5 overflow-x-auto px-gutter md:-mx-12 md:px-12">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === tab}
              onClick={() => setTab(i)}
              className={cn('min-h-9 shrink-0 rounded-pill border px-3.5 py-1.5 text-[13px] transition-colors', i === tab ? 'border-foreground bg-foreground text-background' : 'border-hairline text-foreground/70')}
            >
              <span className="mr-1.5 font-mono text-[10px] opacity-60">{i + 1}</span>
              {s.t.replace('.', '')}
            </button>
          ))}
        </div>
        <p className="mt-5 text-[15px] leading-snug text-muted-foreground">{cur.d}</p>
        <Shot wide zoom="[zoom:0.72] min-[430px]:[zoom:0.8] sm:[zoom:1]">{cur.m}</Shot>
      </div>
    </section>
  )
}
