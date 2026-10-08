import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isSupabaseConfigured } from '../../lib/supabase';
import { landingPathFor } from '../../lib/roleRoutes';
import { SupabaseConnectModal } from '../../components/common/SupabaseConnectModal';
import {
  AuthShell,
  AuthAlert,
  FieldLabel,
  INPUT_CLASS,
  INPUT_ACTION_CLASS,
  AUTH_SUBMIT_CLASS,
  AUTH_LINK_CLASS,
} from '../../components/auth/AuthShell';

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
      mode="login"
      title="Welcome back"
      subtitle="Sign in to access your SamleyGo account."
    >
      {errorMsg && <AuthAlert>{errorMsg}</AuthAlert>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="login-email">Email address</FieldLabel>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="login-email"
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
            htmlFor="login-password"
            hint={
              <Link to="/forgot-password" className={AUTH_LINK_CLASS}>
                Forgot password?
              </Link>
            }
          >
            Password
          </FieldLabel>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="login-password"
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
              aria-pressed={showPassword}
              className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <button type="submit" disabled={isSubmitting} className={AUTH_SUBMIT_CLASS}>
          {isSubmitting ? (
            <>
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              <span>Signing in…</span>
            </>
          ) : (
            <>
              <span>Sign in to SamleyGo</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <SupabaseConnectModal isOpen={showDbModal} onClose={() => setShowDbModal(false)} />
    </AuthShell>
  );
};
