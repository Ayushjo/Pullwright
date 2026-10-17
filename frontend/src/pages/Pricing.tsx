import { Fragment, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Minus, Plus } from 'lucide-react'
import { Button } from '../components/ui'
import { HandCircle } from '../components/hand/Scribbles'
import { useAuth } from '../context/AuthContext'
import { startCheckout } from '../api/client'
import { cn } from '../lib/cn'
import { fadeUp, stagger } from '../lib/motion'
import SiteNav from '../components/site/SiteNav'
import SiteFooter from '../components/site/SiteFooter'
import { Frame, Section } from '../components/site/Layout'
import { ArrowLink, MonoLabel, TwoToneHeading } from '../components/site/Typography'
import { COMPARE, FAQ, WAYS, type Way } from '../content/plans'
import { softwareJsonLd, useSeo } from '../lib/seo'

function PlanColumn({ way, onCta, busy }: { way: Way; onCta: (w: Way) => void; busy: boolean }) {
  const solid = way.id !== 'keys'
  return (
    // On desktop each card is a 5-row subgrid (header, price, blurb, button, list), so buttons and lists
    // line up across the three columns whatever the blurb length.
    <motion.div variants={fadeUp} className="flex flex-col lg:grid lg:grid-rows-subgrid lg:row-span-5 lg:gap-y-0 rounded-lg border border-hairline bg-card p-6 sm:p-7 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[26px] font-normal tracking-[-0.02em] text-foreground leading-tight">{way.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{way.who}</p>
        </div>
        {way.tag && <MonoLabel className="shrink-0 rounded bg-primary/10 text-primary px-2 py-1">{way.tag}</MonoLabel>}
      </div>

      <div className="mt-7 flex flex-wrap items-end gap-x-3 gap-y-1 min-h-[64px]">
        {way.id === 'free' ? (
          <span className="relative inline-block px-1 text-[56px] leading-none tracking-[-0.03em] text-foreground">
            {way.price}
            <HandCircle className="text-primary/70 -inset-x-3 -inset-y-2.5 w-[calc(100%+1.5rem)] h-[calc(100%+1.25rem)]" delay={0.6} />
          </span>
        ) : (
          <span className={cn('leading-none tracking-[-0.03em] text-foreground', way.price.startsWith('$') ? 'text-[56px]' : 'text-[34px] pb-1 whitespace-nowrap')}>{way.price}</span>
        )}
        <MonoLabel className="pb-1.5">{way.per}</MonoLabel>
      </div>

      <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">{way.blurb}</p>

      <Button variant={solid ? 'primary' : 'outline'} className="mt-6 w-full h-11 rounded-md text-[15px] self-end" data-track="plan_cta" data-track-plan={way.id} loading={busy} onClick={() => onCta(way)}>
        {busy ? 'Opening checkout…' : way.cta.label}
      </Button>

      <div className="mt-7 border-t border-hairline pt-5">
        <MonoLabel>{way.includes}</MonoLabel>
        <ul className="mt-3 divide-y divide-hairline">
          {way.features.map((f) => (
            <li key={f} className="flex gap-3 py-3 text-[15px] text-foreground leading-snug">
              <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  )
}

function Cell({ v }: { v: string | boolean }) {
  if (v === true) return <Check className="w-4 h-4 text-primary" aria-label="Included" />
  if (v === false) return <Minus className="w-4 h-4 text-faint" aria-label="Not needed" />
  return <span>{v}</span>
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-b border-hairline">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full flex items-center justify-between gap-6 py-5 text-left focus-ring rounded-sm">
        <span className="text-[17px] sm:text-lg text-foreground tracking-[-0.01em]">{q}</span>
        <Plus className={cn('w-5 h-5 text-muted-foreground shrink-0 transition-transform duration-200', open && 'rotate-45')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <p className="pb-5 pr-10 text-[15px] leading-relaxed text-muted-foreground max-w-3xl">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

export default function Pricing() {
  useSeo({
    title: 'Pricing — free with Claude, your own keys, or Pro',
    description: 'Start free with 10 Claude tasks a month and no key, go unlimited with a free Gemini key, bring your own paid keys, or get Pro for $8/month with Claude Sonnet usage included.',
    path: '/pricing',
    jsonLd: [
      softwareJsonLd,
      { '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  })
  const { user } = useAuth()
  const navigate = useNavigate()
  const [checkout, setCheckout] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })

  const onCta = async (w: Way) => {
    if (!user) return navigate(`/login?returnTo=${encodeURIComponent(w.id === 'pro' ? '/pricing' : w.cta.to)}`)
    if (w.id !== 'pro') return navigate(w.cta.to)
    setCheckout({ busy: true, error: null })
    try {
      window.location.href = (await startCheckout()).url
    } catch (e) {
      setCheckout({ busy: false, error: (e as Error).message })
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <Frame>
        {/* Header */}
        <section className="px-gutter md:px-12 pt-14 md:pt-24 pb-10 md:pb-14 grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <TwoToneHeading as="h1" size="display" muted="Pullwright" strong="Plans and pricing" />
          <div className="md:text-right md:pb-2">
            <p className="text-[15px] text-muted-foreground">Free to run with your own keys.</p>
            <Link to="/wallet" className="mt-1.5 inline-block font-mono text-[12px] uppercase tracking-[0.06em] text-primary underline underline-offset-4">
              Add a free Gemini key in a minute →
            </Link>
          </div>
        </section>

        {/* Plans */}
        <section className="px-gutter md:px-12 pb-16 md:pb-24">
          <MonoLabel>Three ways to use it</MonoLabel>
          <motion.div variants={stagger(0.07)} initial="hidden" animate="show" className="mt-4 grid gap-4 lg:grid-cols-3">
            {WAYS.map((w) => (
              <PlanColumn key={w.id} way={w} onCta={onCta} busy={w.id === 'pro' && checkout.busy} />
            ))}
          </motion.div>
          {checkout.error && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {checkout.error}
            </p>
          )}
        </section>

        {/* Compare */}
        <Section id="compare">
          <TwoToneHeading muted="Compare" strong="side by side" />
          <div className="mt-10 -mx-gutter md:mx-0 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="sticky left-0 z-[1] bg-background py-4 pl-gutter md:pl-0 pr-4 w-[34%]" />
                  {WAYS.map((w) => (
                    <th key={w.id} scope="col" className="py-4 pr-4 align-bottom">
                      <span className="block text-[17px] font-normal text-foreground">{w.name}</span>
                      <span className="block text-sm font-normal text-muted-foreground">{w.id === 'keys' ? 'Your rates' : `${w.price} / month`}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <Fragment key={r.label}>
                    {r.group && (
                      <tr>
                        <td className="sticky left-0 z-[1] bg-background pt-8 pb-2 pl-gutter md:pl-0">
                          <MonoLabel>{r.group}</MonoLabel>
                        </td>
                        <td colSpan={3} />
                      </tr>
                    )}
                    <tr className="border-b border-hairline">
                      <th scope="row" className="sticky left-0 z-[1] bg-background py-3.5 pl-gutter md:pl-0 pr-4 text-[15px] font-normal text-foreground">
                        {r.label}
                      </th>
                      {r.values.map((v, i) => (
                        <td key={i} className="py-3.5 pr-4 text-[15px] text-muted-foreground">
                          <Cell v={v} />
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Providers */}
        <Section inner="py-14 md:py-16">
          <div className="grid gap-8 md:grid-cols-2 md:items-center">
            <ul className="flex flex-wrap gap-x-7 gap-y-2 text-lg text-foreground/45 order-2 md:order-1">
              {['Google Gemini', 'Groq', 'Vercel AI Gateway', 'OpenRouter', 'OpenAI'].map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <TwoToneHeading muted="Works with every" strong="major model provider" className="order-1 md:order-2 md:text-right" />
          </div>
        </Section>

        {/* FAQ */}
        <Section id="faq">
          <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div>
              <TwoToneHeading muted="Questions," strong="answered" />
              <ArrowLink to="/#how" className="mt-5">
                How it works
              </ArrowLink>
            </div>
            <ul className="border-t border-hairline">
              {FAQ.map(([q, a]) => (
                <FaqItem key={q} q={q} a={a} />
              ))}
            </ul>
          </div>
        </Section>

        <SiteFooter />
      </Frame>
    </div>
  )
}
