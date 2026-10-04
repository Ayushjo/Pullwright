import { motion, useReducedMotion } from 'framer-motion'
import { Check, CircleDot, Eye, FileCode2, GitPullRequest, Loader2, PauseCircle, ScanSearch, Code2 } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { Window } from '../ProductShot'

/*
 * Small static replicas of real Pullwright screens, used as the "screenshots" on Home. They copy the
 * real components' look (TaskView, ActivityFeed, PlanCard, ParkedBanner, Wallet, ReviewPanel) with
 * sample content from an actual run (Ayushjo/devin-test-app #3 → PR #4).
 */

const FEED = [
  { k: 'phase', t: 'PLANNING', d: 'Reading the code and drafting a plan' },
  { k: 'ok', t: 'Plan approved · 5 requirements' },
  { k: 'tool', t: 'read', d: 'src/math.js  1–42' },
  { k: 'tool', t: 'patch', d: 'src/math.js  +12 −0' },
  { k: 'tool', t: 'patch', d: 'test/math.test.js  +3 −1' },
  { k: 'tool', t: 'shell', d: 'npm test' },
  { k: 'ok', t: 'Validation passed · 18 tests, 0 new failures' },
  { k: 'ok', t: 'Reviewer: 5/5 requirements met' },
] as const

function FeedLine({ line, i, animate }: { line: (typeof FEED)[number]; i: number; animate: boolean }) {
  const body =
    line.k === 'phase' ? (
      <div className="flex items-center gap-2 pt-1">
        <span className="font-mono text-[9.5px] tracking-[0.08em] text-muted-foreground">{line.t}</span>
        <span className="text-[10.5px] text-muted-foreground truncate">· {line.d}</span>
        <span className="flex-1 h-px bg-hairline" />
      </div>
    ) : line.k === 'ok' ? (
      <div className="flex items-center gap-2 text-[11.5px] text-success">
        <Check className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{line.t}</span>
      </div>
    ) : (
      <div className="flex items-center gap-2 text-[11.5px] text-foreground/75">
        <FileCode2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-[10.5px] text-muted-foreground w-9 shrink-0">{line.t}</span>
        <span className="font-mono text-[10.5px] truncate">{line.d}</span>
      </div>
    )
  if (!animate) return body
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.35 + i * 0.22, duration: 0.25 }}>
      {body}
    </motion.div>
  )
}

/** The PR card that floats over the hero (and stands alone in "Ship"). */
export function PrCard({ className }: { className?: string }) {
  return (
    <Window chrome={false} className={cn('p-4 w-[280px]', className)}>
      <div className="flex items-center gap-1.5 text-[11px] text-success">
        <GitPullRequest className="w-3.5 h-3.5" />
        <span>PR open</span>
        <span className="text-muted-foreground">· Ayushjo/devin-test-app #4</span>
      </div>
      <p className="mt-2 text-[15px] text-foreground leading-snug">feat: add a modulo(a, b) helper to math.js</p>
      <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
        <span className="text-primary">pullwright/issue-3</span> → main
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-hairline pt-3">
        {[
          ['Diff', <><span className="text-success">+15</span> <span className="text-danger">−1</span></>],
          ['Review', '5/5 met'],
          ['Cost', '$0.047'],
        ].map(([k, v]) => (
          <div key={k as string}>
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">{k}</p>
            <p className="text-[12px] text-foreground mt-0.5">{v}</p>
          </div>
        ))}
      </div>
      <span className="mt-3 inline-flex rounded-pill bg-foreground text-white text-[11px] px-3 py-1">View PR</span>
    </Window>
  )
}

/** Hero: the task screen (checklist + live activity) with the PR card floating on the right. */
export function HeroMock() {
  const reduce = useReducedMotion()
  return (
    <div className="relative">
      <Window title="Add a modulo(a, b) helper to math.js · Ayushjo/devin-test-app" className="max-w-[860px]">
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] min-h-[300px]">
          <aside className="hidden sm:block border-r border-hairline bg-background/60 p-3.5">
            <p className="font-mono text-[9.5px] tracking-[0.08em] text-muted-foreground">CHECKLIST</p>
            <ul className="mt-2.5 space-y-2">
              {['modulo(a, b) in math.js', 'Throws on b = 0', 'Exported with the others', 'Tests for both cases', 'Existing tests still pass'].map((r, i) => (
                <li key={r} className="flex items-start gap-2 text-[11.5px] text-foreground/80">
                  <span className="font-mono text-[9.5px] text-muted-foreground mt-px">R{i + 1}</span>
                  <Check className="w-3.5 h-3.5 text-success shrink-0" />
                  <span className="leading-tight">{r}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 font-mono text-[9.5px] tracking-[0.08em] text-muted-foreground">STATUS</p>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-pill border border-green-200 bg-green-50 text-success text-[11px] px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Ready to publish
            </span>
          </aside>
          <div className="p-3.5 sm:p-4 space-y-2.5 min-w-0">
            <div className="flex items-center gap-1 pb-2 border-b border-hairline text-[11px]">
              <span className="px-2 py-0.5 rounded-pill bg-black/[.05] text-foreground">Activity</span>
              <span className="px-2 py-0.5 text-muted-foreground">Changes 2</span>
              <span className="px-2 py-0.5 text-muted-foreground">Review</span>
            </div>
            {FEED.map((l, i) => (
              <FeedLine key={i} line={l} i={i} animate={!reduce} />
            ))}
          </div>
        </div>
      </Window>
      <motion.div
        initial={reduce ? false : { opacity: 0, x: 24 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ delay: reduce ? 0 : 2.3, type: 'spring', stiffness: 220, damping: 26 }}
        className="hidden lg:block absolute right-0 top-10"
      >
        <PrCard />
      </motion.div>
    </div>
  )
}

/** Checks in the sandbox: baseline, then verification chips. */
export function ChecksMock() {
  return (
    <Window title="Sandbox · no network" className="h-full">
      <div className="p-4 space-y-3 text-[12px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-mono text-[9.5px] tracking-[0.08em]">BASELINE</span>
          <span className="flex-1 h-px bg-hairline" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] bg-black/[.04] rounded px-1.5 py-0.5">npm test</span>
          <span className="text-success">18 passed</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground pt-1">
          <span className="font-mono text-[9.5px] tracking-[0.08em]">AFTER EDITS</span>
          <span className="flex-1 h-px bg-hairline" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['tsc --noEmit', 'npm test', 'eslint', 'no deleted tests', 'no empty files'].map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-pill border border-green-200 bg-green-50 text-success px-2 py-0.5 text-[11px]">
              <Check className="w-3 h-3" />
              {c}
            </span>
          ))}
        </div>
        <div className="rounded-md border border-hairline bg-background/60 p-2.5 font-mono text-[10.5px] text-foreground/70 leading-relaxed">
          ✓ modulo › returns a % b<br />✓ modulo › throws on b = 0<br />
          <span className="text-success">Tests: 20 passed, 20 total</span>
        </div>
      </div>
    </Window>
  )
}

/** The keys a free user brings, as on the Wallet page. */
export function KeysMock() {
  const keys = [
    { m: 'G', name: 'Google Gemini', tag: 'Free', note: 'Plans and writes the code', tint: 'bg-sky-50 text-sky-700 border-sky-200' },
    { m: 'Gq', name: 'Groq', tag: 'Free', note: 'Reviews and reads screenshots', tint: 'bg-orange-50 text-orange-700 border-orange-200' },
    { m: '▲', name: 'Vercel AI Gateway', tag: 'Free credit', note: '$4.92 of $5 left this month', tint: 'bg-neutral-100 text-neutral-900 border-neutral-300' },
  ]
  return (
    <Window title="Model keys" className="h-full">
      <div className="p-4 space-y-2.5">
        <div className="grid grid-cols-3 border border-hairline rounded-md divide-x divide-hairline text-[10.5px]">
          {[
            [Code2, 'Plan & code'],
            [ScanSearch, 'Review'],
            [Eye, 'Screenshots'],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Code2
            return (
              <div key={label as string} className="flex items-center gap-1.5 px-2 py-2 text-foreground/80 min-w-0">
                <I className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="truncate">{label as string}</span>
                <Check className="w-3.5 h-3.5 text-primary ml-auto shrink-0" />
              </div>
            )
          })}
        </div>
        {keys.map((k) => (
          <div key={k.name} className="flex items-center gap-3 rounded-md border border-hairline px-3 py-2.5">
            <span className={cn('w-8 h-8 rounded-md border flex items-center justify-center text-[11px] font-semibold shrink-0', k.tint)}>{k.m}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-foreground truncate">{k.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{k.note}</p>
            </div>
            <span className="rounded-pill border border-green-200 bg-green-50 text-success text-[10.5px] px-2 py-0.5 shrink-0">{k.tag}</span>
          </div>
        ))}
      </div>
    </Window>
  )
}

/** The paused banner from the task screen. */
export function ParkedMock() {
  return (
    <Window chrome={false} className="h-full p-4">
      <div className="flex items-start gap-2.5">
        <PauseCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[12.5px] text-foreground leading-snug">Paused while the free quota resets — resumes in 3 h 12 min</p>
          <p className="text-[11px] text-muted-foreground mt-1">Your progress is saved; it continues exactly where it stopped.</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2 pl-6">
        <span className="rounded-pill border border-black/15 text-[11px] px-2.5 py-0.5">Resume now</span>
        <span className="text-[11px] text-muted-foreground px-1 py-0.5">Cancel</span>
      </div>
      <div className="mt-4 space-y-1.5 pl-6">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono text-[9.5px] tracking-[0.08em]">PAUSED</span>
          <span className="flex-1 h-px bg-hairline" />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono text-[9.5px] tracking-[0.08em]">RESUMED</span>
          <span className="truncate">· step 23 of 60</span>
          <span className="flex-1 h-px bg-hairline" />
        </div>
      </div>
    </Window>
  )
}

/** An issue screenshot and what Pullwright read from it. */
export function ScreenshotMock() {
  return (
    <Window chrome={false} className="h-full p-4">
      <div className="flex gap-3">
        <div className="w-20 h-16 rounded border border-hairline bg-[linear-gradient(135deg,#f4f6fa,#e6ebf3)] p-1.5 shrink-0">
          <div className="h-1.5 w-10 bg-black/15 rounded-sm" />
          <div className="mt-1.5 h-1 w-14 bg-black/10 rounded-sm" />
          <div className="mt-1 h-1 w-12 bg-black/10 rounded-sm" />
          <div className="mt-2 h-2.5 w-9 bg-red-300/70 rounded-sm" />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[9.5px] tracking-[0.08em] text-muted-foreground">PULLWRIGHT READ THIS AS</p>
          <p className="mt-1.5 text-[11.5px] text-foreground/85 leading-snug">Cart shows "Total: $NaN" after a fixed discount code is applied.</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Screenshot · read on a free vision model</p>
    </Window>
  )
}

/** A vague issue becomes a choice instead of a guess. */
export function AssumptionsMock() {
  return (
    <Window chrome={false} className="h-full p-4">
      <p className="font-mono text-[9.5px] tracking-[0.08em] text-primary">ASSUMPTIONS — PICK ONE</p>
      <p className="mt-2 text-[12px] text-foreground leading-snug">"Books endpoint returns too much data"</p>
      <div className="mt-2.5 space-y-1.5">
        {[
          ['Paginate with ?page & ?limit', true],
          ['Drop fields from each book', false],
        ].map(([t, on]) => (
          <div key={t as string} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11.5px]', on ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-hairline text-muted-foreground')}>
            <span className={cn('w-3 h-3 rounded-full border flex items-center justify-center', on ? 'border-primary' : 'border-neutral-300')}>{on && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}</span>
            {t as string}
          </div>
        ))}
      </div>
    </Window>
  )
}

/** The plan you approve: steps, files, requirements, size. */
export function PlanMock() {
  return (
    <Window title="Plan · awaiting your approval">
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9.5px] tracking-[0.08em] text-primary">PLAN</span>
          <span className="rounded-pill bg-black/[.05] text-[10.5px] px-2 py-0.5">Small · ~11 requests</span>
          <span className="rounded-pill bg-black/[.05] text-[10.5px] px-2 py-0.5">Clear issue</span>
        </div>
        <ol className="mt-3 space-y-2">
          {['Add modulo(a, b) next to the other helpers', 'Throw a RangeError when b is 0, like divide()', 'Export it and add tests for both cases'].map((s, i) => (
            <li key={s} className="flex gap-2.5 text-[12px] text-foreground/85">
              <span className="font-mono text-[10.5px] text-muted-foreground mt-px">{String(i + 1).padStart(2, '0')}</span>
              {s}
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {['src/math.js', 'test/math.test.js'].map((f) => (
            <span key={f} className="font-mono text-[10.5px] rounded bg-black/[.04] px-1.5 py-0.5 text-foreground/70">{f}</span>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <span className="rounded-pill bg-foreground text-white text-[11px] px-3 py-1">Approve plan</span>
          <span className="rounded-pill border border-black/15 text-[11px] px-3 py-1">Edit</span>
        </div>
      </div>
    </Window>
  )
}

/** Live activity next to the diff it produced. */
export function CodeMock() {
  return (
    <Window title="src/math.js · +12 −0">
      <div className="font-mono text-[10.5px] leading-[1.7]">
        {[
          ['  ', 'export function divide(a, b) {', ''],
          ['  ', "  if (b === 0) throw new RangeError('b is 0')", ''],
          ['  ', '}', ''],
          ['+ ', 'export function modulo(a, b) {', 'add'],
          ['+ ', "  if (b === 0) throw new RangeError('b is 0')", 'add'],
          ['+ ', '  return a % b', 'add'],
          ['+ ', '}', 'add'],
        ].map(([s, l, k], i) => (
          <div key={i} className={cn('px-3 whitespace-pre truncate', k === 'add' ? 'bg-green-50 text-green-900' : 'text-foreground/70')}>
            <span className="text-muted-foreground select-none">{s}</span>
            {l}
          </div>
        ))}
      </div>
      <div className="border-t border-hairline px-3 py-2 flex items-center gap-2 text-[11px]">
        <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
        <span className="font-mono text-[10.5px] text-muted-foreground">shell</span>
        <span className="font-mono text-[10.5px]">npm test</span>
      </div>
    </Window>
  )
}

/** The independent review against the issue's requirements. */
export function ReviewMock() {
  return (
    <Window title="Review">
      <div className="p-4 space-y-3">
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2">
          <p className="text-[12px] text-success">Approved · 5/5 requirements met</p>
          <p className="text-[11px] text-green-900/70 mt-0.5">A separate review pass checks the diff against every requirement.</p>
        </div>
        <div>
          <p className="font-mono text-[9.5px] tracking-[0.08em] text-muted-foreground">VALIDATION</p>
          <ul className="mt-1.5 divide-y divide-hairline border-y border-hairline">
            {['Type check', 'Tests (20)', 'No deleted tests', 'Diff matches the plan'].map((c) => (
              <li key={c} className="flex items-center justify-between py-1.5 text-[11.5px]">
                <span className="text-foreground/80">{c}</span>
                <Check className="w-3.5 h-3.5 text-success" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Window>
  )
}

/** Issue → PR, side by side. */
export function ShipMock() {
  return (
    <div className="grid sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
      <Window chrome={false} className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] text-success">
          <CircleDot className="w-3.5 h-3.5" />
          Open issue · #3
        </div>
        <p className="mt-2 text-[14px] text-foreground leading-snug">Add a modulo(a, b) helper to math.js</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Ayushjo/devin-test-app</p>
      </Window>
      <span className="hidden sm:block font-mono text-faint text-lg">→</span>
      <PrCard className="w-auto" />
    </div>
  )
}
