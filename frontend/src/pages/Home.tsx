import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createTask } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/ui'
import SiteNav from '../components/site/SiteNav'
import SiteFooter from '../components/site/SiteFooter'
import { Frame } from '../components/site/Layout'
import { HomeHero, HowItWorks, Measured } from '../components/site/home/Story'
import { BuiltOn, ClosingCta, Keys, Safety } from '../components/site/home/Sections'
import { SITE_URL, softwareJsonLd, useSeo } from '../lib/seo'

export default function Home() {
  useSeo({
    title: 'Pullwright — GitHub issue in, reviewed pull request out',
    description: 'Hand Pullwright a GitHub issue. It plans the change, edits and runs your tests in a sandbox, gets an independent review, and opens the pull request when you approve. Free to start — no key, no card.',
    path: '/',
    jsonLd: [
      softwareJsonLd,
      { '@type': 'Organization', name: 'Pullwright', url: SITE_URL, logo: `${SITE_URL}/pullwright.png` },
      { '@type': 'WebSite', name: 'Pullwright', url: SITE_URL },
    ],
  })
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { hash } = useLocation()
  const { user, login } = useAuth()
  const { push: pushToast } = useToast()

  // Product-menu links like /#plan: scroll once the section exists (the router doesn't do it).
  useEffect(() => {
    if (!hash) return
    const t = window.setTimeout(() => {
      // Step anchors (#plan, #code…) live in the desktop columns; on phones those are hidden, so fall back to the section.
      const el = document.getElementById(hash.slice(1))
      ;(el && el.offsetParent !== null ? el : document.getElementById('how'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
    return () => window.clearTimeout(t)
  }, [hash])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    if (!user) {
      // Keep what they typed across the GitHub sign-in round trip.
      login(`/tasks/new?url=${encodeURIComponent(trimmed)}`)
      return
    }
    setLoading(true)
    try {
      const { taskId } = await createTask(trimmed)
      navigate(`/tasks/${taskId}`)
    } catch (err) {
      pushToast((err as Error).message, 'error')
      setLoading(false)
    }
  }

  const start = () => (user ? navigate('/tasks/new') : login('/wallet'))

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <Frame>
        <HomeHero url={url} onUrl={setUrl} onSubmit={handleSubmit} loading={loading} signedIn={Boolean(user)} />
        <BuiltOn />
      </Frame>
      <div className="band-dark">
        <Frame>
          <Measured />
        </Frame>
      </div>
      <Frame>
        <HowItWorks />
        <Keys />
        <Safety />
      </Frame>
      <div className="band-dark">
        <Frame>
          <ClosingCta onStart={start} />
          <SiteFooter />
        </Frame>
      </div>
    </div>
  )
}
