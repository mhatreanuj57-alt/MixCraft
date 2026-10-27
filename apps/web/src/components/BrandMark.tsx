export default function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `mc-brand-mark ${className}` : "mc-brand-mark"}
      viewBox="0 0 40 40"
      width="36"
      height="36"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse
        cx="20"
        cy="20"
        rx="16"
        ry="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        transform="rotate(-28 20 20)"
      />
      <ellipse
        cx="20"
        cy="20"
        rx="16"
        ry="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        transform="rotate(34 20 20)"
      />
      <circle cx="20" cy="20" r="3.4" fill="currentColor" />
      <circle cx="31" cy="13" r="2.4" fill="var(--mc-lime)" stroke="currentColor" strokeWidth="1" />
      <circle
        cx="9"
        cy="27"
        r="1.9"
        fill="var(--mc-orange)"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}
