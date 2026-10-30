/**
 * A game bar in square segments: HP drains for time left, XP fills for progress.
 * Static by design (no animated width); the value is also given as text beside it.
 */
export default function SegmentBar({
  value,
  kind,
  segments = 10,
  className = '',
}: {
  value: number;
  kind: 'hp' | 'xp' | 'gold';
  segments?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const lit = clamped === 0 ? 0 : Math.max(1, Math.round(clamped * segments));
  const fill = kind === 'hp' ? 'bg-hp' : kind === 'xp' ? 'bg-xp' : 'bg-accent';

  return (
    <div className={`flex gap-0.5 border-2 border-outline bg-outline p-0.5 ${className}`} aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={`h-2.5 flex-1 ${i < lit ? fill : 'bg-paper-3'}`} />
      ))}
    </div>
  );
}
