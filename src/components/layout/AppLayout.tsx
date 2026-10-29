import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ROUTE_PATHS } from '@/app/routes';
import { AppTour } from '@/components/onboarding/AppTour';
import { SetupWizard } from '@/components/onboarding/SetupWizard';
import { onboardingService } from '@/services/onboardingService';
import { GlobalHeader } from './GlobalHeader';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { OfflineBanner } from './OfflineBanner';
import { SyncIndicator } from './SyncIndicator';
import { Spinner } from '@/components/ui';
import styles from './AppLayout.module.css';

/**
 * Application shell.
 *
 * The sidebar carries navigation; the dashboard alone hosts the identity,
 * notification centre and account header. Screens supply their own headings.
 */
export function AppLayout() {
  const { pathname } = useLocation();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  /*
   * A new installation is offered the setup wizard once. Existing terminals
   * are recognised from their saved profile or orders and skip it entirely.
   */
  useEffect(() => {
    let active = true;
    void onboardingService
      .needsSetup()
      .then((required) => {
        if (active) setNeedsSetup(required);
      })
      .catch(() => {
        if (active) setNeedsSetup(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={styles.shell}>
      <Sidebar />

      <div className={styles.body}>
        {pathname === ROUTE_PATHS.dashboard ? <GlobalHeader /> : null}
        <OfflineBanner />
        {/* Renders nothing unless a sync backend is configured. */}
        <div className={styles.syncSlot} data-print-hide>
          <SyncIndicator />
        </div>
        <main className={styles.main} id="main-content">
          <Suspense fallback={<Spinner fullscreen label="Loading section" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <TabBar />

      {needsSetup ? (
        <SetupWizard onFinish={() => setNeedsSetup(false)} />
      ) : needsSetup === false ? (
        <AppTour />
      ) : null}
    </div>
  );
}
