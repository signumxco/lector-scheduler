import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Send } from 'lucide-react';
import { MinistryMark } from '../components/MinistryMark';
import { requestCoverage } from '../lib/api';
import { makeDemoDashboard } from '../lib/demoData';
import { formatMassDate } from '../lib/date';

export function CoveragePage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || 'demo-token';
  const isDemoPreview = token === 'demo';
  const demoAssignments = useMemo(
    () => makeDemoDashboard().schedule.flatMap((mass) => mass.assignments.slice(0, 1).map((assignment) => ({ mass, assignment }))).slice(0, 5),
    [],
  );
  const [selectedId, setSelectedId] = useState(params.get('assignment') || demoAssignments[0]?.assignment.id || '');
  const [state, setState] = useState<'ready' | 'sending' | 'sent'>('ready');
  const [message, setMessage] = useState('');

  async function submit() {
    setState('sending');
    try {
      const result = await requestCoverage(token, selectedId);
      setMessage(result.message);
      setState('sent');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not request coverage.');
      setState('ready');
    }
  }

  if (state === 'sent') {
    return (
      <div className="volunteer-shell">
        {isDemoPreview ? <DemoPreviewBanner /> : null}
        <VolunteerHero />
        <main className="volunteer-state success">
          <Check size={44} />
          <h2>Coverage requested</h2>
          <p>{message}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="volunteer-shell">
      {isDemoPreview ? <DemoPreviewBanner /> : null}
      <VolunteerHero />
      <main className="volunteer-main">
        <section className="volunteer-intro">
          <h2>Need a substitute?</h2>
          <p>Select the Mass you need covered. The coordinator and active ministers will be notified by email.</p>
        </section>

        <div className="notice-card">
          <AlertTriangle size={19} aria-hidden="true" />
          <span>Please only request coverage if you genuinely cannot serve this assignment.</span>
        </div>

        <div className="availability-list">
          {demoAssignments.map(({ mass, assignment }) => (
            <button
              className={`availability-card light ${selectedId === assignment.id ? 'available' : ''}`}
              key={assignment.id}
              onClick={() => setSelectedId(assignment.id)}
              type="button"
              aria-label={`${formatMassDate(mass.date, mass.time)}, ${mass.label}, ${assignment.positionLabel}${selectedId === assignment.id ? ', selected' : ''}`}
            >
              <span className="date-badge">
                <strong>{new Date(`${mass.date}T${mass.time}`).getDate()}</strong>
                <span>{new Date(`${mass.date}T${mass.time}`).toLocaleDateString('en-US', { month: 'short' })}</span>
              </span>
              <span className="mass-copy">
                <strong>{formatMassDate(mass.date, mass.time)}</strong>
                <span>{mass.label}</span>
                <small>{assignment.positionLabel}</small>
              </span>
              <span className="availability-status">{selectedId === assignment.id ? 'Selected' : 'Choose'}</span>
            </button>
          ))}
        </div>

        <button className="primary-action danger volunteer-submit-button" disabled={!selectedId || state === 'sending'} onClick={submit} type="button">
          <Send size={18} aria-hidden="true" />
          {state === 'sending' ? 'Sending...' : 'Request coverage'}
        </button>
      </main>
    </div>
  );
}

function DemoPreviewBanner() {
  return (
    <aside className="demo-preview-banner" aria-label="Demo preview notice">
      Demo preview only. No real email is sent, and no parish records are changed.
    </aside>
  );
}

function VolunteerHero() {
  return (
    <header className="volunteer-hero">
      <MinistryMark />
      <h1>Request Coverage</h1>
      <p>Parish Ministries</p>
    </header>
  );
}
