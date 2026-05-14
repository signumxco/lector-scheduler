import { AdminConsole } from './pages/AdminConsole';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { ConfirmPage } from './pages/ConfirmPage';
import { CoveragePage } from './pages/CoveragePage';

export default function App() {
  const path = window.location.pathname;

  if (path.startsWith('/availability')) return <AvailabilityPage />;
  if (path.startsWith('/coverage')) return <CoveragePage />;
  if (path.startsWith('/confirm')) return <ConfirmPage />;
  return <AdminConsole />;
}
