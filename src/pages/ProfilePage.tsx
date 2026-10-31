import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { ROUTE_PATHS } from '@/app/routes';
import { ImageField } from '@/components/admin/ImageField';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Input, Textarea } from '@/components/ui';
import { CheckIcon, LockIcon, StoreIcon } from '@/components/ui/Icons';
import { useRestaurantBranding } from '@/hooks/useRestaurantBranding';
import { authService } from '@/services/authService';
import type { StoredImage } from '@/types/domain';
import { formatDateTime } from '@/utils/date';
import styles from './ProfilePage.module.css';

interface ProfileForm {
  displayName: string; email: string; phone: string; jobTitle: string;
  department: string; address: string; bio: string; avatar: StoredImage | null;
}
const EMPTY: ProfileForm = { displayName: '', email: '', phone: '', jobTitle: '', department: '', address: '', bio: '', avatar: null };

/** Local administrator profile. Credentials and permissions stay in Security. */
export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const restaurant = useRestaurantBranding();
  const [values, setValues] = useState<ProfileForm>(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState<string | null>(null);
  useEffect(() => {
    setValues({ displayName: user?.displayName ?? '', email: user?.email ?? '', phone: user?.phone ?? '',
      jobTitle: user?.jobTitle ?? '', department: user?.department ?? '', address: user?.address ?? '',
      bio: user?.bio ?? '', avatar: user?.avatar ?? null });
  }, [user]);
  function set<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setValues((prev) => ({ ...prev, [key]: value })); setStatus(null); setError(null);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(null); setStatus(null);
    if (!values.displayName.trim()) { setError('Full name is required.'); return; }
    setSaving(true);
    try {
      const result = await authService.updateProfile(values);
      if (!result.ok) { setError(result.error ?? 'The profile could not be saved.'); return; }
      await refresh(); setStatus('Profile saved on this device.');
    } catch { setError('The profile could not be saved. Please try again.'); }
    finally { setSaving(false); }
  }
  const initials = (values.displayName.trim() || user?.username || 'A').slice(0, 2).toUpperCase();
  const avatar = values.avatar?.dataUrl;
  return (
    <div className="page">
      <PageHeader title="My profile" subtitle="Your local administrator profile. Sign-in and permissions are unchanged." />
      <form className={styles.grid} onSubmit={(event) => void save(event)} noValidate aria-label="Edit profile">
        <section className={styles.card} aria-label="Profile picture and account">
          <div className={styles.identity}>
            <span className={styles.avatar}>
              {avatar && avatarFailed !== avatar ? <img src={avatar} alt={`${values.displayName || user?.username || 'Administrator'} profile picture`} onError={() => setAvatarFailed(avatar)} /> : initials}
            </span>
            <div className={styles.identityText}><h2 className={styles.name}>{values.displayName.trim() || 'Administrator'}</h2><p className={styles.role}>{values.jobTitle.trim() || 'Administrator'}</p></div>
          </div>
          <ImageField label="Profile picture" value={values.avatar} onChange={(image) => set('avatar', image)} disabled={saving}
            idPrefix="profile-picture" maxEdge={256} aspect={1} uploadLabel="Upload picture" removeLabel="Remove picture"
            acceptedTypes={['image/png', 'image/jpeg', 'image/webp']} emptyHint="PNG, JPG or WebP. Cropped to a square and optimised locally." />
          <dl className={styles.details}>
            <div className={styles.row}><dt>Username</dt><dd>{user?.username ?? '—'}</dd></div>
            <div className={styles.row}><dt>Role</dt><dd>Administrator (full access)</dd></div>
            <div className={styles.row}><dt>Business</dt><dd>{restaurant?.name || 'Not configured'}</dd></div>
            <div className={styles.row}><dt>Last sign-in</dt><dd>{user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'This session'}</dd></div>
          </dl>
          <p className={styles.hint}>Username and business name are managed separately to protect sign-in and restaurant settings. Profile details are local to this terminal and are not included in business backups.</p>
          <div className={styles.shortcuts}>
            <Button variant="secondary" leadingIcon={<LockIcon width={15} height={15} />} onClick={() => navigate(ROUTE_PATHS.admin, { state: { section: 'security' } })}>Change username / password</Button>
            <Button variant="ghost" leadingIcon={<StoreIcon width={15} height={15} />} onClick={() => navigate(ROUTE_PATHS.admin, { state: { section: 'restaurant' } })}>Business settings</Button>
          </div>
        </section>
        <section className={styles.card} aria-label="Personal information">
          <div><h2 className={styles.cardTitle}>Personal information</h2><p className={styles.hint}>Only full name is required. Contact details are optional and shown only in your local profile.</p></div>
          <div className={styles.fields}>
            <Input label="Full name *" name="displayName" value={values.displayName} onChange={(event) => set('displayName', event.target.value)} maxLength={60} required autoComplete="name" disabled={saving} fullWidth />
            <Input label="Email address" name="profileEmail" type="email" value={values.email} onChange={(event) => set('email', event.target.value)} maxLength={120} autoComplete="email" disabled={saving} fullWidth />
            <Input label="Phone number" name="profilePhone" type="tel" value={values.phone} onChange={(event) => set('phone', event.target.value)} maxLength={30} autoComplete="tel" disabled={saving} fullWidth />
            <Input label="Designation / job title" name="jobTitle" value={values.jobTitle} onChange={(event) => set('jobTitle', event.target.value)} maxLength={80} autoComplete="organization-title" disabled={saving} fullWidth />
            <Input label="Department" name="department" value={values.department} onChange={(event) => set('department', event.target.value)} maxLength={80} disabled={saving} fullWidth />
            <Textarea label="Address" name="profileAddress" value={values.address} onChange={(event) => set('address', event.target.value)} maxLength={240} rows={2} autoComplete="street-address" disabled={saving} fullWidth />
            <Textarea label="Short bio / about me" name="bio" value={values.bio} onChange={(event) => set('bio', event.target.value)} maxLength={400} rows={3} hint={`${values.bio.length}/400 characters`} disabled={saving} fullWidth />
          </div>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <div className={styles.actions}>
            {status ? <span className={styles.saved} role="status"><CheckIcon width={14} height={14} />{status}</span> : null}
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </section>
      </form>
    </div>
  );
}
