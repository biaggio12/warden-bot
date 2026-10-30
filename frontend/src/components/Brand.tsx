/**
 * The wordmark: the Echo raid sprite in an arcade screen tile, and the name in the pixel face.
 * The 64px sprite is drawn whole (2x on the login screen, so its pixels stay crisp); with
 * reduced motion the still first frame replaces the animation.
 */
export default function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const large = size === 'lg';
  return (
    <span className="flex items-center gap-3">
      <span
        className={`flex shrink-0 items-center justify-center border-3 border-outline bg-paper shadow-[3px_3px_0_var(--color-outline),inset_0_0_12px_var(--color-hp)] ${
          large ? 'p-1' : 'p-0.5'
        }`}
      >
        <picture className="shrink-0">
          <source srcSet="/logo.png" media="(prefers-reduced-motion: reduce)" />
          <img
            src="/logo.gif"
            alt=""
            width={64}
            height={64}
            className={`[image-rendering:pixelated] ${large ? 'h-32 w-32' : 'h-9 w-9 sm:h-11 sm:w-11'}`}
          />
        </picture>
      </span>
      <span className={`font-display leading-none font-bold text-ink ${large ? 'text-4xl sm:text-5xl' : 'text-lg whitespace-nowrap sm:text-xl'}`}>WARDEN TRACKER</span>
    </span>
  );
}
