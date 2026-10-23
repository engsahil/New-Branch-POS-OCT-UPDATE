import { useState } from 'react';
import { useAuth } from '@/app/AuthContext';
import { Button, Input } from '@/components/ui';
import { authService } from '@/services/authService';
import { onboardingService } from '@/services/onboardingService';
import {
  restaurantService,
  type RestaurantProfileInput,
} from '@/services/restaurantService';
import styles from './SetupWizard.module.css';

export interface SetupWizardProps {
  onFinish: () => void;
}

const TOTAL_STEPS = 5;

/**
 * First-run setup for a genuinely new installation only.
 *
 * Existing terminals bypass this entirely (onboardingService.needsSetup marks
 * them complete when a profile or order already exists), so no customer data
 * is touched and nothing is re-created. Every step writes through the same
 * services the Admin screens use.
 */
export function SetupWizard({ onFinish }: SetupWizardProps) {
  const { user, refresh } = useAuth();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [taxPercent, setTaxPercent] = useState('0');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function profileInput(extra: Partial<RestaurantProfileInput> = {}): RestaurantProfileInput {
    return {
      name: name.trim(),
      logo: null,
      banner: null,
      tagline: '',
      address: address.trim(),
      phone: phone.trim(),
      email: '',
      receiptInfo: '',
      receiptFooter: receiptFooter.trim(),
      taxPercent: Number(taxPercent) || 0,
      taxInclusive: false,
      ...extra,
    };
  }

  async function finish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Only write a profile when there is a name to write; otherwise the
      // dashboard reminds the operator and Settings stays the way in.
      if (name.trim()) await restaurantService.save(profileInput());
      await onboardingService.completeSetup();
      onFinish();
    } catch {
      setError('Setup could not be saved. Check the details and try again.');
    } finally {
      setBusy(false);
    }
  }

  /** Close the wizard without storing anything; Settings stays available. */
  async function later(): Promise<void> {
    setBusy(true);
    try {
      await onboardingService.completeSetup();
      onFinish();
    } catch {
      setError('Setup could not be closed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveRestaurant(): Promise<void> {
    if (!name.trim()) {
      setError('Enter the restaurant name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await restaurantService.save(profileInput());
      setStep(3);
    } catch {
      setError('The restaurant details could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(): Promise<void> {
    if (newPassword.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The password confirmation does not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await authService.changeCredentials({
        currentPassword,
        newPassword,
      });
      if (!result.ok) {
        setError(result.error ?? 'The password could not be changed.');
        return;
      }
      await refresh();
      setStep(5);
    } catch {
      setError('The password could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        <header className={styles.head}>
          <span className={styles.stepCount}>
            Step {step} of {TOTAL_STEPS}
          </span>
          <h1 className={styles.title} id="setup-title">
            {step === 1
              ? 'Set up this terminal'
              : step === 2
                ? 'Restaurant details'
                : step === 3
                  ? 'Tax and receipt'
                  : step === 4
                    ? 'Administrator access'
                    : 'Ready'}
          </h1>
        </header>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {step === 1 ? (
          <div className={styles.body}>
            <p className={styles.text}>
              This wizard configures a new installation: the restaurant profile
              and tax. You already created your administrator account, and an
              optional password change is offered at the end. Existing data is
              never changed, and the wizard does not open again once completed.
            </p>
            <ul className={styles.checklist}>
              <li>Restaurant name and contact details</li>
              <li>Tax rate and receipt footer</li>
              <li>Optional administrator password update</li>
            </ul>
          </div>
        ) : null}

        {step === 2 ? (
          <div className={styles.body}>
            <Input
              label="Restaurant name"
              name="setupName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              fullWidth
            />
            <Input
              label="Phone"
              name="setupPhone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              maxLength={30}
              fullWidth
            />
            <Input
              label="Address"
              name="setupAddress"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={200}
              fullWidth
            />
          </div>
        ) : null}

        {step === 3 ? (
          <div className={styles.body}>
            <Input
              label="Sales tax (%)"
              name="setupTax"
              value={taxPercent}
              onChange={(event) => {
                const next = event.target.value;
                if (next !== '' && !/^\d{0,3}(\.\d{0,2})?$/.test(next)) return;
                setTaxPercent(next);
              }}
              inputMode="decimal"
              hint="Enter 0 if the restaurant does not charge sales tax."
              fullWidth
            />
            <Input
              label="Receipt footer (optional)"
              name="setupFooter"
              value={receiptFooter}
              onChange={(event) => setReceiptFooter(event.target.value)}
              maxLength={120}
              hint="Printed at the end of a customer receipt. Leave empty for none."
              fullWidth
            />
          </div>
        ) : null}

        {step === 4 ? (
          <div className={styles.body}>
            <p className={styles.text}>
              You are already signed in, so a new password is optional. Set one
              now, or keep the current credentials and change them later under
              Settings, Security. Skipping does not weaken authentication: the
              terminal still requires a password at every sign-in.
            </p>
            <Input
              label="Current password"
              name="setupCurrent"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
              fullWidth
            />
            <Input
              label="New password"
              name="setupNew"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              hint="At least 8 characters."
              required
              fullWidth
            />
            <Input
              label="Confirm new password"
              name="setupConfirm"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
              fullWidth
            />
          </div>
        ) : null}

        {step === 5 ? (
          <div className={styles.body}>
            <p className={styles.text}>
              Setup is complete. Finish to open the dashboard; the guided tour
              starts on the first screen.
            </p>
            <dl className={styles.summary}>
              <div>
                <dt>Restaurant</dt>
                <dd>{name || 'Not set'}</dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>{Number(taxPercent) || 0}%</dd>
              </div>
              <div>
                <dt>Administrator</dt>
                <dd>{user?.username ?? 'admin'}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        <footer className={styles.footer}>
          <span className={styles.footerSpacer} />
          {step === 1 ? (
            <>
              <Button
                variant="ghost"
                onClick={() => void later()}
                disabled={busy}
              >
                Setup later
              </Button>
              <Button onClick={() => setStep(2)}>Continue</Button>
            </>
          ) : step === 2 ? (
            <>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => void saveRestaurant()} disabled={busy}>
                Save and continue
              </Button>
            </>
          ) : step === 3 ? (
            <>
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={() => setStep(4)}>Continue</Button>
            </>
          ) : step === 4 ? (
            <>
              <Button variant="ghost" onClick={() => setStep(3)} disabled={busy}>
                Back
              </Button>
              <Button
                variant="secondary"
                onClick={() => setStep(5)}
                disabled={busy}
              >
                Skip for now
              </Button>
              <Button onClick={() => void savePassword()} disabled={busy}>
                {busy ? 'Saving' : 'Set password and finish'}
              </Button>
            </>
          ) : (
            <Button onClick={() => void finish()} disabled={busy}>
              {busy ? 'Saving' : 'Finish setup'}
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}
