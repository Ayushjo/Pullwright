import type { ChangelogEntry } from '../components/site/Blocks'

/**
 * "Recently shipped" on Home. Real milestones from the git history (dates are commit dates, MM.DD, 2026).
 * Add a line when something user-visible ships; newest first.
 */
export const CHANGELOG: ChangelogEntry[] = [
  { date: '10.04', title: 'Pro plan with checkout and a billing portal', tag: 'Plans', href: '/pricing' },
  { date: '10.04', title: 'Private repos ask before using keys that train', tag: 'Privacy' },
  { date: '10.04', title: 'Model keys: bring free Gemini, Groq, Vercel and OpenRouter keys', tag: 'Keys', href: '/wallet' },
  { date: '10.03', title: 'Tasks pause on free quota and pick up where they stopped', tag: 'Reliability' },
  { date: '10.03', title: 'A totally free mode — no credit card, no credit', tag: 'Free' },
  { date: '09.29', title: 'Reads screenshots in issues and asks when an issue is vague', tag: 'Intake' },
]
