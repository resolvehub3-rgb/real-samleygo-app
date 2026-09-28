import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  MapPin,
  UtensilsCrossed,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isSupabaseConfigured } from '../../lib/supabase';
import { SupabaseConnectModal } from '../../components/common/SupabaseConnectModal';
import {
  AuthShell,
  AuthTabs,
  FieldLabel,
  INPUT_CLASS,
  INPUT_ACTION_CLASS,
} from '../../components/auth/AuthShell';

/**
 * Where a freshly signed-in user lands. An explicit `?redirect=` target always
 * wins (the visitor was sent to /login to reach that specific page); otherwise
 * each role goes to its own workspace — a super admin must never be dropped on
 * the customer storefront after signing in.
 */
const landingPathFor = (role: string | undefined, redirect: string): string => {
  if (redirect && redirect !== '/') return redirect;
  switch (role) {
    case 'SUPER_ADMIN':
      return '/admin/dashboard';
    case 'COURIER':
      return '/courier/dashboard';
    case 'RESTAURANT_OWNER':
      return '/restaurant/dashboard';
    default:
      return '/';
  }
};

const LOGIN_FEATURES = [
  {
    icon: UtensilsCrossed,
    title: 'Meals from your favourites',
    detail: 'Order from hundreds of kitchens across Accra, Kumasi and beyond.',
  },
  {
    icon: MapPin,
    title: 'Track every delivery live',
    detail: 'Watch your courier move from the kitchen to your doorstep in real time.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure, encrypted sign-in',
    detail: 'Your session is protected by Supabase auth on every device you use.',
  },
];

export const LoginPage: React.FC = () => {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showDbModal, setShowDbModal] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setShowDbModal(true);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    // try/finally: if the auth call rejects (offline, blocked request, server
    // error) the button must still return to its idle state, otherwise the
    // form stays stuck on "Signing in…" forever.
    try {
      const { error, role: signedInRole } = await signIn(email, password);

      if (error) {
        setErrorMsg(error.message);
      } else {
        navigate(landingPathFor(signedInRole, redirect));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Welcome back"
      headline={
        <>
          Sign in and let
          <br />
          SamleyGo carry
          <br />
          the rest<span className="text-orange-400">.</span>
        </>
      }
      description="Meals, packages and kitchen orders — pick up exactly where you left off."
      features={LOGIN_FEATURES}
      mobileBrand="Sign in"
      cardTitle="Welcome back"
      cardSubtitle="Sign in to access meals, track orders, or manage deliveries"
    >
      <AuthTabs active="login" />

      {errorMsg && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-semibold text-rose-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <FieldLabel>Email address</FieldLabel>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              placeholder="you@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div>
          <FieldLabel
            hint={
              <Link
                to="/forgot-password"
                className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 hover:underline"
              >
                Forgot password?
              </Link>
            }
          >
            Password
          </FieldLabel>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_ACTION_CLASS}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-emerald-600/25 transition hover:from-emerald-700 hover:to-emerald-600 active:scale-[0.98] disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              <span>Signing you in…</span>
            </>
          ) : (
            <>
              <span>Sign in to SamleyGo</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="mt-5 border-t border-slate-100 pt-4 text-center">
        <p className="text-xs text-slate-500">
          New to SamleyGo?{' '}
          <Link
            to="/register"
            className="font-extrabold text-emerald-600 hover:text-emerald-700 hover:underline"
          >
            Create a free account
          </Link>
        </p>
        <p className="mt-3 text-[11px] text-slate-400">
          SamleyGo Ghana · Fast &amp; reliable delivery
        </p>
      </div>

      <SupabaseConnectModal isOpen={showDbModal} onClose={() => setShowDbModal(false)} />
    </AuthShell>
  );
};
