export type AdminRole = 'owner' | 'coordinator' | 'assistant';
export type MassStatus = 'draft' | 'needs_attention' | 'approved' | 'cancelled' | 'published';
export type AvailabilityValue = true | false | null;

export interface ParishSettings {
  id: string;
  name: string;
  timezone: string;
  fromName: string;
  replyToEmail: string;
  coordinatorEmail: string;
}

export interface Ministry {
  id: string;
  parishId: string;
  key: string;
  name: string;
  shortName: string;
  roleSingular: string;
  rolePlural: string;
  accentColor: string;
  active: boolean;
  sortOrder: number;
}

export interface Volunteer {
  id: string;
  parishId: string;
  name: string;
  email: string;
  active: boolean;
  ministryIds: string[];
  notes?: string;
}

export interface MassTime {
  id: string;
  parishId: string;
  label: string;
  dayOfWeek: number | null;
  specificDate: string | null;
  time: string;
  ministryId: string;
  ministryName: string;
  ministryShortName: string;
  roleSingular: string;
  rolePlural: string;
  slotsNeeded: number;
  active: boolean;
  notes?: string;
}

export interface MassInstance {
  id: string;
  parishId: string;
  massTimeId: string;
  date: string;
  time: string;
  label: string;
  ministryId: string;
  ministryName: string;
  ministryShortName: string;
  roleSingular: string;
  rolePlural: string;
  slotsNeeded: number;
  status: MassStatus;
  notes?: string;
}

export interface AvailabilityResponse {
  volunteerId: string;
  massInstanceId: string;
  available: boolean;
}

export interface Assignment {
  id: string;
  parishId: string;
  massInstanceId: string;
  ministryId: string;
  volunteerId: string;
  volunteerName: string;
  volunteerEmail: string;
  positionLabel: string;
  status: 'draft' | 'published' | 'coverage_requested' | 'cancelled';
}

export interface ScheduledMass extends MassInstance {
  assignments: Assignment[];
  openings: number;
}

export interface ScheduleRunResult {
  masses: ScheduledMass[];
  needsAttentionCount: number;
  assignmentCounts: Record<string, number>;
}

export interface AvailabilityMass {
  massInstanceId: string;
  date: string;
  time: string;
  label: string;
  ministryId: string;
  ministryName: string;
  rolePlural: string;
  slotsNeeded: number;
  available: AvailabilityValue;
}

export interface AvailabilityPayload {
  parish: ParishSettings;
  ministry: Ministry;
  volunteer: Pick<Volunteer, 'id' | 'name' | 'email'>;
  monthLabel: string;
  masses: AvailabilityMass[];
}

export interface AdminDashboardData {
  parish: ParishSettings;
  ministries: Ministry[];
  activeMonth: string;
  volunteers: Volunteer[];
  massTimes: MassTime[];
  schedule: ScheduledMass[];
  emailEvents: EmailEvent[];
}

export interface CalendarService {
  id: string;
  date: string;
  time: string;
  label: string;
  ministries: ScheduledMass[];
}

export interface EmailEvent {
  id: string;
  createdAt: string;
  type: string;
  recipientEmail: string;
  status: 'queued' | 'sent' | 'failed';
  subject: string;
  errorMessage?: string;
}
