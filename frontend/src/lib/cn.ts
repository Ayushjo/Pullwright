import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge our custom font sizes (tailwind.config.js), so `text-title` isn't mistaken for a
// colour and dropped next to `text-foreground`, and `text-[40px]` correctly overrides it.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['display', 'title', 'lead'] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
