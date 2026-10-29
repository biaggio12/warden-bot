export default function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className={size === 'lg' ? 'h-11 w-11' : 'h-8 w-8'} />
      <span className={`font-display font-bold tracking-wide ${size === 'lg' ? 'text-2xl' : 'text-lg'}`}>Warden Tracker</span>
    </div>
  );
}
