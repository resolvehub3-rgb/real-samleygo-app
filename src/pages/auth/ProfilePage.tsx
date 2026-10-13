import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Bike,
  ChefHat,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  LogOut,
  Mail,
  Package,
  Phone,
  Receipt,
  Settings,
  ShieldCheck,
  User,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PWAInstallButton } from '../../components/common/PWAInstallButton';
import { SubmittedDocsModal } from '../../components/courier/SubmittedDocsModal';
import { UserAvatar } from '../../components/common/UserAvatar';
import { ProfilePhotoUploader } from '../../components/common/ProfilePhotoUploader';
import type { UserRole } from '../../types/database';

/** How each role reads on the account chip (never raw enum values). */
const ROLE_LABEL: Record<UserRole, string> = {
  CUSTOMER: 'Customer',
  COURIER: 'Courier',
  RESTAURANT_OWNER: 'Restaurant',
  SUPER_ADMIN: 'Administrator',
};

type Shortcut = {
  /** Internal route the row opens. Mutually exclusive with `action`. */
  to?: string;
  /** Row that opens a modal instead of navigating. */
  action?: 'courier-documents';
  label: string;
  hint: string;
  icon: LucideIcon;
};

/** One list of account shortcuts per role — no per-role JSX branches below. */
const SHORTCUTS: Record<UserRole, Shortcut[]> = {
  CUSTOMER: [
    { to: '/orders', label: 'Orders', hint: 'Track deliveries and review past orders.', icon: Receipt },
    { to: '/errands', label: 'Errands', hint: 'Send a package with a nearby rider.', icon: Package },
  ],
  COURIER: [
    { to: '/courier/dashboard', label: 'Dashboard', hint: 'Go online and accept delivery jobs.', icon: Bike },
    { to: '/courier/earnings', label: 'Earnings', hint: 'Payouts for completed deliveries.', icon: Wallet },
    {
      action: 'courier-documents',
      label: 'Verification documents',
      hint: 'Review the ID and vehicle files you submitted.',
      icon: FileText,
    },
  ],
  RESTAURANT_OWNER: [
    { to: '/restaurant/dashboard', label: 'Orders', hint: 'Incoming orders and cooking status.', icon: Receipt },
    { to: '/restaurant/menu', label: 'Menu', hint: 'Dishes, prices and availability.', icon: ChefHat },
    { to: '/restaurant/addons', label: 'Add-ons', hint: 'Extras, combos and selection limits.', icon: ChefHat },
    { to: '/restaurant/settings', label: 'Settings', hint: 'Opening hours, photos and address.', icon: Settings },
  ],
  SUPER_ADMIN: [
    { to: '/admin/dashboard', label: 'Admin console', hint: 'Users, vendors, riders and platform health.', icon: ShieldCheck },
  ],
};

/** Shared field chrome — text colour is added per field so it never conflicts. */
const inputBaseClassName =
  'w-full pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition';

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

/** Card with a titled header — every block on this page uses it. */
const Section: React.FC<SectionProps> = ({ title, description, children }) => (
  <section className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
    <div className="px-5 sm:px-6 py-4 border-b border-slate-100">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
    </div>
    <div className="px-5 sm:px-6 py-5">{children}</div>
  </section>
);

export const ProfilePage: React.FC = () => {
  const { user, profile, role, signOut, updateProfile } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showDocsModal, setShowDocsModal] = useState(false);
  // Committed locally right after an upload so the new photo shows instantly,
  // before refreshProfile() round-trips back with the updated row.
  const [photoOverride, setPhotoOverride] = useState<string | null>(null);
  const photoUrl = photoOverride ?? profile?.avatar_url ?? null;

  // The profile row is fetched from Supabase and can land after first paint.
  // Re-seed the fields only when a (different) row arrives, never while the
  // user is typing.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name || '');
    setPhone(profile.phone || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  if (!user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center border border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">Sign in required</h2>
          <p className="mt-2 text-xs text-slate-500">
            Sign in to view and edit your profile.
          </p>
          <Link
            to="/login?redirect=/profile"
            className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-5 text-xs font-bold text-white transition hover:bg-brand-dark"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  const trimmedName = fullName.trim();
  const trimmedPhone = phone.trim();
  const isDirty =
    trimmedName !== (profile?.full_name || '') || trimmedPhone !== (profile?.phone || '');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName) {
      setFormError('Enter your full name.');
      setSaveState('error');
      return;
    }

    setSaveState('saving');
    setFormError(null);

    const { error } = await updateProfile({
      full_name: trimmedName,
      phone: trimmedPhone,
    });

    if (error) {
      setSaveState('error');
      setFormError('We could not save your changes. Check your connection and try again.');
      return;
    }

    setFullName(trimmedName);
    setPhone(trimmedPhone);
    setSaveState('saved');
    window.setTimeout(
      () => setSaveState((current) => (current === 'saved' ? 'idle' : current)),
      3000
    );
  };

  const handleDiscard = () => {
    setFullName(profile?.full_name || '');
    setPhone(profile?.phone || '');
    setFormError(null);
    setSaveState('idle');
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut();
    navigate('/');
  };

  const shortcuts = SHORTCUTS[role] ?? SHORTCUTS.CUSTOMER;

  return (
    <div className="min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12 bg-canvas">
      <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Profile</h1>
          <p className="text-sm text-slate-500">
            Manage your personal information and account access.
          </p>
        </header>

        {/* Identity */}
        <section className="bg-white rounded-3xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-4">
            <UserAvatar
              src={photoUrl}
              name={profile?.full_name}
              sizeClassName="w-16 h-16"
              shapeClassName="rounded-2xl"
              className="shadow-md"
            />
            <div className="min-w-0">
              <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md">
                {ROLE_LABEL[role] ?? ROLE_LABEL.CUSTOMER}
              </span>
              <h2 className="text-lg font-bold text-slate-900 mt-1.5 truncate">
                {profile?.full_name || 'Set up your profile'}
              </h2>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
          </div>

          {/* The courier photo is shown live to customers and restaurants on
              every active delivery; everyone else sees it next to their name. */}
          <div className="border-t border-slate-100 pt-5">
            <span className="block text-xs font-bold text-slate-700 mb-3">Profile photo</span>
            <ProfilePhotoUploader
              userId={user.id}
              name={profile?.full_name || fullName}
              photoUrl={photoUrl}
              onUploaded={async (url) => {
                setPhotoOverride(url);
                // The uploader shows its own confirmation copy; just persist
                // the new URL so every screen picks it up in realtime.
                await updateProfile({ avatar_url: url });
              }}
              hint={
                role === 'COURIER'
                  ? 'Customers and restaurants see this photo while you are on a delivery.'
                  : 'JPG, PNG or WebP · shown next to your name across the app.'
              }
            />
          </div>
        </section>

        {/* Personal details */}
        <Section
          title="Personal information"
          description="Used for order updates and delivery contact."
        >
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label
                htmlFor="profile-full-name"
                className="block text-xs font-bold text-slate-700 mb-1.5"
              >
                Full name
              </label>
              <div className="relative">
                <User
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="profile-full-name"
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (saveState === 'error') setSaveState('idle');
                  }}
                  className={`${inputBaseClassName} text-slate-900`}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="profile-phone"
                className="block text-xs font-bold text-slate-700 mb-1.5"
              >
                Phone number
              </label>
              <div className="relative">
                <Phone
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="profile-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="024 123 4567"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (saveState === 'error') setSaveState('idle');
                  }}
                  className={`${inputBaseClassName} text-slate-900`}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Ghanaian mobile number, including the network prefix.
              </p>
            </div>

            <div>
              <label
                htmlFor="profile-email"
                className="block text-xs font-bold text-slate-700 mb-1.5"
              >
                Email
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="profile-email"
                  type="email"
                  readOnly
                  value={user.email ?? ''}
                  className={`${inputBaseClassName} text-slate-500 cursor-not-allowed`}
                  aria-describedby="profile-email-hint"
                />
              </div>
              <p id="profile-email-hint" className="mt-1.5 text-[11px] text-slate-500">
                Your sign-in address.{' '}
                <Link to="/support" className="font-semibold text-emerald-700 hover:underline">
                  Contact support
                </Link>{' '}
                to change it.
              </p>
            </div>

            {/* Legal & policies — the documents that govern this account */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
              <p className="text-xs font-bold text-slate-700">Legal &amp; policies</p>
              <p className="text-[11px] text-slate-500">
                The terms and privacy information that apply to your account.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                <Link
                  to="/terms"
                  className="inline-flex min-h-6 items-center text-xs font-semibold text-emerald-700 underline-offset-4 hover:underline"
                >
                  Terms of Service
                </Link>
                <Link
                  to="/privacy"
                  className="inline-flex min-h-6 items-center text-xs font-semibold text-emerald-700 underline-offset-4 hover:underline"
                >
                  Privacy Policy
                </Link>
                <Link
                  to="/support"
                  className="inline-flex min-h-6 items-center text-xs font-semibold text-emerald-700 underline-offset-4 hover:underline"
                >
                  Help &amp; Support
                </Link>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between pt-1">
              <div aria-live="polite" className="text-xs font-semibold">
                {saveState === 'saved' && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600">
                    <Check className="w-4 h-4" aria-hidden="true" />
                    Profile updated.
                  </span>
                )}
                {saveState === 'error' && formError && (
                  <span className="inline-flex items-start gap-1.5 text-rose-600">
                    <AlertCircle className="w-4 h-4 mt-px flex-shrink-0" aria-hidden="true" />
                    {formError}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 sm:justify-end">
                {isDirty && (
                  <button
                    type="button"
                    onClick={handleDiscard}
                    className="h-11 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
                  >
                    Discard
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saveState === 'saving' || !isDirty}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {saveState === 'saving' && (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  )}
                  {saveState === 'saving' ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </form>
        </Section>

        {/* Role shortcuts */}
        <Section title="Account" description="Open the parts of SamleyGo built for your role.">
          <ul className="space-y-2">
            {shortcuts.map((item) => {
              const Icon = item.icon;
              const rowClassName =
                'flex w-full items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 transition text-left';

              const content = (
                <>
                  <span className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-slate-800">{item.label}</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">
                      {item.hint}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
                </>
              );

              return (
                <li key={item.label}>
                  {item.to ? (
                    <Link to={item.to} className={rowClassName}>
                      {content}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => setShowDocsModal(true)} className={rowClassName}>
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>

        {/* App */}
        <Section title="App" description="Add SamleyGo to this device.">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800">Install the app</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Opens in its own window, without the browser bar.
              </p>
            </div>
            <PWAInstallButton compact />
          </div>
        </Section>

        {/* Submitted verification documents (couriers) */}
        {role === 'COURIER' && (
          <SubmittedDocsModal
            isOpen={showDocsModal}
            onClose={() => setShowDocsModal(false)}
            courierId={user.id}
          />
        )}

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-xs font-bold transition disabled:opacity-60"
        >
          {isSigningOut ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="w-4 h-4" aria-hidden="true" />
          )}
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
};
