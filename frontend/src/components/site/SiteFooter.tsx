import { Link } from 'react-router-dom'
import Logo from '../svgs/Logo'
import { HandUnderline } from '../hand/Scribbles'
import { DEMO_REPLAY_URL, REPO_URL } from '../../content/site'
import { MonoLabel } from './Typography'

const COLUMNS: { title: string; links: { label: string; to: string; external?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', to: '/#how' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Live replay', to: DEMO_REPLAY_URL },
    ],
  },
  {
    title: 'Your account',
    links: [
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'Model keys', to: '/wallet' },
      { label: 'Settings', to: '/settings' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'GitHub', to: REPO_URL, external: true },
      { label: 'Changelog', to: `${REPO_URL}/commits/main`, external: true },
      { label: 'Privacy', to: '/privacy' },
    ],
  },
]

/** Sparse marketing footer: logo, three link columns, a mono sign-off. */
export default function SiteFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="px-gutter md:px-12 pt-14 pb-10 grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo height={30} linked={false} animated={false} className="opacity-80" />
          <p className="mt-4 text-sm text-muted-foreground max-w-xs">
            <span className="relative inline-block text-foreground">
              Free to run
              <HandUnderline className="text-primary/70" strokeWidth={3} />
            </span>{' '}
            with your own model keys.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <p className="text-sm text-foreground">{c.title}</p>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a href={l.to} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {l.label}
                    </a>
                  ) : (
                    <Link to={l.to} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="px-gutter md:px-12 pb-10 flex flex-wrap items-center justify-between gap-3">
        <MonoLabel>© 2026 Pullwright · MIT licensed</MonoLabel>
        <MonoLabel>Issue in · reviewed PR out</MonoLabel>
      </div>
    </footer>
  )
}
