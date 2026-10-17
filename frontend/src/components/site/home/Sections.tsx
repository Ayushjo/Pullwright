import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Gauge, KeyRound, Lock, Play, Route, Scale, ShieldCheck, Sparkles, Triangle, WifiOff, Zap, MousePointerClick } from 'lucide-react'
import GithubMark from '../../svgs/GithubMark'
import { Section } from '../Layout'
import { MonoLabel, TwoToneHeading } from '../Typography'
import ProductShot from '../ProductShot'
import { ChangelogList, FeatureCard, IconGrid, StepRow } from '../Blocks'
import { Button } from '../../ui'
import { CHANGELOG } from '../../../content/changelog'
import { DEMO_PR_URL, DEMO_REPLAY_URL } from '../../../content/site'
import { AssumptionsMock, ChecksMock, CodeMock, KeysMock, ParkedMock, PlanMock, ReviewMock, ScreenshotMock, ShipMock } from './Mocks'

/** Instead of customer logos (we have none): the model providers Pullwright works with, as plain wordmarks. */
export function BuiltOn() {
  const names = ['Google Gemini', 'Groq', 'Vercel AI Gateway', 'OpenRouter', 'OpenAI']
  return (
    <section className="border-t border-hairline">
      <div className="px-gutter md:px-12 py-8 flex flex-col md:flex-row md:items-center gap-5 md:gap-10">
        <MonoLabel className="shrink-0">Works with the models you already have</MonoLabel>
        <ul className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {names.map((n) => (
            <li key={n} className="text-[17px] sm:text-lg tracking-[-0.01em] text-foreground/45">
              {n}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function Features() {
  return (
    <Section id="features">
      <TwoToneHeading muted="Every change," strong="checked before you see it" />
      <div className="mt-12 grid gap-x-8 md:grid-cols-2">
        <FeatureCard
          media={<ProductShot backdrop="sky" className="h-full" inner="h-full flex items-center justify-center"><ChecksMock /></ProductShot>}
          title="Runs your tests in a sandbox"
          text="Every edit is checked: your type-check, your tests, and guards against deleted tests or empty files — in a sandbox with no network and no credentials."
        />
        <FeatureCard
          media={<ProductShot backdrop="mist" className="h-full" inner="h-full flex items-center justify-center"><KeysMock /></ProductShot>}
          title="Gets the most from free models"
          text="A free Gemini key plans and writes the code; Groq reviews; a Vercel credit plans with a stronger model. Free keys always go first."
          link={{ to: '/pricing', label: 'Three ways to use it' }}
        />
      </div>
      <div className="mt-2 grid gap-x-8 md:grid-cols-3">
        <FeatureCard size="sm" media={<ProductShot backdrop="dusk" className="h-full" inner="h-full flex items-center justify-center"><ParkedMock /></ProductShot>} title="Pauses on free quota, never fails" text="When a free model runs out for the day, the task saves its place and continues at the reset — or right away if you add a key." />
        <FeatureCard size="sm" media={<ProductShot backdrop="sky" className="h-full" inner="h-full flex items-center justify-center"><ScreenshotMock /></ProductShot>} title="Reads screenshots in issues" text="Images in the issue are read once on a free vision model and shown to you, so a misread is caught before any code is written." />
        <FeatureCard size="sm" media={<ProductShot backdrop="mist" className="h-full" inner="h-full flex items-center justify-center"><AssumptionsMock /></ProductShot>} title="Asks when the issue is vague" text="Instead of guessing, it offers the options it sees — one click picks, and the plan follows your choice." />
      </div>
    </Section>
  )
}

export function Steps() {
  return (
    <Section id="how">
      <TwoToneHeading muted="From issue to merged PR," strong="Pullwright does the work, you make the calls." />
      <div className="mt-16 space-y-20 md:space-y-28">
        <div id="plan" className="scroll-mt-24">
          <StepRow
            n="01"
            title="Understand and plan"
            text="It maps your repo, extracts every requirement from the issue and proposes a short plan with the files it will touch. You approve it, or edit it first."
            link={{ to: DEMO_REPLAY_URL, label: 'See a real plan' }}
            media={<ProductShot backdrop="sky"><PlanMock /></ProductShot>}
          />
        </div>
        <div id="code" className="scroll-mt-24">
          <StepRow
            flip
            n="02"
            title="Code and test"
            text="Targeted edits, each syntax-checked and reverted if it breaks something. Your tests and type-checks run in an isolated sandbox you can watch live."
            link={{ to: DEMO_REPLAY_URL, label: 'Watch a replay' }}
            media={<ProductShot backdrop="mist"><CodeMock /></ProductShot>}
          />
        </div>
        <div id="review" className="scroll-mt-24">
          <StepRow
            n="03"
            title="Review"
            text="A validation gate and a separate review pass check the diff against every requirement. Anything missing goes back for a fix before you see it."
            media={<ProductShot backdrop="dusk"><ReviewMock /></ProductShot>}
          />
        </div>
        <div id="ship" className="scroll-mt-24">
          <StepRow
            flip
            n="04"
            title="Ship the PR"
            text="You read the diff, drop any file you don't want, and click publish. The PR opens from your account, on a real branch, linked to the issue."
            link={{ to: DEMO_PR_URL, label: 'View the PR' }}
            media={<ProductShot backdrop="sky"><ShipMock /></ProductShot>}
          />
        </div>
      </div>
    </Section>
  )
}

export function Demo() {
  const [hasVideo, setHasVideo] = useState(false)
  useEffect(() => {
    // Show the recorded demo only once public/demo.mp4 exists.
    fetch('/demo.mp4', { method: 'HEAD' })
      .then((r) => setHasVideo(r.ok && (r.headers.get('content-type') ?? '').startsWith('video')))
      .catch(() => setHasVideo(false))
  }, [])
  return (
    <Section id="demo">
      <TwoToneHeading muted="See it work," strong="a real run, sped up" />
      <div className="mt-10 rounded-lg overflow-hidden border border-hairline">
        <div className="aspect-video bg-code relative">
          {hasVideo ? (
            <video className="w-full h-full object-cover" controls playsInline poster="/demo-poster.png">
              <source src="/demo.mp4" type="video/mp4" />
            </video>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <span className="w-14 h-14 rounded-full bg-white/10 border border-white/15 flex items-center justify-center">
                <Play className="w-6 h-6 text-white ml-0.5" fill="white" fillOpacity={0.85} />
              </span>
              <p className="text-white text-xl sm:text-2xl tracking-[-0.02em]">Replay a real task</p>
              <p className="text-white/55 text-sm max-w-sm">Plan, edits, tests, review and the PR — at up to 50× speed. No sign-in needed.</p>
              <Link to={DEMO_REPLAY_URL} className="mt-1 inline-flex rounded-pill bg-white text-foreground text-sm px-4 py-2 hover:bg-white/90">
                Watch the replay
              </Link>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

export function Keys() {
  return (
    <Section id="keys">
      <TwoToneHeading muted="Bring the keys you have," strong="free ones go first" />
      <IconGrid
        className="mt-12"
        items={[
          { icon: Sparkles, title: 'Google Gemini', line: 'Plans and writes the code — free, no card' },
          { icon: Zap, title: 'Groq', line: 'Reviews patches and reads screenshots — free' },
          { icon: Triangle, title: 'Vercel AI Gateway', line: '$5 of free credit every month' },
          { icon: Route, title: 'OpenRouter', line: 'One key, many models, free ones included' },
          { icon: KeyRound, title: 'OpenAI', line: 'Your paid key, used only after the free ones' },
          { icon: GithubMark, title: 'GitHub', line: 'Reads the issue, opens the PR from your account' },
          { icon: Lock, title: 'Private repos', line: 'Never sent to models that train without your OK' },
          { icon: Gauge, title: 'Spend caps', line: 'Every task has a hard limit on what it can spend' },
        ]}
      />
    </Section>
  )
}

export function Shipped() {
  return (
    <Section id="shipped">
      <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <TwoToneHeading strong="Recently shipped" />
          <p className="mt-3 text-[15px] text-muted-foreground max-w-xs">What changed lately, straight from the commit history.</p>
        </div>
        <ChangelogList entries={CHANGELOG} />
      </div>
    </Section>
  )
}

export function Safety() {
  return (
    <Section id="safety">
      <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <TwoToneHeading strongFirst strong="Safe by default" muted="nothing ships without you" />
        <IconGrid
          cols={2}
          items={[
            { icon: WifiOff, title: 'No network in the sandbox', line: 'Dependencies install first; then the network is cut.' },
            { icon: ShieldCheck, title: 'Your token stays outside', line: 'Your GitHub token never enters the sandbox.' },
            { icon: MousePointerClick, title: 'No PR without your click', line: 'You review the diff; publishing is always your call.' },
            { icon: Lock, title: 'Private stays private', line: 'Private repos only reach models that don’t train, unless you allow it.' },
            { icon: Ban, title: 'Hard spend limits', line: 'Every task stops at its cap, and daily limits are enforced.' },
            { icon: Scale, title: 'Open source', line: 'MIT licensed — read every line of what runs your code.' },
          ]}
        />
      </div>
    </Section>
  )
}

export function ClosingCta({ onStart }: { onStart: () => void }) {
  return (
    <Section inner="py-24 md:py-36 text-center">
      <TwoToneHeading size="display" muted="Stop triaging by hand." strong="Let Pullwright open the PR." className="mx-auto max-w-3xl" />
      <div className="mt-9 flex flex-wrap justify-center gap-3">
        <Button variant="primary" shape="pill" size="lg" data-track="start_free" data-track-where="home_footer" onClick={onStart}>
          Start free
        </Button>
        <Link to="/pricing">
          <Button variant="outline" shape="pill" size="lg" tabIndex={-1}>
            See pricing
          </Button>
        </Link>
      </div>
    </Section>
  )
}
