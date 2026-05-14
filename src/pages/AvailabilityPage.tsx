import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { MinistryMark } from '../components/MinistryMark';
import { formatMassDate } from '../lib/date';
import { getAvailability, submitAvailability } from '../lib/api';
import type { AvailabilityMass, AvailabilityPayload, AvailabilityValue } from '../lib/types';

export function AvailabilityPage() {
  const token = getToken();
  const isDemoPreview = token === 'demo';
  const [payload, setPayload] = useState<AvailabilityPayload | null>(null);
  const [selections, setSelections] = useState<Record<string, AvailabilityValue>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('This availability link is missing a token. Please use the link from your email.');
      return;
    }

    getAvailability(token)
      .then((data) => {
        setPayload(data);
        setSelections(Object.fromEntries(data.masses.map((mass) => [mass.massInstanceId, mass.available])));
        setState('ready');
      })
      .catch((error: Error) => {
        setState('error');
        setMessage(error.message || 'Could not load your availability form.');
      });
  }, [token]);

  const answered = useMemo(
    () => Object.values(selections).filter((value) => value !== null && value !== undefined).length,
    [selections],
  );

  function toggleMass(mass: AvailabilityMass) {
    setSelections((current) => {
      const value = current[mass.massInstanceId];
      const next = value === null || value === undefined ? true : value === true ? false : null;
      return { ...current, [mass.massInstanceId]: next };
    });
  }

  async function save() {
    if (!token || !payload) return;
    const chosen = payload.masses
      .filter((mass) => selections[mass.massInstanceId] !== null && selections[mass.massInstanceId] !== undefined)
      .map((mass) => ({ massInstanceId: mass.massInstanceId, available: selections[mass.massInstanceId] === true }));

    if (chosen.length === 0) {
      setMessage('Please mark at least one Mass before submitting.');
      return;
    }

    setState('saving');
    try {
      const result = await submitAvailability(token, chosen);
      setMessage(result.message);
      setState('saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save availability.');
      setState('ready');
    }
  }

  if (state === 'loading') return <VolunteerState title="Loading your calendar" body="Fetching this month&apos;s Mass schedule." loading />;
  if (state === 'error') return <VolunteerState title="Something went wrong" body={message} tone="error" />;
  if (state === 'saved') return <VolunteerState title="Availability saved" body={message || 'Thank you for your ministry.'} tone="success" />;

  return (
    <div className="volunteer-shell">
      {isDemoPreview ? <DemoPreviewBanner /> : null}
      <VolunteerHero title={`${payload?.ministry.shortName ?? 'Ministry'} Availability`} subtitle={payload?.monthLabel ?? ''} />
      <main className="volunteer-main">
        <section className="volunteer-intro">
          <h2>Hello, {payload?.volunteer.name}</h2>
          <p>
            Tap each Mass to mark whether you can serve. Green means available, red means unavailable. You can change
            your answer before submitting.
          </p>
        </section>

        <div className="availability-list">
          {payload?.masses.map((mass) => {
            const value = selections[mass.massInstanceId];
            const stateClass = value === true ? 'available' : value === false ? 'unavailable' : '';
            const statusText = value === true ? 'Available' : value === false ? 'Unavailable' : 'Not marked';
            const date = new Date(`${mass.date}T${mass.time}`);
            return (
              <button
                aria-label={`${formatMassDate(mass.date, mass.time)}, ${mass.label}, ${statusText}`}
                className={`availability-card ${stateClass}`}
                key={mass.massInstanceId}
                onClick={() => toggleMass(mass)}
                type="button"
              >
                <span className="date-badge">
                  <strong>{date.getDate()}</strong>
                  <span>{date.toLocaleDateString('en-US', { month: 'short' })}</span>
                </span>
                <span className="mass-copy">
                  <strong>{date.toLocaleDateString('en-US', { weekday: 'long' })}</strong>
                  <span>
                    {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {mass.label}
                  </span>
                  <small>
                    {mass.slotsNeeded} {mass.rolePlural.toLowerCase()} needed
                  </small>
                </span>
                <span className="availability-indicator" aria-hidden="true">
                  {value === true ? <Check size={18} /> : value === false ? <X size={18} /> : null}
                </span>
                <span className="availability-status">{statusText}</span>
              </button>
            );
          })}
        </div>
      </main>

      <footer className="submit-bar">
        <span>
          <strong>{answered}</strong> of {payload?.masses.length ?? 0} answered
        </span>
        <button className="primary-action" disabled={state === 'saving' || answered === 0} onClick={save} type="button">
          {state === 'saving' ? 'Saving...' : 'Submit availability'}
        </button>
      </footer>
    </div>
  );
}

function VolunteerHero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="volunteer-hero">
      <MinistryMark />
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

function VolunteerState({
  title,
  body,
  loading = false,
  tone = 'neutral',
}: {
  title: string;
  body: string;
  loading?: boolean;
  tone?: 'neutral' | 'error' | 'success';
}) {
  return (
    <div className="volunteer-shell">
      {getToken() === 'demo' ? <DemoPreviewBanner /> : null}
      <VolunteerHero title={title} subtitle="" />
      <main className={`volunteer-state ${tone}`}>
        {loading ? <Loader2 className="spin" size={40} /> : tone === 'success' ? <Check size={42} /> : <X size={42} />}
        <h2>{title}</h2>
        <p dangerouslySetInnerHTML={{ __html: body }} />
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

function getToken(): string {
  const searchToken = new URLSearchParams(window.location.search).get('token');
  if (searchToken) return searchToken;
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[1] ?? '';
}
