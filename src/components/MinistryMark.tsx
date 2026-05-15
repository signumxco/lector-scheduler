const logoSrc = '/ministry-logo.png';

export function MinistryMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'mark compact' : 'mark'} aria-hidden="true">
      <img className="mark-image" src={logoSrc} alt="" />
    </div>
  );
}
