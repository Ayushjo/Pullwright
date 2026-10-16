/**
 * The three ways to use Pullwright, for Pricing. Numbers mirror the backend:
 * daily and concurrent limits — backend/src/entitlements/admission.ts (limitsFor);
 * queue class — backend/src/api/router.ts (Pro, or any paid key of your own, gets the priority pool);
 * Pro price and included usage — the Pro plan row / Dodo product ($8/month, $3 included);
 * credit pack and trial — backend/src/billing/index.ts (PACK) and billing/trial.ts (TRIAL).
 */
export type WayId = 'free' | 'keys' | 'pro'

export type Way = {
  id: WayId
  name: string
  who: string
  price: string
  /** Mono suffix after the price. */
  per: string
  tag?: string
  blurb: string
  /** Heading above the feature list, e.g. "EVERYTHING IN FREE KEYS, PLUS:". */
  includes: string
  features: string[]
  cta: { label: string; to: string }
}

export const WAYS: Way[] = [
  {
    id: 'free',
    name: 'Free keys',
    who: 'Most people start here',
    price: '$0',
    per: 'forever',
    blurb: 'Start right away with 10 free tasks a month on Claude — no key, no card. Add a free Google Gemini key for unlimited free tasks.',
    includes: 'What you get',
    features: [
      '10 tasks a month on Claude, no key needed',
      'Unlimited with a free Gemini key (3 a day, one at a time)',
      'Plan approval, sandboxed run, tests and an independent review on every task',
      'Pauses on free quota and picks up at the reset — nothing lost',
      'Private repos only go to models that don’t train on your code',
    ],
    cta: { label: 'Add a free key', to: '/wallet' },
  },
  {
    id: 'keys',
    name: 'Your paid keys',
    who: 'You already pay OpenAI or OpenRouter',
    price: 'Your rates',
    per: 'billed by your provider',
    blurb: 'Add your own paid key next to the free ones. Free keys always go first; your key covers only what they can’t.',
    includes: 'Everything in free keys, plus:',
    features: ['Priority queue — never waits behind free tasks', 'A typical task costs a few cents on your bill', 'Checked on save, stored encrypted, never shown again'],
    cta: { label: 'Add a key', to: '/wallet' },
  },
  {
    id: 'pro',
    name: 'Pro',
    who: 'No keys to manage',
    price: '$8',
    per: 'per month',
    tag: 'Popular',
    blurb: 'Runs on our models with $3 of usage included every month. Your free keys still go first, so it lasts longer.',
    includes: 'Everything in your paid keys, plus:',
    features: ['25 tasks a day, three at once', '$3 of Claude Sonnet usage each month (≈15 tasks)', 'No keys needed at all', 'Top up with a $5 credit pack if a month runs over'],
    cta: { label: 'Go Pro', to: '/settings' },
  },
]

/** "Compare plans" rows. A string is shown as-is; true / false render as a tick / a dash. */
export const COMPARE: { group?: string; label: string; values: [string | boolean, string | boolean, string | boolean] }[] = [
  { label: 'Price', values: ['$0', 'Your provider’s rates', '$8 / month'] },
  { label: 'Card needed', values: ['No', 'At your provider', 'Yes'] },
  { group: 'Limits', label: 'Tasks per day', values: ['3', '3', '25'] },
  { label: 'Running at once', values: ['1', '1', '3'] },
  { label: 'Queue', values: ['Shared', 'Priority', 'Priority'] },
  { label: 'Free Claude tasks', values: ['10 a month', '10 a month', '10 a month'] },
  { label: 'Model usage', values: ['Your free keys', 'Your key, after the free ones', '$3 of Claude Sonnet each month'] },
  { label: 'Credit packs ($5 → $4.25, 12 months)', values: [true, true, true] },
  { group: 'Every task', label: 'Plan you approve or edit', values: [true, true, true] },
  { label: 'Sandboxed run with your tests', values: [true, true, true] },
  { label: 'Independent review', values: [true, true, true] },
  { label: 'Pauses and resumes on quota', values: [true, true, true] },
  { label: 'Reads screenshots in issues', values: [true, true, true] },
  { label: 'Private repos kept off training models', values: [true, true, true] },
  { label: 'PR opens only on your click', values: [true, true, true] },
]

export const FAQ: [string, string][] = [
  [
    'Is the free way really free?',
    'Yes. Google, Groq, Vercel and OpenRouter all offer free API keys without a card. Pullwright only uses the free tiers of those keys, and never charges you on the free plan.',
  ],
  [
    'What happens when a free quota runs out mid-task?',
    'The task pauses and shows when it will continue — usually at the provider’s daily reset. It resumes on its own from where it stopped, or you can add another key to continue now.',
  ],
  [
    'Is my code safe?',
    'Each task runs in a throwaway sandbox with no network access after dependencies install and no credentials inside. Your GitHub token only lives in the worker that opens the PR, and no PR is opened without your click.',
  ],
  [
    'Can I try it before adding a key?',
    'Yes. Every GitHub account older than 30 days gets 10 free tasks a month on Claude, with no key and no card. They renew on the 1st. A free Gemini key makes the free plan unlimited.',
  ],
  [
    'Can I pay as I go instead of subscribing?',
    'Yes. A $5 credit pack adds $4.25 of usage on our models (the rest covers payment fees), valid for 12 months, with no subscription. Every task has a hard cap, so a pack can’t be spent by one runaway task.',
  ],
  ['Can I cancel Pro?', 'Yes — manage or cancel any time from Settings. Payments are handled by Dodo Payments.'],
]
