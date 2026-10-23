import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { ROUTE_PATHS } from '@/app/routes';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Input } from '@/components/ui';
import { CheckIcon, LockIcon, StoreIcon } from '@/components/ui/Icons';
import { authService } from '@/services/authService';
import { restaurantService } from '@/services/restaurantService';
import { formatDateTime } from '@/utils/date';
import type { AuthUser } from '@/types/auth';
import styles from './ProfilePage.module.css';

/**
 * Administrator profile.
 *
 * Shows the signed-in account and the details it actually stores. Name, email
 * and phone are editable and saved to the admin record; the password is never
 * read or displayed here and is changed through the existing Security form.
 */
export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [restaurantName, setRestaurantName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void restaurantService
      .getRecord()
      .then((profile) => setRestaurantName(profile?.name?.trim() ?? ''))
      .catch(() => setRestaurantName(''));
  }, []);

  useEffect(() => {
    const account: AuthUser | null = user;
    setDisplayName(account?.displayName ?? '');
    setEmail(account?.email ?? '');
    setPhone(account?.phone ?? '');
  }, [user]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const result = await authService.updateProfile({ displayName, email, phone });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? 'The profile could not be saved.');
      return;
    }
    await refresh();
    setStatus('Profile saved.');
    window.setTimeout(() => setStatus(null), 2500);
  }

  const initials = (user?.displayName?.trim() || user?.username || 'A')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="page">
      <PageHeader
        title="My profile"
        subtitle="The administrator account on this terminal."
      />

      <div className={styles.grid}>
        <section className={styles.card} aria-label="Account">
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {initials}
            </span>
            <div className={styles.identityText}>
              <h2 className={styles.name}>
                {user?.displayName?.trim() || 'Admin'}
              </h2>
              <p className={styles.role}>Administrator</p>
            </div>
          </div>

          <dl className={styles.details}>
            <div className={styles.row}>
              <dt>Username</dt>
              <dd>{user?.username ?? '-'}</dd>
            </div>
            <div className={styles.row}>
              <dt>Role</dt>
              <dd>Administrator (full access)</dd>
            </div>
            <div className={styles.row}>
              <dt>Email</dt>
              <dd>{user?.email?.trim() || 'Not set'}</dd>
            </div>
            <div className={styles.row}>
              <dt>Phone</dt>
              <dd>{user?.phone?.trim() || 'Not set'}</dd>
            </div>
            <div className={styles.row}>
              <dt>Last sign-in</dt>
              <dd>
                {user?.lastLoginAt
                  ? formatDateTime(user.lastLoginAt)
                  : 'This session'}
              </dd>
            </div>
            <div className={styles.row}>
              <dt>Restaurant</dt>
              <dd>{restaurantName || 'Not configured'}</dd>
            </div>
          </dl>

          <div className={styles.shortcuts}>
            <Button
              variant="secondary"
              leadingIcon={<LockIcon width={15} height={15} />}
              onClick={() => navigate(ROUTE_PATHS.admin)}
            >
              Change password
            </Button>
            <Button
              variant="ghost"
              leadingIcon={<StoreIcon width={15} height={15} />}
              onClick={() => navigate(ROUTE_PATHS.admin)}
            >
              Restaurant information
            </Button>
          </div>
        </section>

        <section className={styles.card} aria-label="Edit profile">
          <h2 className={styles.cardTitle}>Contact details</h2>
          <p className={styles.hint}>
            These details are shown on this page only. They are not used to sign
            in and can be left empty.
          </p>

          <form className={styles.form} onSubmit={(event) => void save(event)} noValidate>
            <Input
              label="Display name"
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={60}
              placeholder="Admin"
              autoComplete="name"
              disabled={saving}
              fullWidth
            />
            <Input
              label="Email"
              name="profileEmail"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={120}
              autoComplete="email"
              disabled={saving}
              fullWidth
            />
            <Input
              label="Phone"
              name="profilePhone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              maxLength={30}
              autoComplete="tel"
              disabled={saving}
              fullWidth
            />

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            <div className={styles.actions}>
              {status ? (
                <span className={styles.saved} aria-live="polite">
                  <CheckIcon width={14} height={14} /> {status}
                </span>
              ) : null}
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving' : 'Save profile'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
