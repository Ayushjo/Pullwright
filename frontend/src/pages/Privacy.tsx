import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import SiteNav from '../components/site/SiteNav'
import SiteFooter from '../components/site/SiteFooter'
import { Frame, Section } from '../components/site/Layout'
import { MonoLabel } from '../components/site/Typography'
import { useSeo } from '../lib/seo'

/**
 * Privacy policy — DRAFT, written from what the code actually does (analytics/track.ts, api/analyticsRouter.ts,
 * auth/session.ts, wallet/credentials.ts, llm/registry.ts). The owner must review it before launch; items in
 * [brackets] are decisions still to make.
 */
const UPDATED = 'October 17, 2026'
const CONTACT = 'believemeguysamrevx@gmail.com'

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: 'summary',
    title: 'The short version',
    body: (
      <ul>
        <li>We collect what we need to run tasks on your repositories, bill you, and understand how the product is used.</li>
        <li>No advertising, no third-party trackers, no selling or renting of data.</li>
        <li>We don't store IP addresses in analytics. If your browser sends Do Not Track or Global Privacy Control, we don't track your anonymous visits at all.</li>
        <li>Your code goes to the model provider you (or the plan you're on) chose, only for the task you started.</li>
      </ul>
    ),
  },
  {
    id: 'account',
    title: 'Your GitHub account',
    body: (
      <>
        <p>
          You sign in with GitHub. We receive your username, display name, avatar and public profile, and an access token with the <code>repo</code> and <code>read:user</code> scopes. Pullwright
          needs the token to read the issue, clone the repository into a sandbox and, only when you approve, push a branch and open the pull request.
        </p>
        <p>The token is encrypted at rest (AES-256-GCM) and is never shown in the app, logs or replays. You can revoke it at any time in GitHub → Settings → Applications.</p>
      </>
    ),
  },
  {
    id: 'code',
    title: 'Your code and tasks',
    body: (
      <>
        <p>
          For each task we clone the repository into an isolated, short-lived sandbox, run the plan, the edits and your tests there, and destroy it when the task ends. We keep the task record: the
          issue, the plan, the diff, test output, the review, model usage and cost, so you can see the history and replay it.
        </p>
        <p>
          Replay links (<code>/r/…</code>) are only public if you share one. A run's working copy and full diff are kept for 30 days after its last change, so you can still publish it; after that it's archived and read-only. The task record (issue, plan, summary, review, cost) stays until you delete it or your account.
        </p>
      </>
    ),
  },
  {
    id: 'models',
    title: 'Model providers',
    body: (
      <>
        <p>
          To plan, write and review code, the relevant parts of your repository and issue are sent to a large-language-model provider. Which one depends on how the task is funded:
        </p>
        <ul>
          <li>
            <strong>Your own key</strong> (OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, Vercel AI Gateway, DeepSeek, Mistral, Cerebras, NVIDIA, Hugging Face or a custom endpoint): the request goes to that
            provider under your account and its terms. Keys are encrypted at rest and only decrypted on the worker running your task.
          </li>
          <li>
            <strong>Free tasks and credits</strong>: we send the request with our own Anthropic (Claude) account. Anthropic does not train on API data.
          </li>
        </ul>
        <p>
          Some free tiers do use data for training, notably Google Gemini's free tier and some OpenRouter free models. The Model keys page labels each provider's policy so you can choose. Don't run tasks on
          code you can't share with the provider you picked.
        </p>
      </>
    ),
  },
  {
    id: 'payments',
    title: 'Payments',
    body: (
      <p>
        Payments are handled by Dodo Payments, our merchant of record. They collect your card and billing details; we never see or store card numbers. We keep what we need for your balance and receipts:
        the plan, credit packs, amounts and dates.
      </p>
    ),
  },
  {
    id: 'analytics',
    title: 'Product analytics',
    body: (
      <>
        <p>We run our own analytics, stored in our own database. No third-party scripts and no advertising cookies.</p>
        <ul>
          <li>
            <strong>In your browser</strong>: a random visitor ID in local storage and a session ID that resets after 30 minutes idle. We record page views, clicks on main buttons, links to other sites,
            and the page that brought you here (referrer domain and UTM tags, with other query strings removed).
          </li>
          <li>
            <strong>On our server</strong>: product events such as sign-up, sign-in, task started or finished, pull request opened, a limit reached, keys added or removed, and purchases.
          </li>
          <li>
            <strong>Context</strong>: country (from our network provider, not stored as an IP), and device type, browser and OS (from the user agent). <strong>We don't store your IP address</strong> with these events.
          </li>
        </ul>
        <p>
          <strong>Opting out:</strong> turn on Do Not Track or Global Privacy Control (Brave sends it by default) and we won't record anonymous visits. While you're signed in, product events are part of
          running the service and are still recorded.
        </p>
        <p>Raw analytics events are kept for 13 months, then deleted automatically.</p>
      </>
    ),
  },
  {
    id: 'sharing',
    title: 'Who else processes data',
    body: (
      <ul>
        <li>GitHub: sign-in and the repositories you use.</li>
        <li>The model provider for each task (above).</li>
        <li>Dodo Payments: billing.</li>
        <li>Our infrastructure: Neon (the database) and our server host. [Name the server host and Cloudflare once deployed.]</li>
      </ul>
    ),
  },
  {
    id: 'rights',
    title: 'Your choices',
    body: (
      <>
        <p>You can remove model keys at any time on the Model keys page, revoke GitHub access, and ask us to export or delete your account and its data.</p>
        <p>
          Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we'll reply within 30 days. Pullwright is run by an individual developer (GitHub: @Ayushjo), who is responsible for this data.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes',
    body: <p>If this policy changes in a way that matters, we'll update the date above and tell signed-in users in the app.</p>,
  },
]

export default function Privacy() {
  useSeo({
    title: 'Privacy — Pullwright',
    description: 'What Pullwright collects, why, who processes it, and how to opt out. First-party analytics only, no IP addresses stored, Do Not Track and GPC respected.',
    path: '/privacy',
  })
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <Frame>
        <Section divider={false} inner="pt-14 md:pt-24 pb-10">
          <MonoLabel dot>Privacy · updated {UPDATED}</MonoLabel>
          <div className="mt-5">
            <h1 className="font-serif text-[clamp(3rem,6.4vw,5.5rem)] font-normal leading-[0.98] tracking-[-0.02em] text-foreground">
              What we collect, <em className="text-primary">and why.</em>
            </h1>
          </div>
          <p className="mt-5 max-w-xl text-lead text-muted-foreground">Written in plain words from what the code actually does. Questions go to {CONTACT}.</p>
          <p className="mt-6 inline-block rounded bg-primary/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-primary">Draft — pending review</p>
        </Section>
        <Section inner="py-12 md:py-16">
          <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
            <nav aria-label="On this page" className="hidden lg:block">
              <ul className="space-y-2 text-sm">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground transition-colors">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="max-w-2xl space-y-12">
              {SECTIONS.map((s, i) => (
                <section key={s.id} id={s.id} className="scroll-mt-24">
                  <MonoLabel index={String(i + 1).padStart(2, '0')}>{s.title}</MonoLabel>
                  <div className="prose-legal mt-4 space-y-4 text-[15px] leading-relaxed text-muted-foreground [&_a]:text-primary [&_a:hover]:underline [&_code]:rounded [&_code]:bg-black/[.05] [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] [&_li]:pl-1 [&_strong]:font-normal [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                    {s.body}
                  </div>
                </section>
              ))}
              <p className="text-sm text-muted-foreground">
                See also <Link to="/pricing" className="text-primary hover:underline">Pricing</Link> for how tasks are funded.
              </p>
            </div>
          </div>
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
