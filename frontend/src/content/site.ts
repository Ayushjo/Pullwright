/** Links shared by the marketing nav, footer and Home. */
export const DEMO_REPLAY_ID = (import.meta.env.VITE_DEMO_REPLAY_ID as string | undefined) ?? '8e9c51d8-f35c-4623-b365-5c745a7ae01d'
export const DEMO_REPLAY_URL = `/r/${DEMO_REPLAY_ID}`
export const DEMO_PR_URL = 'https://github.com/Ayushjo/devin-test-app/pull/4'
export const REPO_URL = 'https://github.com/Ayushjo/MyOwnDevin'

/** The Product menu: grouped like devin.ai's (Surfaces / Features / Platform / Models), with our own content. */
export const PRODUCT_MENU: { group: string; items: { label: string; to: string; external?: boolean }[] }[] = [
  {
    group: 'How it works',
    items: [
      { label: 'Plan', to: '/#plan' },
      { label: 'Code and test', to: '/#code' },
      { label: 'Review', to: '/#review' },
      { label: 'Ship the PR', to: '/#ship' },
    ],
  },
  {
    group: 'Your keys',
    items: [
      { label: 'Model keys', to: '/wallet' },
      { label: 'Free keys, compared', to: '/#keys' },
      { label: 'Pricing', to: '/pricing' },
    ],
  },
  {
    group: 'Platform',
    items: [
      { label: 'Pauses on free quota', to: '/#how' },
      { label: 'Private repos', to: '/#safety' },
      { label: 'Screenshots in issues', to: '/#how' },
    ],
  },
  {
    group: 'Resources',
    items: [
      { label: 'Live replay', to: DEMO_REPLAY_URL },
      { label: 'Changelog', to: `${REPO_URL}/commits/main`, external: true },
      { label: 'GitHub', to: REPO_URL, external: true },
    ],
  },
]
