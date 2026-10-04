import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode
  trailing?: ReactNode
  invalid?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, trailing, invalid, className, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        'relative flex items-center rounded-md border bg-card transition-[border-color,box-shadow] duration-micro',
        invalid
          ? 'border-danger focus-within:ring-4 focus-within:ring-danger/15'
          : 'border-black/15 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10',
      )}
    >
      {icon && <span className="absolute left-3 text-muted-foreground pointer-events-none flex">{icon}</span>}
      <input
        ref={ref}
        className={cn(
          'w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none rounded-md py-2.5',
          icon ? 'pl-9' : 'pl-3',
          trailing ? 'pr-9' : 'pr-3',
          className,
        )}
        {...props}
      />
      {trailing && <span className="absolute right-3 flex">{trailing}</span>}
    </div>
  )
})

export default Input
