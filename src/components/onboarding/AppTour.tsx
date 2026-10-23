import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/AuthContext';
import { Button } from '@/components/ui';
import { onboardingService, TOUR_STEPS } from '@/services/onboardingService';
import styles from './AppTour.module.css';

interface Position {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 300;
const GAP = 14;

/**
 * One focused contextual guide, anchored to the real navigation controls.
 *
 * Only one step is visible at a time; the page stays interactive because the
 * backdrop ignores pointer events. Completion is stored per user, and the
 * tour can be replayed from Admin → Settings.
 */
export function AppTour() {
  const { user, status } = useAuth();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [position, setPosition] = useState<Position | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const username = user?.username ?? 'admin';

  const measure = useCallback((stepIndex: number) => {
    const target = TOUR_STEPS[stepIndex]?.target;
    if (!target) return;
    const element = document.querySelector<HTMLElement>(
      `[data-tour="${target}"]`,
    );
    if (!element) {
      setPosition(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      setPosition(null);
      return;
    }
    setPosition({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  /* Start on the first authenticated load when the user has not finished. */
  useEffect(() => {
    if (status !== 'authenticated') return;
    let activeFlag = true;

    void onboardingService
      .isTourCompleted(username)
      .then((completed) => {
        if (!activeFlag || completed) return;
        window.setTimeout(() => {
          if (activeFlag) {
            setIndex(0);
            setActive(true);
          }
        }, 800);
      })
      .catch(() => {
        /* never let onboarding block the application */
      });

    const restart = () => {
      setIndex(0);
      setActive(true);
    };
    window.addEventListener('pos:start-tour', restart);

    return () => {
      activeFlag = false;
      window.removeEventListener('pos:start-tour', restart);
    };
  }, [status, username]);

  useLayoutEffect(() => {
    if (!active) return;
    measure(index);

    const onResize = () => measure(index);
    window.addEventListener('resize', onResize);
    const timer = window.setTimeout(() => measure(index), 260);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
    };
  }, [active, index, measure]);

  const close = useCallback(() => {
    setActive(false);
    void onboardingService.completeTour(username).catch(() => {
      /* completion is best effort; the tour still closes */
    });
  }, [username]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowRight') {
        setIndex((value) => Math.min(TOUR_STEPS.length - 1, value + 1));
      }
      if (event.key === 'ArrowLeft') {
        setIndex((value) => Math.max(0, value - 1));
      }
    };
    document.addEventListener('keydown', onKey);
    cardRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [active, close]);

  if (!active) return null;

  const step = TOUR_STEPS[index];
  if (!step) return null;

  const isLast = index === TOUR_STEPS.length - 1;
  const cardTop = position
    ? Math.min(
        Math.max(GAP, position.top),
        window.innerHeight - 210,
      )
    : window.innerHeight / 2 - 90;
  const cardLeft = position
    ? Math.min(
        position.left + position.width + GAP,
        window.innerWidth - CARD_WIDTH - GAP,
      )
    : (window.innerWidth - CARD_WIDTH) / 2;

  return (
    <>
      {position ? (
        <div
          className={styles.ring}
          style={{
            top: position.top - 3,
            left: position.left - 3,
            width: position.width + 6,
            height: position.height + 6,
          }}
          aria-hidden="true"
        />
      ) : null}

      <div
        className={styles.card}
        style={{ top: cardTop, left: Math.max(GAP, cardLeft) }}
        role="dialog"
        aria-label={`Guided tour: ${step.title}`}
        tabIndex={-1}
        ref={cardRef}
      >
        <span className={styles.count}>
          {index + 1} / {TOUR_STEPS.length}
        </span>
        <h2 className={styles.title}>{step.title}</h2>
        <p className={styles.body}>{step.body}</p>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={close}>
            Skip tour
          </Button>
          <span className={styles.spacer} />
          <Button
            variant="secondary"
            size="sm"
            disabled={index === 0}
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
          >
            Back
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (isLast) close();
              else setIndex((value) => value + 1);
            }}
          >
            {isLast ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </>
  );
}
