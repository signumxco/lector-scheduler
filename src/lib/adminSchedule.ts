import type { Assignment, CalendarService, MassStatus, Ministry, ScheduledMass, Volunteer } from './types';

export type MinistryFilter = 'all' | string;

export interface ScheduleStats {
  masses: number;
  needsAttention: number;
  approved: number;
  volunteers: number;
}

export interface SpecialDay {
  date: string;
  title: string;
  obligatory: boolean;
  note?: string;
}

export interface CalendarDayGroup {
  date: string;
  services: CalendarService[];
  specialDay?: SpecialDay;
}

export const specialDays2026: SpecialDay[] = [
  {
    date: '2026-05-14',
    title: 'Ascension of the Lord',
    obligatory: true,
  },
  {
    date: '2026-08-15',
    title: 'Assumption of the Blessed Virgin Mary',
    obligatory: false,
    note: 'Not obligatory in 2026 because it falls on a Saturday.',
  },
  {
    date: '2026-11-01',
    title: 'All Saints',
    obligatory: true,
  },
  {
    date: '2026-12-08',
    title: 'Immaculate Conception of the Blessed Virgin Mary',
    obligatory: true,
  },
  {
    date: '2026-12-25',
    title: 'Nativity of the Lord',
    obligatory: true,
  },
];

export function filterSchedule(schedule: ScheduledMass[], activeMinistryId: MinistryFilter): ScheduledMass[] {
  return activeMinistryId === 'all' ? [...schedule] : schedule.filter((mass) => mass.ministryId === activeMinistryId);
}

export function filterVolunteers(volunteers: Volunteer[], activeMinistryId: MinistryFilter): Volunteer[] {
  return activeMinistryId === 'all' ? volunteers : volunteers.filter((volunteer) => volunteer.ministryIds.includes(activeMinistryId));
}

export function calculateStats(schedule: ScheduledMass[], volunteers: Volunteer[], activeMinistryId: MinistryFilter): ScheduleStats {
  const visibleSchedule = filterSchedule(schedule, activeMinistryId);
  const visibleVolunteers = filterVolunteers(volunteers, activeMinistryId);

  return {
    masses: visibleSchedule.length,
    needsAttention: visibleSchedule.filter((mass) => mass.status !== 'approved' && mass.status !== 'published').length,
    approved: visibleSchedule.filter((mass) => mass.status === 'approved' || mass.status === 'published').length,
    volunteers: visibleVolunteers.filter((volunteer) => volunteer.active).length,
  };
}

export function groupCalendarServices(schedule: ScheduledMass[]): CalendarService[] {
  const groups = new Map<string, CalendarService>();
  for (const mass of schedule) {
    const key = `${mass.date}-${mass.time}-${mass.label}`;
    const existing = groups.get(key) ?? {
      id: key,
      date: mass.date,
      time: mass.time,
      label: mass.label,
      ministries: [],
    };
    existing.ministries.push(mass);
    groups.set(key, existing);
  }

  return Array.from(groups.values()).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export function groupCalendarDays(schedule: ScheduledMass[]): CalendarDayGroup[] {
  const days = new Map<string, CalendarService[]>();
  for (const service of groupCalendarServices(schedule)) {
    days.set(service.date, [...(days.get(service.date) ?? []), service]);
  }

  return Array.from(days.entries())
    .map(([date, services]) => ({
      date,
      services,
      specialDay: getSpecialDay(date),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getSpecialDay(date: string): SpecialDay | undefined {
  return specialDays2026.find((day) => day.date === date);
}

export function ministryColor(ministries: Ministry[], ministryId: string): string {
  return ministries.find((ministry) => ministry.id === ministryId)?.accentColor ?? '#6c7280';
}

export function formatCalendarTime(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date(2026, 0, 1, hour, minute);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function canAddVolunteerToMass(mass: ScheduledMass, volunteer: Volunteer | undefined): boolean {
  if (!volunteer || !volunteer.active) return false;
  if (!volunteer.ministryIds.includes(mass.ministryId)) return false;
  if (mass.status === 'cancelled') return false;
  if (mass.assignments.length >= mass.slotsNeeded) return false;
  return !mass.assignments.some((assignment) => assignment.volunteerId === volunteer.id);
}

export function addVolunteerToScheduledMass(mass: ScheduledMass, volunteer: Volunteer, idSeed = Date.now()): ScheduledMass {
  if (!canAddVolunteerToMass(mass, volunteer)) return mass;

  const assignment: Assignment = {
    id: `${mass.id}-${volunteer.id}-${idSeed}`,
    parishId: mass.parishId,
    massInstanceId: mass.id,
    ministryId: mass.ministryId,
    volunteerId: volunteer.id,
    volunteerName: volunteer.name,
    volunteerEmail: volunteer.email,
    positionLabel: `${mass.roleSingular} ${mass.assignments.length + 1}`,
    status: 'draft',
  };

  return normalizeMassAssignments({
    ...mass,
    assignments: [...mass.assignments, assignment],
  });
}

export function removeAssignmentFromScheduledMass(mass: ScheduledMass, assignmentId: string): ScheduledMass {
  return normalizeMassAssignments({
    ...mass,
    assignments: mass.assignments.filter((assignment) => assignment.id !== assignmentId),
  });
}

export function setScheduledMassStatus(mass: ScheduledMass, status: MassStatus): ScheduledMass {
  if (status === 'cancelled') {
    return { ...mass, status, openings: 0 };
  }
  return normalizeMassAssignments({ ...mass, status });
}

function normalizeMassAssignments(mass: ScheduledMass): ScheduledMass {
  const assignments = mass.assignments.map((assignment, index) => ({
    ...assignment,
    positionLabel: `${mass.roleSingular} ${index + 1}`,
  }));
  const openings = Math.max(0, mass.slotsNeeded - assignments.length);
  const status =
    mass.status === 'cancelled'
      ? 'cancelled'
      : openings > 0
        ? 'needs_attention'
        : mass.status === 'approved' || mass.status === 'published'
          ? mass.status
          : 'draft';

  return { ...mass, assignments, openings, status };
}
