import type { TaskStatus } from '../types/task'

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

export const STATUS_META: Record<TaskStatus, { label: string; tone: Tone; active: boolean; needsYou?: boolean }> = {
  queued: { label: 'Queued', tone: 'neutral', active: true },
  preparing: { label: 'Preparing', tone: 'warning', active: true },
  planning: { label: 'Planning', tone: 'warning', active: true },
  awaiting_approval: { label: 'Review plan', tone: 'primary', active: false, needsYou: true },
  running: { label: 'Working', tone: 'warning', active: true },
  verifying: { label: 'Validating', tone: 'warning', active: true },
  validating: { label: 'Validating', tone: 'warning', active: true },
  needs_input: { label: 'Needs your input', tone: 'primary', active: false, needsYou: true },
  ready: { label: 'Ready to publish', tone: 'success', active: false, needsYou: true },
  needs_review: { label: 'Needs review', tone: 'warning', active: false, needsYou: true },
  // Waiting for model quota: not "active" (no work is running), and nothing is needed from the user.
  parked: { label: 'Paused', tone: 'neutral', active: false },
  publishing: { label: 'Opening PR', tone: 'warning', active: true },
  published: { label: 'PR opened', tone: 'success', active: false },
  done: { label: 'Done', tone: 'success', active: false },
  failed: { label: 'Failed', tone: 'danger', active: false },
  cancelled: { label: 'Cancelled', tone: 'neutral', active: false },
}

export const statusMeta = (s: string) => STATUS_META[s as TaskStatus] ?? { label: s, tone: 'neutral' as Tone, active: false }
