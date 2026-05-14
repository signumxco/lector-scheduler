import { describe, expect, it } from 'vitest';
import {
  addVolunteerToScheduledMass,
  calculateStats,
  canAddVolunteerToMass,
  filterSchedule,
  filterVolunteers,
  getSpecialDay,
  groupCalendarDays,
  groupCalendarServices,
  removeAssignmentFromScheduledMass,
  setScheduledMassStatus,
} from '../lib/adminSchedule';
import { makeDemoDashboard } from '../lib/demoData';
import type { ScheduledMass, Volunteer } from '../lib/types';

describe('admin schedule helpers', () => {
  it('filters schedule and volunteers by ministry scope', () => {
    const dashboard = makeDemoDashboard();

    expect(filterSchedule(dashboard.schedule, 'lector').every((mass) => mass.ministryId === 'lector')).toBe(true);
    expect(filterSchedule(dashboard.schedule, 'emhc').every((mass) => mass.ministryId === 'emhc')).toBe(true);
    expect(filterSchedule(dashboard.schedule, 'all')).toHaveLength(dashboard.schedule.length);
    expect(filterVolunteers(dashboard.volunteers, 'lector').every((volunteer) => volunteer.ministryIds.includes('lector'))).toBe(true);
  });

  it('calculates stats per selected ministry', () => {
    const dashboard = makeDemoDashboard();

    const allStats = calculateStats(dashboard.schedule, dashboard.volunteers, 'all');
    const lectorStats = calculateStats(dashboard.schedule, dashboard.volunteers, 'lector');

    expect(allStats.masses).toBeGreaterThan(lectorStats.masses);
    expect(lectorStats.volunteers).toBe(3);
    expect(lectorStats.needsAttention).toBeGreaterThan(0);
  });

  it('groups Lector and EMHC rows into one visible calendar service', () => {
    const dashboard = makeDemoDashboard();
    const services = groupCalendarServices(dashboard.schedule);
    const sundayService = services.find((service) => service.label === 'Sunday Mass' && service.time === '08:30');

    expect(sundayService).toBeDefined();
    expect(sundayService?.ministries.map((mass) => mass.ministryId).sort()).toEqual(['emhc', 'lector']);
  });

  it('groups the calendar by service days only', () => {
    const dashboard = makeDemoDashboard();
    const days = groupCalendarDays(dashboard.schedule);

    expect(days.every((day) => day.services.length > 0)).toBe(true);
    expect(days.map((day) => day.date)).toEqual([...new Set(dashboard.schedule.map((mass) => mass.date))].sort());
  });

  it('labels 2026 holy days and distinguishes non-obligatory Assumption', () => {
    expect(getSpecialDay('2026-05-14')).toMatchObject({
      title: 'Ascension of the Lord',
      obligatory: true,
    });
    expect(getSpecialDay('2026-08-15')).toMatchObject({
      title: 'Assumption of the Blessed Virgin Mary',
      obligatory: false,
    });
    expect(getSpecialDay('2026-08-15')?.note?.toLowerCase()).toContain('not obligatory');
    expect(getSpecialDay('2026-12-25')).toMatchObject({
      title: 'Nativity of the Lord',
      obligatory: true,
    });
  });

  it('fills a Mass to capacity and then prevents overbooking', () => {
    const mass = makeOpenMass(2);
    const alice = volunteer('alice');
    const bob = volunteer('bob');
    const carmen = volunteer('carmen');

    const withAlice = addVolunteerToScheduledMass(mass, alice, 1);
    const withBob = addVolunteerToScheduledMass(withAlice, bob, 2);
    const overbookAttempt = addVolunteerToScheduledMass(withBob, carmen, 3);

    expect(withBob.assignments).toHaveLength(2);
    expect(withBob.openings).toBe(0);
    expect(withBob.status).toBe('draft');
    expect(canAddVolunteerToMass(withBob, carmen)).toBe(false);
    expect(overbookAttempt.assignments.map((assignment) => assignment.volunteerId)).toEqual(['alice', 'bob']);
  });

  it('reschedules by removing one volunteer and adding another with renumbered labels', () => {
    const mass = addVolunteerToScheduledMass(addVolunteerToScheduledMass(makeOpenMass(2), volunteer('alice'), 1), volunteer('bob'), 2);

    const afterRemoval = removeAssignmentFromScheduledMass(mass, mass.assignments[0].id);
    const afterReplacement = addVolunteerToScheduledMass(afterRemoval, volunteer('carmen'), 3);

    expect(afterRemoval.assignments).toHaveLength(1);
    expect(afterRemoval.assignments[0].positionLabel).toBe('Lector 1');
    expect(afterRemoval.openings).toBe(1);
    expect(afterRemoval.status).toBe('needs_attention');
    expect(afterReplacement.assignments.map((assignment) => assignment.positionLabel)).toEqual(['Lector 1', 'Lector 2']);
    expect(afterReplacement.openings).toBe(0);
  });

  it('cancels a Mass and blocks additional booking', () => {
    const mass = addVolunteerToScheduledMass(makeOpenMass(2), volunteer('alice'), 1);
    const cancelled = setScheduledMassStatus(mass, 'cancelled');

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.openings).toBe(0);
    expect(canAddVolunteerToMass(cancelled, volunteer('bob'))).toBe(false);
  });

  it('does not add volunteers outside the selected Mass ministry', () => {
    const mass = makeOpenMass(1);
    const emhcOnly = volunteer('maria', ['emhc']);

    expect(canAddVolunteerToMass(mass, emhcOnly)).toBe(false);
    expect(addVolunteerToScheduledMass(mass, emhcOnly, 1).assignments).toHaveLength(0);
  });
});

function makeOpenMass(slotsNeeded: number): ScheduledMass {
  return {
    id: 'mass-1',
    parishId: 'parish-1',
    massTimeId: 'mass-time-1',
    date: '2026-06-07',
    time: '08:30',
    label: 'Sunday Mass',
    ministryId: 'lector',
    ministryName: 'Lectors',
    ministryShortName: 'Lectors',
    roleSingular: 'Lector',
    rolePlural: 'Lectors',
    slotsNeeded,
    status: 'needs_attention',
    assignments: [],
    openings: slotsNeeded,
  };
}

function volunteer(id: string, ministryIds = ['lector']): Volunteer {
  return {
    id,
    parishId: 'parish-1',
    name: id[0].toUpperCase() + id.slice(1),
    email: `${id}@example.com`,
    active: true,
    ministryIds,
  };
}
