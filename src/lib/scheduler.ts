import type {
  Assignment,
  AvailabilityResponse,
  MassInstance,
  MassTime,
  ScheduleRunResult,
  ScheduledMass,
  Volunteer,
} from './types';
import { daysInMonth, toDateKey } from './date';

export function expandMassTimesForMonth(massTimes: MassTime[], monthKey: string): MassInstance[] {
  const [year, month] = monthKey.split('-').map(Number);
  const instances: MassInstance[] = [];

  for (const massTime of massTimes) {
    if (!massTime.active) continue;

    if (massTime.specificDate) {
      if (!massTime.specificDate.startsWith(monthKey)) continue;
      instances.push(toMassInstance(massTime, massTime.specificDate));
      continue;
    }

    if (massTime.dayOfWeek === null) continue;

    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      const date = new Date(year, month - 1, day);
      if (date.getDay() === massTime.dayOfWeek) {
        instances.push(toMassInstance(massTime, toDateKey(date)));
      }
    }
  }

  return instances.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export function generateSchedule(
  massInstances: MassInstance[],
  volunteers: Volunteer[],
  availabilityResponses: AvailabilityResponse[],
): ScheduleRunResult {
  const activeVolunteers = new Map(volunteers.filter((volunteer) => volunteer.active).map((volunteer) => [volunteer.id, volunteer]));
  const availabilityByMass = new Map<string, Set<string>>();

  for (const response of availabilityResponses) {
    if (!response.available || !activeVolunteers.has(response.volunteerId)) continue;
    const available = availabilityByMass.get(response.massInstanceId) ?? new Set<string>();
    available.add(response.volunteerId);
    availabilityByMass.set(response.massInstanceId, available);
  }

  const assignmentCounts: Record<string, number> = {};
  const assignedDates: Record<string, Set<string>> = {};

  const masses: ScheduledMass[] = massInstances.map((mass) => {
    const availableVolunteerIds = Array.from(availabilityByMass.get(mass.id) ?? []);
    const eligible = availableVolunteerIds
      .filter((volunteerId) => activeVolunteers.get(volunteerId)?.ministryIds.includes(mass.ministryId))
      .filter((volunteerId) => !assignedDates[volunteerId]?.has(mass.date))
      .sort((a, b) => {
        const countDiff = (assignmentCounts[a] ?? 0) - (assignmentCounts[b] ?? 0);
        if (countDiff !== 0) return countDiff;
        const nameA = activeVolunteers.get(a)?.name ?? '';
        const nameB = activeVolunteers.get(b)?.name ?? '';
        return nameA.localeCompare(nameB);
      });

    const picked = eligible.slice(0, mass.slotsNeeded);
    const assignments: Assignment[] = picked.map((volunteerId, index) => {
      const volunteer = activeVolunteers.get(volunteerId);
      if (!volunteer) throw new Error(`Volunteer ${volunteerId} disappeared during scheduling.`);

      assignmentCounts[volunteerId] = (assignmentCounts[volunteerId] ?? 0) + 1;
      assignedDates[volunteerId] = assignedDates[volunteerId] ?? new Set<string>();
      assignedDates[volunteerId].add(mass.date);

      return {
        id: `${mass.id}-${volunteerId}`,
        parishId: mass.parishId,
        massInstanceId: mass.id,
        ministryId: mass.ministryId,
        volunteerId,
        volunteerName: volunteer.name,
        volunteerEmail: volunteer.email,
        positionLabel: `${mass.roleSingular} ${index + 1}`,
        status: 'draft',
      };
    });

    const openings = Math.max(0, mass.slotsNeeded - assignments.length);
    return {
      ...mass,
      status: openings > 0 ? 'needs_attention' : 'draft',
      assignments,
      openings,
    };
  });

  return {
    masses,
    needsAttentionCount: masses.filter((mass) => mass.openings > 0).length,
    assignmentCounts,
  };
}

function toMassInstance(massTime: MassTime, date: string): MassInstance {
  return {
    id: `${massTime.id}:${date}:${massTime.time}`,
    parishId: massTime.parishId,
    massTimeId: massTime.id,
    date,
    time: massTime.time,
    label: massTime.label,
    ministryId: massTime.ministryId,
    ministryName: massTime.ministryName,
    ministryShortName: massTime.ministryShortName,
    roleSingular: massTime.roleSingular,
    rolePlural: massTime.rolePlural,
    slotsNeeded: massTime.slotsNeeded,
    status: 'draft',
    notes: massTime.notes,
  };
}
