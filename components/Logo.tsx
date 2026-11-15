/** Dare15 wordmark: a 15-minute clock face with an up tick, plus the name. */
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="logo" aria-label="Dare15">
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="#00E38F" strokeWidth="3" />
        <path d="M20 20V5a15 15 0 0 1 15 15z" fill="#00E38F" opacity=".35" />
        <path d="M13 24l7-8 7 8" fill="none" stroke="#EEF2EF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="logo-word">Dare15</span>
    </span>
  );
}
