import { Check } from 'lucide-react';
import { MinistryMark } from '../components/MinistryMark';

export function ConfirmPage() {
  const params = new URLSearchParams(window.location.search);
  const title = params.get('title') || 'Thank you';
  const message = params.get('message') || 'Your response has been recorded. You may safely close this page.';

  return (
    <div className="volunteer-shell">
      <header className="volunteer-hero">
        <MinistryMark />
        <h1>{title}</h1>
        <p>The Ministry Scheduler</p>
      </header>
      <main className="volunteer-state success">
        <Check size={44} />
        <h2>{title}</h2>
        <p>{message}</p>
      </main>
    </div>
  );
}
