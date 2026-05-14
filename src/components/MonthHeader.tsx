import { CalendarDays } from 'lucide-react';
import { monthLabel } from '../lib/date';

export function MonthHeader({ activeMonth }: { activeMonth: string }) {
  return (
    <div className="month-header">
      <CalendarDays size={20} aria-hidden="true" />
      <span>{monthLabel(activeMonth)}</span>
    </div>
  );
}
