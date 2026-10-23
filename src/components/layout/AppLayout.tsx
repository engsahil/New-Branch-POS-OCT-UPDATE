import { Suspense, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
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
 * The sidebar carries navigation, a slim header hosts the notification
 * centre, and each screen supplies its own heading via PageHeader.
 */
export function AppLayout() {
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
        <GlobalHeader />
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
