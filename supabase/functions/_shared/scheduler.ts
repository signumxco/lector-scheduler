export interface DbVolunteer {
  id: string;
  name: string;
  email: string;
  active: boolean;
  ministry_ids?: string[];
}

export interface DbMassInstance {
  id: string;
  parish_id: string;
  ministry_id: string;
  service_date: string;
  service_time: string;
  label: string;
  ministers_needed: number;
}

export interface DbAvailabilityResponse {
  volunteer_id: string;
  mass_instance_id: string;
  available: boolean;
}

export function scheduleMasses(
  masses: DbMassInstance[],
  volunteers: DbVolunteer[],
  responses: DbAvailabilityResponse[],
) {
  const activeVolunteers = new Map(volunteers.filter((volunteer) => volunteer.active).map((volunteer) => [volunteer.id, volunteer]));
  const availabilityByMass = new Map<string, Set<string>>();

  for (const response of responses) {
    if (!response.available || !activeVolunteers.has(response.volunteer_id)) continue;
    const available = availabilityByMass.get(response.mass_instance_id) || new Set<string>();
    available.add(response.volunteer_id);
    availabilityByMass.set(response.mass_instance_id, available);
  }

  const counts: Record<string, number> = {};
  const assignedDates: Record<string, Set<string>> = {};

  return masses.map((mass) => {
    const eligible = Array.from(availabilityByMass.get(mass.id) || [])
      .filter((volunteerId) => {
        const ministryIds = activeVolunteers.get(volunteerId)?.ministry_ids;
        return !ministryIds || ministryIds.includes(mass.ministry_id);
      })
      .filter((volunteerId) => !assignedDates[volunteerId]?.has(mass.service_date))
      .sort((a, b) => (counts[a] || 0) - (counts[b] || 0) || (activeVolunteers.get(a)?.name || '').localeCompare(activeVolunteers.get(b)?.name || ''));

    const picked = eligible.slice(0, mass.ministers_needed);
    const assignments = picked.map((volunteerId, index) => {
      const volunteer = activeVolunteers.get(volunteerId)!;
      counts[volunteerId] = (counts[volunteerId] || 0) + 1;
      assignedDates[volunteerId] = assignedDates[volunteerId] || new Set<string>();
      assignedDates[volunteerId].add(mass.service_date);
      return {
        parish_id: mass.parish_id,
        ministry_id: mass.ministry_id,
        mass_instance_id: mass.id,
        volunteer_id: volunteerId,
        position_label: `Minister ${index + 1}`,
        status: 'draft',
      };
    });

    return {
      mass,
      assignments,
      openings: Math.max(0, mass.ministers_needed - assignments.length),
    };
  });
}

export function monthRange(month: string) {
  const start = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const endDate = new Date(year, monthNumber, 0);
  const end = `${year}-${String(monthNumber).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
  return { start, end };
}
