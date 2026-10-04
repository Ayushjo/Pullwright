import { forwardRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'solid' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  /** "pill" for marketing and page-level calls to action; the default stays compact for in-card actions. */
  shape?: 'default' | 'pill'
  children?: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:brightness-95 border border-transparent',
  solid: 'bg-foreground text-white hover:opacity-85 border border-transparent',
  secondary: 'bg-card text-foreground border border-border hover:bg-muted',
  outline: 'bg-transparent text-foreground border border-black/15 hover:bg-black/[.04]',
  ghost: 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent',
  danger: 'bg-destructive text-destructive-foreground hover:brightness-95 border border-transparent',
}

const SIZES: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5 gap-1.5',
  md: 'text-sm px-[15px] py-[7px] gap-2',
  lg: 'text-[15px] px-5 py-2.5 gap-2',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', shape = 'default', loading, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-all duration-micro select-none focus-ring',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        shape === 'pill' ? 'rounded-pill' : 'rounded-button',
        className,
      )}
      {...props}
    >
      {loading && (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  )
})

export default Button
