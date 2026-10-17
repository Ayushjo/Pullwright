import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { MotionConfig } from 'framer-motion'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Respect the OS "reduce motion" setting (also what the prerender snapshot uses). */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
