import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ExternalLink, Loader2 } from 'lucide-react'
import SiteNav from '../components/site/SiteNav'
import SiteFooter from '../components/site/SiteFooter'
import { Frame, Section } from '../components/site/Layout'
import { MonoLabel } from '../components/site/Typography'
import { Button, Skeleton } from '../components/ui'
import { ApiError, getDemo, startDemo, type DemoInfo } from '../api/client'
import { DEMO_REPLAY_URL } from '../content/site'
import { useSeo } from '../lib/seo'

const STEPS = [
  ['Plan', 'It reads the issue and the repo and writes a plan. You approve it, or ask for changes.'],
  ['Code and test', 'It edits files in a sandbox and runs the repo’s tests until they pass.'],
  ['Review', 'A second pass checks the diff against every requirement in the issue.'],
  ['Publish', 'One click opens a real draft pull request on the demo repo.'],
]

/** Issue text as plain prose for the card preview (no backticks, bold markers or headings). */
const plain = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim()

/** The no-account live demo: pick an issue on our demo repo and watch a real run. */
export default function Demo() {
  useSeo({
    title: 'Live demo — Pullwright',
    description: 'No account needed. Pick an issue on our demo repo and watch Pullwright plan, code, test, review and open a draft pull request, live.',
    path: '/demo',
  })
  const navigate = useNavigate()
  const [info, setInfo] = useState<DemoInfo | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [starting, setStarting] = useState<number | null>(null)
  const [error, setError] = useState<{ msg: string; code?: string } | null>(null)

  useEffect(() => {
    getDemo()
      .then(setInfo)
      .catch(() => setLoadError(true))
  }, [])

  const run = async (n: number) => {
    setStarting(n)
    setError(null)
    try {
      const { taskId } = await startDemo(n)
      navigate(`/demo/${taskId}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'demo_active') {
        const id = (await getDemo().catch(() => null))?.activeTaskId ?? info?.activeTaskId
        if (id) return navigate(`/demo/${id}`)
      }
      setError({ msg: e instanceof Error ? e.message : 'The demo couldn’t start.', ...(e instanceof ApiError && e.code ? { code: e.code } : {}) })
      setStarting(null)
    }
  }

  const closed = loadError || (info && (!info.enabled || !info.open))
  const outOfRuns = info ? info.left <= 0 : false
  const repoUrl = info?.repo ? `https://github.com/${info.repo}` : null

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <Frame>
        <Section divider={false} inner="pt-14 md:pt-24 pb-10">
          <MonoLabel dot>Live demo · no account</MonoLabel>
          <h1 className="mt-5 font-serif text-[clamp(2.6rem,6vw,5rem)] font-normal leading-[0.98] tracking-[-0.02em]">
            Pick an issue. <em className="text-primary">Watch it ship.</em>
          </h1>
          <p className="mt-5 max-w-xl text-lead text-muted-foreground">
            A real run on our small demo repo{repoUrl && (
              <>
                {' '}(<a href={repoUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{info?.repo}</a>)
              </>
            )}
            . You approve the plan, watch the edits and tests, and publishing opens a real draft PR there.
          </p>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="bg-card p-5">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">{String(i + 1).padStart(2, '0')} · {t}</span>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{d}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section inner="py-12 md:py-16">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <MonoLabel index="01">Open issues</MonoLabel>
            {info && !closed && (
              <span className="text-sm text-muted-foreground" data-testid="demo-left">
                {info.left} of {info.perDay} live runs left today
              </span>
            )}
          </div>

          {info?.activeTaskId && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/[.06] px-4 py-3">
              <span className="text-sm">Your demo run is still going.</span>
              <Link to={`/demo/${info.activeTaskId}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Back to your run <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {closed && (
            <div className="mt-6 rounded-lg border border-hairline bg-card p-6">
              <p className="text-[15px]">{loadError ? 'The live demo can’t be reached right now.' : 'Today’s live demos are used up.'}</p>
              <p className="mt-1 text-sm text-muted-foreground">Watch a recorded run instead: the same pipeline, start to finish.</p>
              <Link to={DEMO_REPLAY_URL} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-pill bg-foreground px-4 text-[13px] text-background">
                Watch a recorded run <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/[.06] px-4 py-3 text-sm">
              {error.msg}{' '}
              {(error.code === 'demo_full' || error.code === 'demo_daily') && (
                <Link to={DEMO_REPLAY_URL} className="text-primary hover:underline">Watch a recorded run →</Link>
              )}
            </div>
          )}

          {!info && !loadError && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-36 rounded-lg" />
              ))}
            </div>
          )}

          {info && !closed && (
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {info.issues.map((iss) => (
                <li key={iss.number} className="flex min-w-0 flex-col rounded-lg border border-hairline bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 text-[16px] leading-snug">{iss.title}</h2>
                    <a href={iss.url} target="_blank" rel="noreferrer" aria-label={`Issue #${iss.number} on GitHub`} className="shrink-0 font-mono text-[12px] text-muted-foreground hover:text-foreground">
                      #{iss.number} <ExternalLink className="inline h-3 w-3" />
                    </a>
                  </div>
                  {iss.body && <p className="mt-2 line-clamp-3 break-words text-[13.5px] leading-relaxed text-muted-foreground">{plain(iss.body)}</p>}
                  <div className="mt-auto pt-4">
                    <Button
                      size="sm"
                      variant="primary"
                      shape="pill"
                      disabled={starting !== null || outOfRuns || Boolean(info.activeTaskId)}
                      onClick={() => void run(iss.number)}
                      data-track="demo_run"
                      data-track-issue={String(iss.number)}
                    >
                      {starting === iss.number ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {starting === iss.number ? 'Starting…' : 'Run it live'}
                      {starting !== iss.number && <ArrowRight className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {info && !closed && outOfRuns && (
            <p className="mt-6 text-sm text-muted-foreground">
              That’s your live runs for today. <Link to={DEMO_REPLAY_URL} className="text-primary hover:underline">Watch a recorded run</Link>, or{' '}
              <Link to="/login" className="text-primary hover:underline">sign in</Link> to run Pullwright on your own issues.
            </p>
          )}

          <p className="mt-10 text-sm text-muted-foreground">
            Runs use a small model on our budget, capped per run. Demo PRs are drafts and are closed after a day.
          </p>
        </Section>
      </Frame>
      <div className="band-dark">
        <Frame>
          <SiteFooter />
        </Frame>
      </div>
    </div>
  )
}
