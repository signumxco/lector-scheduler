export function MinistryMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'mark compact' : 'mark'} aria-hidden="true">
      <span className="mark-cross" />
    </div>
  );
}
