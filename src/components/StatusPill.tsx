import type { MassStatus } from '../lib/types';

const labels: Record<MassStatus, string> = {
  draft: 'Draft',
  needs_attention: 'Needs attention',
  approved: 'Approved',
  cancelled: 'Cancelled',
  published: 'Published',
};

export function StatusPill({ status }: { status: MassStatus }) {
  return <span className={`status-pill ${status}`}>{labels[status]}</span>;
}
