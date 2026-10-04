import { cn } from '../../lib/cn'

export default function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-pulse rounded-md bg-black/[.05]', className)} />
}
