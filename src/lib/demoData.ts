import type {
  AdminDashboardData,
  AvailabilityPayload,
  EmailEvent,
  MassTime,
  Ministry,
  ParishSettings,
  Volunteer,
} from './types';
import { expandMassTimesForMonth, generateSchedule } from './scheduler';
import { monthLabel, nextMonthKey } from './date';

export const demoParish: ParishSettings = {
  id: 'demo-parish',
  name: 'Example Parish',
  timezone: 'America/Los_Angeles',
  fromName: 'Example Parish Ministry Schedule',
  replyToEmail: 'coordinator@example-parish.org',
  coordinatorEmail: 'coordinator@example-parish.org',
};

export const demoMinistries: Ministry[] = [
  {
    id: 'lector',
    parishId: demoParish.id,
    key: 'lector',
    name: 'Lectors',
    shortName: 'Lectors',
    roleSingular: 'Lector',
    rolePlural: 'Lectors',
    accentColor: '#0543b0',
    active: true,
    sortOrder: 1,
  },
  {
    id: 'emhc',
    parishId: demoParish.id,
    key: 'emhc',
    name: 'Eucharistic Ministers',
    shortName: 'EMHC',
    roleSingular: 'Minister',
    rolePlural: 'Ministers',
    accentColor: '#ff7033',
    active: true,
    sortOrder: 2,
  },
];

export const demoVolunteers: Volunteer[] = [
  {
    id: 'v-maria',
    parishId: demoParish.id,
    name: 'Maria Santos',
    email: 'maria@example.com',
    active: true,
    ministryIds: ['emhc'],
    notes: 'Prefers 9 AM.',
  },
  {
    id: 'v-daniel',
    parishId: demoParish.id,
    name: 'Daniel Kim',
    email: 'daniel@example.com',
    active: true,
    ministryIds: ['lector', 'emhc'],
  },
  {
    id: 'v-grace',
    parishId: demoParish.id,
    name: 'Grace Murphy',
    email: 'grace@example.com',
    active: true,
    ministryIds: ['lector'],
  },
  {
    id: 'v-robert',
    parishId: demoParish.id,
    name: 'Robert Ellis',
    email: 'robert@example.com',
    active: true,
    ministryIds: ['emhc'],
    notes: 'Away first weekend.',
  },
  {
    id: 'v-elena',
    parishId: demoParish.id,
    name: 'Elena Price',
    email: 'elena@example.com',
    active: true,
    ministryIds: ['lector', 'emhc'],
  },
  {
    id: 'v-joan',
    parishId: demoParish.id,
    name: 'Joan Weaver',
    email: 'joan@example.com',
    active: false,
    ministryIds: ['lector', 'emhc'],
    notes: 'Paused for summer.',
  },
];

export const demoMassTimes: MassTime[] = buildMassTimes();

export function makeDemoDashboard(): AdminDashboardData {
  const activeMonth = nextMonthKey();
  const massInstances = expandMassTimesForMonth(demoMassTimes, activeMonth).map((mass) => {
    const ministry = demoMinistries.find((item) => item.id === mass.ministryId);
    return {
      ...mass,
      ministryName: ministry?.name ?? mass.ministryName,
      ministryShortName: ministry?.shortName ?? mass.ministryShortName,
      roleSingular: ministry?.roleSingular ?? mass.roleSingular,
      rolePlural: ministry?.rolePlural ?? mass.rolePlural,
    };
  });

  const availability = massInstances.flatMap((mass, massIndex) =>
    demoVolunteers
      .filter((volunteer) => volunteer.active && volunteer.ministryIds.includes(mass.ministryId))
      .filter((_, volunteerIndex) => (massIndex + volunteerIndex) % (mass.ministryId === 'lector' ? 3 : 4) !== 0)
      .map((volunteer) => ({
        volunteerId: volunteer.id,
        massInstanceId: mass.id,
        available: true,
      })),
  );
  const schedule = generateSchedule(massInstances, demoVolunteers, availability).masses;

  return {
    parish: demoParish,
    ministries: demoMinistries,
    activeMonth,
    volunteers: demoVolunteers,
    massTimes: demoMassTimes,
    schedule,
    emailEvents: demoEmailEvents,
  };
}

export function makeDemoAvailability(ministryId = 'emhc'): AvailabilityPayload {
  const dashboard = makeDemoDashboard();
  const ministry = dashboard.ministries.find((item) => item.id === ministryId) ?? dashboard.ministries[0];
  const volunteer =
    demoVolunteers.find((item) => item.active && item.ministryIds.includes(ministry.id)) ??
    demoVolunteers.find((item) => item.active)!;

  return {
    parish: dashboard.parish,
    ministry,
    volunteer: {
      id: volunteer.id,
      name: volunteer.name,
      email: volunteer.email,
    },
    monthLabel: monthLabel(dashboard.activeMonth),
    masses: dashboard.schedule
      .filter((mass) => mass.ministryId === ministry.id)
      .slice(0, 12)
      .map((mass, index) => ({
        massInstanceId: mass.id,
        date: mass.date,
        time: mass.time,
        label: mass.label,
        ministryId: mass.ministryId,
        ministryName: mass.ministryName,
        rolePlural: mass.rolePlural,
        slotsNeeded: mass.slotsNeeded,
        available: index % 5 === 0 ? false : index % 3 === 0 ? true : null,
      })),
  };
}

const demoEmailEvents: EmailEvent[] = [
  {
    id: 'email-1',
    createdAt: new Date().toISOString(),
    type: 'availability_request',
    recipientEmail: 'maria@example.com',
    status: 'sent',
    subject: 'EMHC Availability Request',
  },
  {
    id: 'email-2',
    createdAt: new Date().toISOString(),
    type: 'assignment_notice',
    recipientEmail: 'daniel@example.com',
    status: 'queued',
    subject: 'Your Lector Assignments',
  },
];

function buildMassTimes(): MassTime[] {
  const baseMasses = [
    { id: 'saturday-vigil', label: 'Saturday Vigil', dayOfWeek: 6, specificDate: null, time: '16:00' },
    { id: 'sunday-830', label: 'Sunday Mass', dayOfWeek: 0, specificDate: null, time: '08:30' },
    { id: 'sunday-1030', label: 'Sunday Mass', dayOfWeek: 0, specificDate: null, time: '10:30' },
    { id: 'corpus-christi', label: 'Corpus Christi Procession', dayOfWeek: null, specificDate: `${nextMonthKey()}-14`, time: '18:30' },
  ];

  return baseMasses.flatMap((mass) => [
    withMinistry(mass, demoMinistries[0], mass.id === 'corpus-christi' ? 3 : 2),
    withMinistry(mass, demoMinistries[1], mass.id === 'corpus-christi' ? 6 : mass.id === 'sunday-9' ? 5 : 4),
  ]);
}

function withMinistry(
  mass: { id: string; label: string; dayOfWeek: number | null; specificDate: string | null; time: string },
  ministry: Ministry,
  slotsNeeded: number,
): MassTime {
  return {
    id: `${mass.id}-${ministry.key}`,
    parishId: demoParish.id,
    label: mass.label,
    dayOfWeek: mass.dayOfWeek,
    specificDate: mass.specificDate,
    time: mass.time,
    ministryId: ministry.id,
    ministryName: ministry.name,
    ministryShortName: ministry.shortName,
    roleSingular: ministry.roleSingular,
    rolePlural: ministry.rolePlural,
    slotsNeeded,
    active: true,
    notes: mass.id === 'corpus-christi' ? 'Special Mass.' : '',
  };
}
