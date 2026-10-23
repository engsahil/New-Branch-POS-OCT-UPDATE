import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCES_EVENT,
  displayPreferencesService,
  type DisplayPreferences,
} from '@/services/displayPreferencesService';

/**
 * Current display preferences, kept in sync with the Settings screen.
 *
 * Defaults are shown immediately so a screen never flashes empty while the
 * stored value is read, and the window event lets an open screen react to a
 * change without polling.
 */
export function useDisplayPreferences(): DisplayPreferences {
  const [preferences, setPreferences] = useState<DisplayPreferences>(
    DEFAULT_DISPLAY_PREFERENCES,
  );

  const reload = useCallback(() => {
    void displayPreferencesService
      .get()
      .then(setPreferences)
      .catch(() => setPreferences(DEFAULT_DISPLAY_PREFERENCES));
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(DISPLAY_PREFERENCES_EVENT, reload);
    return () => window.removeEventListener(DISPLAY_PREFERENCES_EVENT, reload);
  }, [reload]);

  return preferences;
}
