/** HO lockup recreated in SVG: bold green H against a light-grey O, small "arena" caps. */
export default function Logo({ size = 34, sub = true }: { size?: number; sub?: boolean }) {
  return (
    <span className="logo" aria-label="HeadlineOdds Arena">
      <svg width={size * 1.45} height={size} viewBox="0 0 58 40" aria-hidden="true">
        <circle cx="38" cy="20" r="17.5" fill="#D9D9D9" />
        <ellipse cx="38" cy="20" rx="6" ry="9.5" fill="#080A09" />
        <path d="M2 4h11v12h8V4h11v32H21V24h-8v12H2z" fill="#00B140" stroke="#080A09" strokeWidth="1.6" />
      </svg>
      {sub && (
        <span className="logo-text">
          <span className="logo-word">headlineodds</span>
          <span className="logo-arena">ARENA</span>
        </span>
      )}
    </span>
  );
}
