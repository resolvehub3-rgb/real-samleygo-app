import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  AuthShell,
  AuthAlert,
  FieldLabel,
  INPUT_CLASS,
  AUTH_SUBMIT_CLASS,
  AUTH_LINK_CLASS,
} from '../../components/auth/AuthShell';

export const ForgotPasswordPage: React.FC = () => {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');

    const { error } = await resetPassword(email);
    setIsSubmitting(false);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setSentSuccess(true);
    }
  };

  return (
    <AuthShell
      mode="reset"
      title="Reset your password"
      subtitle="Enter the email on your account and we'll send you a secure recovery link."
    >
      {errorMsg && <AuthAlert>{errorMsg}</AuthAlert>}

      {sentSuccess ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-900">
            <CheckCircle2 className="h-5 w-5 text-brand" aria-hidden="true" />
            <span>Recovery link sent</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-emerald-800">
            Check your inbox for <span className="font-semibold">{email}</span> to reset
            your SamleyGo password.
          </p>
          <Link to="/login" className={`${AUTH_LINK_CLASS} mt-3`}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="reset-email">Email address</FieldLabel>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="reset-email"
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

          <button type="submit" disabled={isSubmitting} className={AUTH_SUBMIT_CLASS}>
            {isSubmitting ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden="true"
                />
                <span>Sending link…</span>
              </>
            ) : (
              <>
                <span>Send recovery link</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>

          <p className="flex justify-center pt-1">
            <Link to="/login" className={AUTH_LINK_CLASS}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
};
