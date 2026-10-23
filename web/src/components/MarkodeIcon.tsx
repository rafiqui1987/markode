/**
 * markode's mark (`>|<`: two sides meeting at the text), as an icon. `filled` is the logo itself (blue
 * square, dark mark); the outline version follows the text color, like the lucide icons around it.
 */
export function MarkodeIcon({ size = 16, filled = false, className }: { size?: number; filled?: boolean; className?: string }) {
  if (filled)
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#6cb6ff" />
        <path d="M7 10l5 6-5 6M16 9v14M25 10l-5 6 5 6" stroke="#14161b" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <path d="M5.8 8.8l2.7 3.2-2.7 3.2M12 7.6v8.8M18.2 8.8l-2.7 3.2 2.7 3.2" />
    </svg>
  )
}
