import { Fragment, FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Check,
  Edit3,
  ExternalLink,
  LogOut,
  Mail,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { MinistryMark } from '../components/MinistryMark';
import { MonthHeader } from '../components/MonthHeader';
import { StatusPill } from '../components/StatusPill';
import {
  addVolunteerToScheduledMass,
  calculateStats,
  canAddVolunteerToMass,
  filterSchedule,
  filterVolunteers,
  formatCalendarTime,
  groupCalendarDays,
  ministryColor,
  removeAssignmentFromScheduledMass,
  setScheduledMassStatus,
  type MinistryFilter,
} from '../lib/adminSchedule';
import {
  apiConfig,
  clearSession,
  generateSchedule,
  getAdminDashboard,
  publishSchedule,
  readSession,
  requestAdminMagicLink,
  saveVolunteer,
  sendAvailabilityRequests,
  sendReminders,
  type Session,
} from '../lib/api';
import { formatMassDate, monthLabel, weekdayName } from '../lib/date';
import { buildReminderEmail, makeDemoReminderInput } from '../lib/reminderEmail';
import type { AdminDashboardData, MassStatus, Ministry, ScheduledMass, Volunteer } from '../lib/types';

type Tab = 'calendar' | 'schedule' | 'volunteers' | 'masses' | 'settings' | 'email';
type ConfirmAction = 'availability' | 'generate' | 'publish' | 'reminders';

export function AdminConsole() {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('calendar');
  const [activeMinistryId, setActiveMinistryId] = useState<MinistryFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmMinistryId, setConfirmMinistryId] = useState<string | null>(null);
  const [isActionWorking, setIsActionWorking] = useState(false);
  const [isAvailabilityPickerOpen, setIsAvailabilityPickerOpen] = useState(false);
  const [isPrintPickerOpen, setIsPrintPickerOpen] = useState(false);
  const [isVolunteerPreviewOpen, setIsVolunteerPreviewOpen] = useState(false);
  const [isReminderPreviewOpen, setIsReminderPreviewOpen] = useState(false);
  const [printMinistryId, setPrintMinistryId] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const clearToastTimer = useCallback(() => {
    if (toastTimeoutRef.current === null) return;
    window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = null;
  }, []);

  const dismissToast = useCallback(() => {
    clearToastTimer();
    setToast('');
  }, [clearToastTimer]);

  const showToast = useCallback(
    (message: string) => {
      clearToastTimer();
      setToast(message);
      toastTimeoutRef.current = window.setTimeout(() => {
        setToast('');
        toastTimeoutRef.current = null;
      }, 10_000);
    },
    [clearToastTimer],
  );

  useEffect(() => {
    if (apiConfig.isMisconfigured) {
      setIsLoading(false);
      return;
    }

    if (apiConfig.isConfigured && !session) {
      setIsLoading(false);
      return;
    }

    getAdminDashboard(session)
      .then((data) => setDashboard(data))
      .catch((error: Error) => showToast(error.message || 'Could not load the dashboard.'))
      .finally(() => setIsLoading(false));
  }, [session, showToast]);

  useEffect(() => {
    return () => clearToastTimer();
  }, [clearToastTimer]);

  const stats = useMemo(() => {
    return calculateStats(dashboard?.schedule ?? [], dashboard?.volunteers ?? [], activeMinistryId);
  }, [dashboard, activeMinistryId]);
  const volunteerCount = useMemo(() => {
    return filterVolunteers(dashboard?.volunteers ?? [], activeMinistryId).length;
  }, [dashboard, activeMinistryId]);

  const activeMinistry = activeMinistryId === 'all' ? null : dashboard?.ministries.find((ministry) => ministry.id === activeMinistryId) ?? null;
  const printMinistry = dashboard && printMinistryId ? dashboard.ministries.find((ministry) => ministry.id === printMinistryId) ?? null : activeMinistry;
  const actionMinistry = dashboard && confirmMinistryId ? dashboard.ministries.find((ministry) => ministry.id === confirmMinistryId) ?? null : activeMinistry;
  const actionVolunteerCount = useMemo(() => {
    const ministryId = confirmMinistryId ?? activeMinistryId;
    return filterVolunteers(dashboard?.volunteers ?? [], ministryId).filter((volunteer) => volunteer.active).length;
  }, [dashboard, confirmMinistryId, activeMinistryId]);
  const primaryAction = getPrimaryAction(stats.needsAttention, stats.approved);

  function setSchedule(updater: (schedule: ScheduledMass[]) => ScheduledMass[]) {
    setDashboard((current) => (current ? { ...current, schedule: updater(current.schedule) } : current));
  }

  function updateMass(massInstanceId: string, updater: (mass: ScheduledMass) => ScheduledMass) {
    setSchedule((schedule) => schedule.map((mass) => (mass.id === massInstanceId ? updater(mass) : mass)));
  }

  function addVolunteerToMass(mass: ScheduledMass, volunteerId: string) {
    const volunteer = dashboard?.volunteers.find((item) => item.id === volunteerId);
    if (!canAddVolunteerToMass(mass, volunteer)) return;
    updateMass(mass.id, (item) => (volunteer ? addVolunteerToScheduledMass(item, volunteer) : item));
  }

  function removeAssignment(mass: ScheduledMass, assignmentId: string) {
    updateMass(mass.id, (item) => removeAssignmentFromScheduledMass(item, assignmentId));
  }

  function setMassStatus(mass: ScheduledMass, status: MassStatus) {
    updateMass(mass.id, (item) => setScheduledMassStatus(item, status));
    showToast(`${mass.label} marked ${status.replace('_', ' ')}.`);
  }

  async function refreshDashboard() {
    const nextDashboard = await getAdminDashboard(session);
    setDashboard(nextDashboard);
  }

  function openConfirm(action: ConfirmAction, ministryId: string | null = activeMinistryId === 'all' ? null : activeMinistryId) {
    setIsActionsOpen(false);
    if (action === 'availability' && !ministryId) {
      setIsAvailabilityPickerOpen(true);
      return;
    }
    setConfirmMinistryId(ministryId);
    setConfirmAction(action);
  }

  async function runConfirmedAction(action: ConfirmAction) {
    const messages: Record<ConfirmAction, string> = {
      availability: 'Availability requests queued for active volunteers.',
      generate: 'Draft schedule rebuilt from current availability.',
      publish: 'Approved assignments are ready to publish.',
      reminders: 'Reminder emails queued for assigned volunteers.',
    };
    try {
      setIsActionWorking(true);
      if (apiConfig.isConfigured) {
        if (action === 'availability') {
          if (!confirmMinistryId) throw new Error('Choose a ministry before sending availability requests.');
          const result = await sendAvailabilityRequests({ month: dashboard?.activeMonth ?? '', ministryId: confirmMinistryId }, session);
          messages.availability = `${result.sent} availability request${result.sent === 1 ? '' : 's'} sent.`;
        }
        if (action === 'generate') {
          const result = await generateSchedule({ month: dashboard?.activeMonth ?? '' }, session);
          messages.generate = `Draft schedule built with ${result.assignmentCount} assignment${result.assignmentCount === 1 ? '' : 's'}.`;
        }
        if (action === 'publish') {
          const result = await publishSchedule({ month: dashboard?.activeMonth ?? '' }, session);
          messages.publish = `Published schedule emails sent to ${result.published} volunteer${result.published === 1 ? '' : 's'}.`;
        }
        if (action === 'reminders') {
          const result = await sendReminders(session);
          messages.reminders = `${result.sent} reminder email${result.sent === 1 ? '' : 's'} sent.`;
        }
        await refreshDashboard();
      }
      setConfirmAction(null);
      setConfirmMinistryId(null);
      showToast(messages[action]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The action could not be completed.');
    } finally {
      setIsActionWorking(false);
    }
  }

  function printSacristySheet(ministryId = activeMinistryId) {
    setIsActionsOpen(false);
    if (ministryId === 'all') {
      setIsPrintPickerOpen(true);
      return;
    }
    setPrintMinistryId(ministryId);
    window.setTimeout(() => window.print(), 0);
  }

  function usePrimaryAction() {
    if (primaryAction.kind === 'review') {
      setActiveTab('schedule');
      return;
    }
    if (primaryAction.kind === 'publish') {
      openConfirm('publish');
      return;
    }
    setIsActionsOpen((isOpen) => !isOpen);
  }

  if (apiConfig.isMisconfigured) {
    return <ConfigurationError />;
  }

  if (apiConfig.isConfigured && !session) {
    return <AdminLogin onSession={setSession} showDemoAccess={apiConfig.canUseDemo} />;
  }

  if (isLoading || !dashboard) {
    return (
      <div className="admin-shell">
        <div className="loading-panel">
          <RefreshCw className="spin" size={28} />
          <p>Loading scheduler...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-lockup">
          <MinistryMark compact />
          <div>
            <strong>The Ministry Scheduler</strong>
            <span>{dashboard.parish.name}</span>
          </div>
        </div>

        <div className="workspace-switcher" aria-label="Ministry workspace">
          <button
            aria-pressed={activeMinistryId === 'all'}
            className={activeMinistryId === 'all' ? 'active' : ''}
            onClick={() => setActiveMinistryId('all')}
            type="button"
          >
            All ministries
          </button>
          {dashboard.ministries.map((ministry) => (
            <button
              aria-pressed={activeMinistryId === ministry.id}
              className={activeMinistryId === ministry.id ? 'active' : ''}
              key={ministry.id}
              onClick={() => setActiveMinistryId(ministry.id)}
              type="button"
            >
              <span className="ministry-dot" style={{ background: ministry.accentColor }} />
              {ministry.shortName}
            </button>
          ))}
        </div>

        <nav className="admin-nav" aria-label="Admin navigation">
          <NavButton active={activeTab === 'calendar'} icon={<CalendarDays size={18} />} label="Calendar" onClick={() => setActiveTab('calendar')} />
          <NavButton active={activeTab === 'schedule'} icon={<CalendarPlus size={18} />} label="Schedule" onClick={() => setActiveTab('schedule')} />
          <NavButton active={activeTab === 'volunteers'} icon={<Users size={18} />} label="Volunteers" onClick={() => setActiveTab('volunteers')} />
          <NavButton active={activeTab === 'masses'} icon={<Bell size={18} />} label="Mass Times" onClick={() => setActiveTab('masses')} />
          <NavButton active={activeTab === 'settings'} icon={<Settings size={18} />} label="Settings" onClick={() => setActiveTab('settings')} />
          <NavButton active={activeTab === 'email'} icon={<Mail size={18} />} label="Email Log" onClick={() => setActiveTab('email')} />
        </nav>

        <button
          className="ghost-action sidebar-action"
          onClick={() => {
            clearSession();
            setSession(null);
          }}
          type="button"
        >
          <LogOut size={17} />
          Sign out
        </button>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <div>
            <MonthHeader activeMonth={dashboard.activeMonth} />
            <h1>{activeMinistry ? activeMinistry.name : 'Parish Ministries'}</h1>
            <p>Use the sidebar to move between the calendar, schedule review, volunteers, and settings.</p>
          </div>
          <AdminActionBar
            activeMinistryId={activeMinistryId}
            isActionsOpen={isActionsOpen}
            onCloseMenu={() => setIsActionsOpen(false)}
            onConfirmAction={openConfirm}
            onPrimaryAction={usePrimaryAction}
            onPrint={() => printSacristySheet()}
            onPreviewVolunteer={() => {
              setIsActionsOpen(false);
              setIsVolunteerPreviewOpen(true);
            }}
            onPreviewReminder={() => {
              setIsActionsOpen(false);
              setIsReminderPreviewOpen(true);
            }}
            onToggleMenu={() => setIsActionsOpen((isOpen) => !isOpen)}
            primaryAction={primaryAction}
            showVolunteerPreview={apiConfig.canUseDemo}
          />
        </header>

        {toast ? (
          <div aria-live="polite" className="toast" role="status">
            <Check aria-hidden="true" size={18} />
            {toast}
            <button aria-label="Dismiss notification" onClick={dismissToast} type="button">
              Dismiss
            </button>
          </div>
        ) : null}

        <section className="summary-strip" aria-label="Monthly summary">
          <SummaryCard
            label="Calendar"
            value={stats.masses}
          />
          <SummaryCard
            label="Needs review"
            tone={stats.needsAttention > 0 ? 'warn' : 'ok'}
            value={stats.needsAttention}
          />
          <SummaryCard
            label="Reviewed"
            value={stats.approved}
          />
          <SummaryCard
            label="Masses"
            value={stats.masses}
          />
          <SummaryCard
            label="Active volunteers"
            value={stats.volunteers}
          />
          <SummaryCard
            label="All volunteers"
            value={volunteerCount}
          />
        </section>

        {activeTab === 'calendar' ? (
          <CalendarTab
            dashboard={dashboard}
            activeMinistryId={activeMinistryId}
            onDrillDown={(ministryId) => {
              setActiveMinistryId(ministryId);
              setActiveTab('schedule');
            }}
          />
        ) : null}
        {activeTab === 'schedule' ? (
          <ScheduleTab
            dashboard={dashboard}
            activeMinistryId={activeMinistryId}
            addVolunteerToMass={addVolunteerToMass}
            removeAssignment={removeAssignment}
            setMassStatus={setMassStatus}
          />
        ) : null}
        {activeTab === 'volunteers' ? (
          <VolunteersTab
            dashboard={dashboard}
            activeMinistryId={activeMinistryId}
            setDashboard={setDashboard}
            session={session}
            setToast={showToast}
          />
        ) : null}
        {activeTab === 'masses' ? <MassTimesTab dashboard={dashboard} activeMinistryId={activeMinistryId} /> : null}
        {activeTab === 'settings' ? <SettingsTab dashboard={dashboard} /> : null}
        {activeTab === 'email' ? <EmailTab dashboard={dashboard} /> : null}
        <SacristyPrintSheet dashboard={dashboard} ministry={printMinistry} />
      </main>

      {confirmAction ? (
        <ActionConfirmDialog
          action={confirmAction}
          activeMonth={dashboard.activeMonth}
          approvedCount={stats.approved}
          activeVolunteerCount={actionVolunteerCount}
          isWorking={isActionWorking}
          ministryName={actionMinistry ? actionMinistry.name : 'All ministries'}
          needsReviewCount={stats.needsAttention}
          onCancel={() => {
            if (isActionWorking) return;
            setConfirmAction(null);
            setConfirmMinistryId(null);
          }}
          onConfirm={() => runConfirmedAction(confirmAction)}
          replyToEmail={dashboard.parish.replyToEmail}
        />
      ) : null}

      {isAvailabilityPickerOpen ? (
        <AvailabilityMinistryDialog
          ministries={dashboard.ministries.filter((ministry) => ministry.active)}
          onCancel={() => setIsAvailabilityPickerOpen(false)}
          onContinue={(ministryId) => {
            setIsAvailabilityPickerOpen(false);
            openConfirm('availability', ministryId);
          }}
        />
      ) : null}

      {isPrintPickerOpen ? (
        <PrintMinistryDialog
          ministries={dashboard.ministries.filter((ministry) => ministry.active)}
          onCancel={() => setIsPrintPickerOpen(false)}
          onPrint={(ministryId) => {
            setIsPrintPickerOpen(false);
            setPrintMinistryId(ministryId);
            window.setTimeout(() => window.print(), 0);
          }}
        />
      ) : null}

      {isVolunteerPreviewOpen ? <VolunteerPreviewDialog onCancel={() => setIsVolunteerPreviewOpen(false)} /> : null}

      {isReminderPreviewOpen ? <ReminderPreviewDialog onCancel={() => setIsReminderPreviewOpen(false)} /> : null}
    </div>
  );
}

function getPrimaryAction(needsReviewCount: number, approvedCount: number) {
  if (needsReviewCount > 0) return { kind: 'review' as const, label: 'Next: Review schedule' };
  if (approvedCount > 0) return { kind: 'publish' as const, label: 'Publish approved schedule' };
  return { kind: 'menu' as const, label: 'Open schedule actions' };
}

function AdminActionBar({
  activeMinistryId,
  isActionsOpen,
  onCloseMenu,
  onConfirmAction,
  onPrimaryAction,
  onPrint,
  onPreviewReminder,
  onPreviewVolunteer,
  onToggleMenu,
  primaryAction,
  showVolunteerPreview,
}: {
  activeMinistryId: MinistryFilter;
  isActionsOpen: boolean;
  onCloseMenu: () => void;
  onConfirmAction: (action: ConfirmAction) => void;
  onPrimaryAction: () => void;
  onPrint: () => void;
  onPreviewReminder: () => void;
  onPreviewVolunteer: () => void;
  onToggleMenu: () => void;
  primaryAction: ReturnType<typeof getPrimaryAction>;
  showVolunteerPreview: boolean;
}) {
  useEffect(() => {
    if (!isActionsOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseMenu();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isActionsOpen, onCloseMenu]);

  return (
    <div className="admin-actions">
      <button className="primary-action" onClick={onPrimaryAction} type="button">
        {primaryAction.kind === 'publish' ? <Mail size={17} /> : primaryAction.kind === 'review' ? <CalendarPlus size={17} /> : <Play size={17} />}
        {primaryAction.label}
      </button>
      <div className="action-menu-wrap">
        <button aria-expanded={isActionsOpen} aria-haspopup="menu" className="secondary-action" onClick={onToggleMenu} type="button">
          More actions
          <ChevronDown size={16} />
        </button>
        {isActionsOpen ? (
          <div className="action-menu" role="menu">
            <button onClick={() => onConfirmAction('availability')} role="menuitem" type="button">
              <Send size={16} />
              Request availability
            </button>
            <button onClick={() => onConfirmAction('generate')} role="menuitem" type="button">
              <Play size={16} />
              Build schedule from availability
            </button>
            <button onClick={() => onConfirmAction('reminders')} role="menuitem" type="button">
              <Bell size={16} />
              Send reminders
            </button>
            <button onClick={() => onConfirmAction('publish')} role="menuitem" type="button">
              <Mail size={16} />
              Publish approved schedule
            </button>
            <button onClick={onPrint} role="menuitem" type="button">
              <Printer size={16} />
              Print sacristy sheet
              {activeMinistryId === 'all' ? <small>Choose ministry</small> : null}
            </button>
            {showVolunteerPreview ? (
              <>
                <button onClick={onPreviewVolunteer} role="menuitem" type="button">
                  <ExternalLink size={16} />
                  Preview volunteer experience
                  <small>Demo links only</small>
                </button>
                <button onClick={onPreviewReminder} role="menuitem" type="button">
                  <Mail size={16} />
                  Preview reminder email
                  <small>Lector and EMHC samples</small>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VolunteerPreviewDialog({ onCancel }: { onCancel: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  const previews = [
    {
      title: 'Lector availability form',
      body: 'See the tap-based availability form a lector receives by email.',
      path: '/availability?token=demo&ministry=lector',
    },
    {
      title: 'EMHC availability form',
      body: 'See the same volunteer flow for Eucharistic ministers.',
      path: '/availability?token=demo&ministry=emhc',
    },
    {
      title: 'Coverage request form',
      body: 'Preview what a volunteer sees when asking for a substitute.',
      path: '/coverage?token=demo',
    },
  ];

  function openPreview(path: string) {
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="volunteer-preview-title" aria-modal="true" className="action-dialog" role="dialog">
        <div>
          <span className="dialog-kicker">Demo preview</span>
          <h2 id="volunteer-preview-title">Preview volunteer experience</h2>
          <p>Open the non-admin pages exactly like a volunteer would, without sending email or using Supabase.</p>
        </div>
        <div className="preview-options">
          {previews.map((preview) => (
            <button key={preview.path} onClick={() => openPreview(preview.path)} type="button">
              <span>
                <strong>{preview.title}</strong>
                <small>{preview.body}</small>
              </span>
              <ExternalLink size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="secondary-action" onClick={onCancel} type="button">
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function ReminderPreviewDialog({ onCancel }: { onCancel: () => void }) {
  const [previewKind, setPreviewKind] = useState<'lector1' | 'lector2' | 'emhc'>('lector1');

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  const preview = makeDemoReminderInput(previewKind);
  const html = buildReminderEmail(preview);
  const choices = [
    { key: 'lector1' as const, label: 'Lector 1' },
    { key: 'lector2' as const, label: 'Lector 2' },
    { key: 'emhc' as const, label: 'EMHC' },
  ];

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="reminder-preview-title" aria-modal="true" className="action-dialog reminder-preview-dialog" role="dialog">
        <div>
          <span className="dialog-kicker">Demo preview</span>
          <h2 id="reminder-preview-title">Preview reminder email</h2>
          <p>A quiet sample of the email sent three days before Mass.</p>
        </div>
        <div className="reminder-preview-switch" aria-label="Reminder preview type">
          {choices.map((choice) => (
            <button
              data-active={previewKind === choice.key}
              key={choice.key}
              onClick={() => setPreviewKind(choice.key)}
              type="button"
            >
              {choice.label}
            </button>
          ))}
        </div>
        <iframe className="email-preview-frame" srcDoc={html} title={`${preview.assignmentPosition} reminder email preview`} />
        <div className="dialog-actions">
          <button className="secondary-action" onClick={onCancel} type="button">
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function ActionConfirmDialog({
  action,
  activeMonth,
  activeVolunteerCount,
  approvedCount,
  isWorking,
  ministryName,
  needsReviewCount,
  onCancel,
  onConfirm,
  replyToEmail,
}: {
  action: ConfirmAction;
  activeMonth: string;
  activeVolunteerCount: number;
  approvedCount: number;
  isWorking: boolean;
  ministryName: string;
  needsReviewCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  replyToEmail: string;
}) {
  const content = getConfirmContent(action, {
    activeMonth,
    activeVolunteerCount,
    approvedCount,
    ministryName,
    needsReviewCount,
    replyToEmail,
  });

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isWorking) onCancel();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isWorking, onCancel]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="action-dialog-title" aria-modal="true" className="action-dialog" role="dialog">
        <div>
          <span className="dialog-kicker">{content.kicker}</span>
          <h2 id="action-dialog-title">{content.title}</h2>
          <p>{content.body}</p>
        </div>
        <ul>
          {content.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button className="secondary-action" disabled={isWorking} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-action" disabled={isWorking} onClick={onConfirm} type="button">
            {isWorking ? 'Working...' : content.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function AvailabilityMinistryDialog({
  ministries,
  onCancel,
  onContinue,
}: {
  ministries: Ministry[];
  onCancel: () => void;
  onContinue: (ministryId: string) => void;
}) {
  const [selectedMinistryId, setSelectedMinistryId] = useState(ministries[0]?.id ?? '');

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="availability-ministry-dialog-title" aria-modal="true" className="action-dialog" role="dialog">
        <div>
          <span className="dialog-kicker">Email volunteers</span>
          <h2 id="availability-ministry-dialog-title">Choose a ministry for availability</h2>
          <p>Availability emails are safest when sent one ministry at a time.</p>
        </div>
        <label className="dialog-field">
          Ministry
          <select value={selectedMinistryId} onChange={(event) => setSelectedMinistryId(event.target.value)}>
            {ministries.map((ministry) => (
              <option key={ministry.id} value={ministry.id}>
                {ministry.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button className="secondary-action" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-action" disabled={!selectedMinistryId} onClick={() => onContinue(selectedMinistryId)} type="button">
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}

function getConfirmContent(
  action: ConfirmAction,
  context: {
    activeMonth: string;
    activeVolunteerCount: number;
    approvedCount: number;
    ministryName: string;
    needsReviewCount: number;
    replyToEmail: string;
  },
) {
  const month = monthLabel(context.activeMonth);
  const content = {
    availability: {
      kicker: 'Email volunteers',
      title: 'Request availability?',
      body: 'This will email active volunteers a private link so they can mark when they are available.',
      details: [
        `Month: ${month}`,
        `Ministry: ${context.ministryName}`,
        `Active volunteers: ${context.activeVolunteerCount}`,
        `Replies go to: ${context.replyToEmail}`,
      ],
      confirmLabel: 'Send availability requests',
    },
    generate: {
      kicker: 'Draft assignments',
      title: 'Build schedule from availability?',
      body: 'This will use submitted availability to create or update draft assignments for coordinator review.',
      details: [
        `Month: ${month}`,
        `Ministry: ${context.ministryName}`,
        'Approved and published Masses will stay protected.',
        'Anything that still has openings will remain in Needs Review.',
      ],
      confirmLabel: 'Build draft schedule',
    },
    publish: {
      kicker: 'Email approved schedule',
      title: 'Publish approved schedule?',
      body: 'This will send the approved assignments. Items still needing review will not be included.',
      details: [
        `Approved Masses: ${context.approvedCount}`,
        `Still needing review: ${context.needsReviewCount}`,
        `Ministry: ${context.ministryName}`,
      ],
      confirmLabel: 'Publish approved schedule',
    },
    reminders: {
      kicker: 'Email reminders',
      title: 'Send reminders?',
      body: 'This will email assigned volunteers whose Mass is three days away.',
      details: [`Month: ${month}`, `Ministry: ${context.ministryName}`, 'Only published assignments exactly 3 days away receive reminders.'],
      confirmLabel: 'Send reminders',
    },
  };
  return content[action];
}

function PrintMinistryDialog({
  ministries,
  onCancel,
  onPrint,
}: {
  ministries: Ministry[];
  onCancel: () => void;
  onPrint: (ministryId: string) => void;
}) {
  const [selectedMinistryId, setSelectedMinistryId] = useState(ministries[0]?.id ?? '');

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="print-dialog-title" aria-modal="true" className="action-dialog" role="dialog">
        <div>
          <span className="dialog-kicker">Sacristy sign-off</span>
          <h2 id="print-dialog-title">Choose a ministry to print</h2>
          <p>The sacristy sheet is printed one ministry at a time so it stays simple enough for one page.</p>
        </div>
        <label className="dialog-field">
          Ministry
          <select value={selectedMinistryId} onChange={(event) => setSelectedMinistryId(event.target.value)}>
            {ministries.map((ministry) => (
              <option key={ministry.id} value={ministry.id}>
                {ministry.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button className="secondary-action" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-action" disabled={!selectedMinistryId} onClick={() => onPrint(selectedMinistryId)} type="button">
            Print sacristy sheet
          </button>
        </div>
      </section>
    </div>
  );
}

function SacristyPrintSheet({ dashboard, ministry }: { dashboard: AdminDashboardData; ministry: Ministry | null }) {
  const activeMinistry = ministry ?? dashboard.ministries.find((item) => item.active) ?? dashboard.ministries[0];
  if (!activeMinistry) return null;
  const masses = filterSchedule(dashboard.schedule, activeMinistry.id)
    .filter((mass) => mass.date.startsWith(dashboard.activeMonth))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const maxSlots = activeMinistry.id === 'lector' ? 2 : Math.max(1, ...masses.map((mass) => mass.slotsNeeded));
  const roleColumns = Array.from({ length: maxSlots });
  const footerNote =
    activeMinistry.id === 'lector'
      ? 'Lector 1 does announcements. Lector 2 does Prayers of the Faithful unless otherwise noted.'
      : 'Please sign in when you arrive so the coordinator knows every position is covered.';

  return (
    <section aria-label="Sacristy sign-off sheet" className="print-sheet">
      <header>
        <div>
          <p>{dashboard.parish.name}</p>
          <h1>{activeMinistry.name} Sign-Off Sheet</h1>
        </div>
        <strong>{monthLabel(dashboard.activeMonth)}</strong>
      </header>
      <table className="print-schedule-table">
        <thead>
          <tr>
            <th>Date and Time</th>
            {roleColumns.map((_, index) => (
              <Fragment key={`head-${index}`}>
                <th>{`${activeMinistry.roleSingular} #${index + 1}`}</th>
                <th>Sign In</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {masses.map((mass) => (
            <tr key={mass.id}>
              <td>
                <strong>{formatPrintMassDate(mass.date, mass.time)}</strong>
                <span>{mass.label}</span>
              </td>
              {getPrintSlots(mass, maxSlots).map((slot, index) => (
                <Fragment key={`${mass.id}-${index}`}>
                  <td className={slot.isOpen ? 'open-slot' : ''}>{slot.name}</td>
                  <td>
                    <span className="signature-line" />
                  </td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <footer>{footerNote}</footer>
    </section>
  );
}

function getPrintSlots(mass: ScheduledMass, slotCount: number) {
  return Array.from({ length: slotCount }).map((_, index) => {
    const assignment = mass.assignments[index];
    const isExpectedSlot = index < mass.slotsNeeded;
    return {
      name: isExpectedSlot ? assignment?.volunteerName ?? 'Open' : '',
      isOpen: isExpectedSlot && !assignment,
    };
  });
}

function formatPrintMassDate(date: string, time: string): string {
  const value = new Date(`${date}T${time}`);
  const day = value.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeLabel = value.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${day} at ${timeLabel}`;
}

function ConfigurationError() {
  return (
    <div className="login-shell">
      <section className="login-card" role="alert">
        <MinistryMark />
        <h1>Supabase setup is incomplete</h1>
        <p>
          This app has only part of the Supabase frontend configuration. Add the missing env vars, then restart the dev
          server before testing real auth.
        </p>
        <div className="config-list">
          <strong>Missing</strong>
          <span>{apiConfig.missingEnvVars.join(', ')}</span>
        </div>
      </section>
    </div>
  );
}

function AdminLogin({ onSession, showDemoAccess }: { onSession: (session: Session | null) => void; showDemoAccess: boolean }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await requestAdminMagicLink(email);
    setMessage('Check your email for the sign-in link.');
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <MinistryMark />
        <h1>Coordinator sign in</h1>
        <p>Enter your admin email. We will send a secure sign-in link with no password to remember.</p>
        <label>
          Email address
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="coordinator@example-parish.org" type="email" />
        </label>
        <button className="primary-action full" type="submit">
          <ShieldCheck size={18} />
          Send sign-in link
        </button>
        {message ? <p className="form-note">{message}</p> : null}
        {showDemoAccess ? (
          <button className="ghost-action full" onClick={() => onSession({ accessToken: 'demo' })} type="button">
            View demo console
          </button>
        ) : null}
      </form>
    </div>
  );
}

function CalendarTab({
  dashboard,
  activeMinistryId,
  onDrillDown,
}: {
  dashboard: AdminDashboardData;
  activeMinistryId: MinistryFilter;
  onDrillDown: (ministryId: string) => void;
}) {
  const days = groupCalendarDays(filterSchedule(dashboard.schedule, activeMinistryId));

  return (
    <section className="panel-stack">
      <div className="section-toolbar">
        <div>
          <h2>Calendar</h2>
          <p>Weekend and holy day services across ministries, grouped by Mass time.</p>
        </div>
      </div>
      <div className="calendar-days" aria-label="Scheduled service days">
        {days.map((day) => {
          const date = new Date(`${day.date}T00:00:00`);
          return (
            <article className="calendar-day-row" key={day.date}>
              <header className="calendar-day-header">
                <span className="calendar-date">
                  <strong>{date.getDate()}</strong>
                  <small>{date.toLocaleDateString('en-US', { month: 'short' })}</small>
                </span>
                <div>
                  <h3>{date.toLocaleDateString('en-US', { weekday: 'long' })}</h3>
                  {day.specialDay ? (
                    <p>
                      {day.specialDay.title}
                      <span>{day.specialDay.obligatory ? 'Holy day of obligation' : day.specialDay.note}</span>
                    </p>
                  ) : null}
                </div>
              </header>
              <div className="calendar-day-services">
                {day.services.map((service) => (
                  <article className="calendar-service" key={service.id}>
                    <strong>
                      {formatCalendarTime(service.time)} · {service.label}
                    </strong>
                    <div className="calendar-ministry-list">
                      {service.ministries.map((mass) => {
                        const isFilled = mass.assignments.length >= mass.slotsNeeded;
                        return (
                          <button
                            aria-label={`${mass.ministryShortName} ${mass.assignments.length} of ${mass.slotsNeeded}; open ${mass.ministryName} schedule`}
                            className="calendar-ministry"
                            data-filled={isFilled ? 'true' : 'false'}
                            key={mass.id}
                            onClick={() => onDrillDown(mass.ministryId)}
                            type="button"
                          >
                            <span className="ministry-dot" style={{ background: ministryColor(dashboard.ministries, mass.ministryId) }} />
                            {mass.ministryShortName}: {mass.assignments.length}/{mass.slotsNeeded}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
function ScheduleTab({
  dashboard,
  activeMinistryId,
  addVolunteerToMass,
  removeAssignment,
  setMassStatus,
}: {
  dashboard: AdminDashboardData;
  activeMinistryId: MinistryFilter;
  addVolunteerToMass: (mass: ScheduledMass, volunteerId: string) => void;
  removeAssignment: (mass: ScheduledMass, assignmentId: string) => void;
  setMassStatus: (mass: ScheduledMass, status: MassStatus) => void;
}) {
  const activeVolunteers = filterVolunteers(dashboard.volunteers, activeMinistryId).filter((volunteer) => volunteer.active);
  const scopedSchedule = filterSchedule(dashboard.schedule, activeMinistryId);
  const visibleSchedule = scopedSchedule.filter(needsReview);
  const orderedSchedule = visibleSchedule.sort((a, b) => {
    return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
  });

  return (
    <section className="panel-stack">
      <div className="section-toolbar">
        <div>
          <h2>Schedule Review</h2>
          <p>Masses needing review stay here until a coordinator approves them.</p>
        </div>
      </div>

      {orderedSchedule.length === 0 ? (
        <EmptyState
          title="Everything is reviewed"
          body="There are no Masses needing coordinator attention in this ministry scope."
        />
      ) : null}

      {orderedSchedule.map((mass) => (
        <article className="schedule-card" data-review-state={needsReview(mass) ? 'needs-review' : isReviewed(mass) ? 'reviewed' : 'draft'} key={mass.id}>
          <div className="schedule-card-top">
            <div>
              <h3>{formatMassDate(mass.date, mass.time)}</h3>
              <p>
                {mass.label} · {mass.slotsNeeded} {mass.rolePlural.toLowerCase()} needed
              </p>
            </div>
            <StatusPill status={mass.status} />
          </div>

          <div className="assignment-grid">
            {mass.assignments.map((assignment) => (
              <div className="assignment-chip" key={assignment.id}>
                <span>
                  <strong>{assignment.volunteerName}</strong>
                  <small>{assignment.positionLabel}</small>
                </span>
                <button aria-label={`Remove ${assignment.volunteerName}`} onClick={() => removeAssignment(mass, assignment.id)} type="button">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {mass.status !== 'cancelled' && Array.from({ length: mass.openings }).map((_, index) => (
              <label className="assignment-chip opening" key={`opening-${mass.id}-${index}`}>
                <span>Opening</span>
                <select
                  aria-label={`Fill opening ${index + 1} for ${formatMassDate(mass.date, mass.time)}`}
                  value=""
                  onChange={(event) => {
                    addVolunteerToMass(mass, event.target.value);
                    event.target.value = '';
                  }}
                >
                  <option value="">Choose volunteer...</option>
                  {activeVolunteers
                    .filter((volunteer) => canAddVolunteerToMass(mass, volunteer))
                    .map((volunteer) => (
                      <option key={volunteer.id} value={volunteer.id}>
                        {volunteer.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>

          <div className="card-controls">
            <div className="segmented-actions">
              <button onClick={() => setMassStatus(mass, 'approved')} type="button">
                Approve
              </button>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function needsReview(mass: ScheduledMass) {
  return mass.status !== 'approved' && mass.status !== 'published';
}

function isReviewed(mass: ScheduledMass) {
  return (mass.status === 'approved' || mass.status === 'published') && mass.openings === 0;
}

function VolunteersTab({
  dashboard,
  activeMinistryId,
  setDashboard,
  session,
  setToast,
}: {
  dashboard: AdminDashboardData;
  activeMinistryId: MinistryFilter;
  setDashboard: (updater: (current: AdminDashboardData | null) => AdminDashboardData | null) => void;
  session: Session | null;
  setToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState({ name: '', email: '', notes: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Volunteer | null>(null);
  const [openMinistryMenuId, setOpenMinistryMenuId] = useState<string | null>(null);
  const visibleVolunteers = filterVolunteers(dashboard.volunteers, activeMinistryId);

  async function addVolunteer(event: FormEvent) {
    event.preventDefault();
    const volunteer: Volunteer = {
      id: `volunteer-${Date.now()}`,
      parishId: dashboard.parish.id,
      name: draft.name.trim(),
      email: draft.email.trim(),
      active: true,
      ministryIds: activeMinistryId === 'all' ? dashboard.ministries.map((ministry) => ministry.id) : [activeMinistryId],
      notes: draft.notes.trim(),
    };
    if (!volunteer.name || !volunteer.email) return;
    const saved = await saveVolunteer(volunteer, session);
    setDashboard((current) => (current ? { ...current, volunteers: [...current.volunteers, saved] } : current));
    setDraft({ name: '', email: '', notes: '' });
    setToast(`${saved.name} added to the roster.`);
  }

  function toggleVolunteer(volunteer: Volunteer) {
    void saveVolunteerChanges({ ...volunteer, active: !volunteer.active });
  }

  function startEditing(volunteer: Volunteer) {
    setEditingId(volunteer.id);
    setOpenMinistryMenuId(null);
    setEditDraft({ ...volunteer, ministryIds: [...volunteer.ministryIds] });
  }

  function cancelEditing() {
    setEditingId(null);
    setEditDraft(null);
    setOpenMinistryMenuId(null);
  }

  async function submitVolunteerEdit(event: FormEvent) {
    event.preventDefault();
    if (!editDraft) return;
    await saveVolunteerChanges({
      ...editDraft,
      name: editDraft.name.trim(),
      email: editDraft.email.trim(),
      notes: editDraft.notes?.trim(),
      active: editDraft.ministryIds.length > 0 ? editDraft.active : false,
    });
    cancelEditing();
  }

  async function saveVolunteerChanges(volunteer: Volunteer) {
    if (!volunteer.name || !volunteer.email) return;
    const saved = await saveVolunteer(volunteer, session);
    setDashboard((current) =>
      current
        ? {
            ...current,
            volunteers: current.volunteers.map((item) => (item.id === saved.id ? saved : item)),
          }
        : current,
    );
    setToast(`${saved.name} updated.`);
  }

  function toggleEditMinistry(ministryId: string) {
    setEditDraft((current) => {
      if (!current) return current;
      const ministryIds = current.ministryIds.includes(ministryId)
        ? current.ministryIds.filter((id) => id !== ministryId)
        : [...current.ministryIds, ministryId];
      return {
        ...current,
        ministryIds,
        active: ministryIds.length > 0 ? current.active || current.ministryIds.length === 0 : false,
      };
    });
  }

  function formatSelectedMinistries(ministryIds: string[]) {
    return (
      dashboard.ministries
        .filter((ministry) => ministryIds.includes(ministry.id))
        .map((ministry) => ministry.shortName)
        .join(', ') || 'No ministries'
    );
  }

  return (
    <section className="panel-stack">
      <div className="section-toolbar">
        <div>
          <h2>Volunteers</h2>
          <p>Keep this list simple: name, email, active status, and notes.</p>
        </div>
      </div>

      <form className="inline-form" onSubmit={addVolunteer}>
        <label>
          Name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Jane Smith" />
        </label>
        <label>
          Email
          <input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="jane@example-parish.org" type="email" />
        </label>
        <label>
          Notes
          <input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Optional" />
        </label>
        <button className="primary-action" type="submit">
          <Plus size={17} />
          Add
        </button>
      </form>

      <div className="data-table">
        {visibleVolunteers.map((volunteer) => (
          <div className="table-row" key={volunteer.id}>
            {editingId === volunteer.id && editDraft ? (
              <form className="volunteer-edit-row" onSubmit={submitVolunteerEdit}>
                <label>
                  Name
                  <input value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} />
                </label>
                <label>
                  Email
                  <input value={editDraft.email} onChange={(event) => setEditDraft({ ...editDraft, email: event.target.value })} type="email" />
                </label>
                <label>
                  Notes
                  <input value={editDraft.notes ?? ''} onChange={(event) => setEditDraft({ ...editDraft, notes: event.target.value })} />
                </label>
                <div className="ministry-select-field">
                  <span className="field-label">Ministries</span>
                  <div className="ministry-menu" data-open={openMinistryMenuId === volunteer.id ? 'true' : 'false'}>
                    <button
                      aria-expanded={openMinistryMenuId === volunteer.id}
                      aria-haspopup="true"
                      className="ministry-menu-trigger"
                      onClick={() => setOpenMinistryMenuId((current) => (current === volunteer.id ? null : volunteer.id))}
                      type="button"
                    >
                      <span>{formatSelectedMinistries(editDraft.ministryIds)}</span>
                      <ChevronDown size={16} />
                    </button>
                    {openMinistryMenuId === volunteer.id ? (
                      <fieldset className="ministry-menu-popover">
                        <legend className="sr-only">Choose ministries</legend>
                        {dashboard.ministries.map((ministry) => (
                          <label className="ministry-menu-option" key={ministry.id}>
                            <input
                              checked={editDraft.ministryIds.includes(ministry.id)}
                              onChange={() => toggleEditMinistry(ministry.id)}
                              type="checkbox"
                            />
                            <span className="ministry-dot" style={{ background: ministry.accentColor }} />
                            {ministry.shortName}
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                  </div>
                  {editDraft.ministryIds.length === 0 ? <span className="field-hint">No ministries pauses this volunteer.</span> : null}
                </div>
                <label className="active-check" data-disabled={editDraft.ministryIds.length === 0 ? 'true' : 'false'}>
                  <input
                    checked={editDraft.ministryIds.length > 0 && editDraft.active}
                    disabled={editDraft.ministryIds.length === 0}
                    onChange={(event) => setEditDraft({ ...editDraft, active: event.target.checked })}
                    type="checkbox"
                  />
                  Active
                </label>
                <div className="row-actions">
                  <button className="secondary-action" onClick={cancelEditing} type="button">
                    Cancel
                  </button>
                  <button className="primary-action" type="submit">
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div>
                  <strong>{volunteer.name}</strong>
                  <span>{volunteer.email}</span>
                </div>
                <span className="ministry-badge-line">
                  {volunteer.ministryIds.map((ministryId) => {
                    const ministry = dashboard.ministries.find((item) => item.id === ministryId);
                    return ministry ? (
                      <span className="mini-badge" key={ministry.id}>
                        <span className="ministry-dot" style={{ background: ministry.accentColor }} />
                        {ministry.shortName}
                      </span>
                    ) : null;
                  })}
                </span>
                <div className="row-actions">
                  <button className="icon-action" aria-label={`Edit ${volunteer.name}`} onClick={() => startEditing(volunteer)} type="button">
                    <Edit3 size={16} />
                  </button>
                  <button className={volunteer.active ? 'toggle active' : 'toggle'} onClick={() => toggleVolunteer(volunteer)} type="button">
                    {volunteer.active ? 'Active' : 'Paused'}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function MassTimesTab({ dashboard, activeMinistryId }: { dashboard: AdminDashboardData; activeMinistryId: MinistryFilter }) {
  const massTimes = dashboard.massTimes.filter((massTime) => activeMinistryId === 'all' || massTime.ministryId === activeMinistryId);
  return (
    <section className="panel-stack">
      <div className="section-toolbar">
        <div>
          <h2>Mass Times</h2>
          <p>Recurring and one-time Masses feed the monthly availability form.</p>
        </div>
      </div>
      <div className="data-table">
        {massTimes.map((massTime) => (
          <div className="table-row" key={massTime.id}>
            <div>
              <strong>{massTime.label}</strong>
              <span>
                {massTime.specificDate ? massTime.specificDate : weekdayName(massTime.dayOfWeek ?? 0)} · {massTime.ministryShortName}
              </span>
            </div>
            <span>{massTime.time}</span>
            <span>
              {massTime.slotsNeeded} {massTime.rolePlural.toLowerCase()}
            </span>
            <button className={massTime.active ? 'toggle active' : 'toggle'} type="button">
              {massTime.active ? 'Active' : 'Paused'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsTab({ dashboard }: { dashboard: AdminDashboardData }) {
  return (
    <section className="panel-stack">
      <div className="settings-grid">
        <Setting label="Parish" value={dashboard.parish.name} />
        <Setting label="Ministries" value={dashboard.ministries.map((ministry) => ministry.shortName).join(', ')} />
        <Setting label="Sender name" value={dashboard.parish.fromName} />
        <Setting label="Reply-to email" value={dashboard.parish.replyToEmail} />
        <Setting label="Coordinator" value={dashboard.parish.coordinatorEmail} />
        <Setting label="Timezone" value={dashboard.parish.timezone} />
      </div>
      <div className="notice-card quiet">
        <Settings size={19} />
        <span>
          These values are stored in parish settings, so a new coordinator can take over without code changes or
          redeploying the app.
        </span>
      </div>
    </section>
  );
}

function EmailTab({ dashboard }: { dashboard: AdminDashboardData }) {
  if (dashboard.emailEvents.length === 0) {
    return <EmptyState title="No email events yet" body="Availability requests, reminders, and assignment emails will appear here." />;
  }

  return (
    <section className="panel-stack">
      <div className="data-table">
        {dashboard.emailEvents.map((event) => (
          <div className="table-row" key={event.id}>
            <div>
              <strong>{event.subject}</strong>
              <span>{event.recipientEmail}</span>
            </div>
            <span>{event.type.replaceAll('_', ' ')}</span>
            <button className={event.status === 'failed' ? 'toggle danger' : event.status === 'sent' ? 'toggle active' : 'toggle'} type="button">
              {event.status}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button aria-current={active ? 'page' : undefined} className={active ? 'active' : ''} onClick={onClick} type="button">
      {icon}
      {label}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div aria-label={`${label}: ${value}`} className={`summary-card ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="setting-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
