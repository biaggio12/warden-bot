import { useState } from 'react';

/**
 * Creature GIF from TibiaWiki. Tibia sprites are pixel art, so they are scaled without
 * smoothing. Loaded lazily (833 of them in the bestiary); if one fails to load, an empty
 * slot of the same size keeps the row aligned.
 */
export default function MonsterImage({ src, className = 'h-10 w-10' }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <span className={`${className} shrink-0`} aria-hidden="true" />;

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} shrink-0 object-contain [image-rendering:pixelated]`}
    />
  );
}
