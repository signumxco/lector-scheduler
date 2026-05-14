import { describe, expect, it } from 'vitest';
import { expandMassTimesForMonth, generateSchedule } from '../lib/scheduler';
import type { AvailabilityResponse, MassTime, Volunteer } from '../lib/types';

const parishId = 'parish-1';
const ministryId = 'lector';
const ministryFields = {
  ministryId,
  ministryName: 'Lectors',
  ministryShortName: 'Lectors',
  roleSingular: 'Lector',
  rolePlural: 'Lectors',
};

const volunteers: Volunteer[] = [
  { id: 'a', parishId, name: 'Alice', email: 'a@example.com', active: true, ministryIds: [ministryId] },
  { id: 'b', parishId, name: 'Bob', email: 'b@example.com', active: true, ministryIds: [ministryId] },
  { id: 'c', parishId, name: 'Carmen', email: 'c@example.com', active: true, ministryIds: [ministryId] },
  { id: 'd', parishId, name: 'Dan', email: 'd@example.com', active: false, ministryIds: [ministryId] },
  { id: 'e', parishId, name: 'Eli', email: 'e@example.com', active: true, ministryIds: ['emhc'] },
];

const massTimes: MassTime[] = [
  {
    id: 'sunday-9',
    parishId,
    label: 'Sunday 9 AM',
    dayOfWeek: 0,
    specificDate: null,
    time: '09:00',
    ...ministryFields,
    slotsNeeded: 2,
    active: true,
  },
  {
    id: 'special',
    parishId,
    label: 'Special Mass',
    dayOfWeek: null,
    specificDate: '2026-06-10',
    time: '18:00',
    ...ministryFields,
    slotsNeeded: 3,
    active: true,
  },
];

describe('expandMassTimesForMonth', () => {
  it('expands recurring and one-time Masses for the target month', () => {
    const instances = expandMassTimesForMonth(massTimes, '2026-06');

    expect(instances.some((mass) => mass.date === '2026-06-10' && mass.label === 'Special Mass')).toBe(true);
    expect(instances.filter((mass) => mass.label === 'Sunday 9 AM')).toHaveLength(4);
    expect(instances.every((mass) => mass.date.startsWith('2026-06'))).toBe(true);
  });
});

describe('generateSchedule', () => {
  it('assigns only active available volunteers', () => {
    const masses = expandMassTimesForMonth(massTimes.slice(0, 1), '2026-06').slice(0, 1);
    const responses: AvailabilityResponse[] = [
      { volunteerId: 'a', massInstanceId: masses[0].id, available: true },
      { volunteerId: 'b', massInstanceId: masses[0].id, available: true },
      { volunteerId: 'd', massInstanceId: masses[0].id, available: true },
      { volunteerId: 'e', massInstanceId: masses[0].id, available: true },
    ];

    const result = generateSchedule(masses, volunteers, responses);

    expect(result.masses[0].assignments.map((assignment) => assignment.volunteerId)).toEqual(['a', 'b']);
    expect(result.masses[0].status).toBe('draft');
  });

  it('marks Masses short when availability is insufficient', () => {
    const masses = expandMassTimesForMonth(massTimes.slice(1), '2026-06');
    const responses: AvailabilityResponse[] = [
      { volunteerId: 'a', massInstanceId: masses[0].id, available: true },
      { volunteerId: 'b', massInstanceId: masses[0].id, available: false },
    ];

    const result = generateSchedule(masses, volunteers, responses);

    expect(result.masses[0].openings).toBe(2);
    expect(result.masses[0].status).toBe('needs_attention');
    expect(result.needsAttentionCount).toBe(1);
  });

  it('does not double-book the same volunteer on the same day', () => {
    const masses = [
      {
        id: 'morning',
        parishId,
        massTimeId: 'm1',
        date: '2026-06-07',
        time: '09:00',
        label: 'Morning',
        ...ministryFields,
        slotsNeeded: 1,
        status: 'draft' as const,
      },
      {
        id: 'late',
        parishId,
        massTimeId: 'm2',
        date: '2026-06-07',
        time: '11:00',
        label: 'Late',
        ...ministryFields,
        slotsNeeded: 1,
        status: 'draft' as const,
      },
    ];
    const responses: AvailabilityResponse[] = [
      { volunteerId: 'a', massInstanceId: 'morning', available: true },
      { volunteerId: 'a', massInstanceId: 'late', available: true },
      { volunteerId: 'b', massInstanceId: 'late', available: true },
    ];

    const result = generateSchedule(masses, volunteers, responses);

    expect(result.masses[0].assignments[0].volunteerId).toBe('a');
    expect(result.masses[1].assignments[0].volunteerId).toBe('b');
  });

  it('does not double-book a shared volunteer across ministries on the same day', () => {
    const sharedVolunteers: Volunteer[] = [
      { id: 'shared', parishId, name: 'Shared', email: 'shared@example.com', active: true, ministryIds: ['lector', 'emhc'] },
      { id: 'emhc-only', parishId, name: 'Emhc Only', email: 'emhc@example.com', active: true, ministryIds: ['emhc'] },
    ];
    const masses = [
      {
        id: 'lector-mass',
        parishId,
        massTimeId: 'lector',
        date: '2026-06-07',
        time: '09:00',
        label: 'Sunday 9 AM',
        ...ministryFields,
        slotsNeeded: 1,
        status: 'draft' as const,
      },
      {
        id: 'emhc-mass',
        parishId,
        massTimeId: 'emhc',
        date: '2026-06-07',
        time: '09:00',
        label: 'Sunday 9 AM',
        ministryId: 'emhc',
        ministryName: 'Eucharistic Ministers',
        ministryShortName: 'EMHC',
        roleSingular: 'Minister',
        rolePlural: 'Ministers',
        slotsNeeded: 1,
        status: 'draft' as const,
      },
    ];
    const responses: AvailabilityResponse[] = [
      { volunteerId: 'shared', massInstanceId: 'lector-mass', available: true },
      { volunteerId: 'shared', massInstanceId: 'emhc-mass', available: true },
      { volunteerId: 'emhc-only', massInstanceId: 'emhc-mass', available: true },
    ];

    const result = generateSchedule(masses, sharedVolunteers, responses);

    expect(result.masses[0].assignments[0].volunteerId).toBe('shared');
    expect(result.masses[1].assignments[0].volunteerId).toBe('emhc-only');
  });

  it('balances assignments by current count before alphabetical name', () => {
    const masses = [
      {
        id: 'm1',
        parishId,
        massTimeId: 'm1',
        date: '2026-06-01',
        time: '09:00',
        label: 'One',
        ...ministryFields,
        slotsNeeded: 1,
        status: 'draft' as const,
      },
      {
        id: 'm2',
        parishId,
        massTimeId: 'm2',
        date: '2026-06-02',
        time: '09:00',
        label: 'Two',
        ...ministryFields,
        slotsNeeded: 1,
        status: 'draft' as const,
      },
      {
        id: 'm3',
        parishId,
        massTimeId: 'm3',
        date: '2026-06-03',
        time: '09:00',
        label: 'Three',
        ...ministryFields,
        slotsNeeded: 1,
        status: 'draft' as const,
      },
    ];
    const responses = masses.flatMap((mass) => [
      { volunteerId: 'a', massInstanceId: mass.id, available: true },
      { volunteerId: 'b', massInstanceId: mass.id, available: true },
    ]);

    const result = generateSchedule(masses, volunteers, responses);

    expect(result.assignmentCounts.a).toBe(2);
    expect(result.assignmentCounts.b).toBe(1);
    expect(result.masses[1].assignments[0].volunteerId).toBe('b');
  });
});
