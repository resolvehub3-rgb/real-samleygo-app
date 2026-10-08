import React, { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';

/**
 * Shared chrome for the sign-in, sign-up and password-recovery screens.
 *
 * Layout contract:
 *  - one compact application header: the SamleyGo logo plus the single
 *    alternate action for that screen ("Join" on sign-in, "Sign In" on
 *    sign-up) — never both at once, so the header never competes with the
 *    form's primary button;
 *  - one centred white card holding the title, form and page footer. The form
 *    is the visual priority on every width, from 320px phones to desktop;
 *  - a restrained SamleyGo-green canvas (brand-deep) with a faint grid and a
 *    single soft radial so the card reads as the interactive layer without
 *    gradients, glow or animated decoration competing for attention.
 *
 * The site header and the signed-in bottom tab bar are suppressed on these
 * routes (see `isAuthPath`), so authentication feels like its own screen
 * rather than a page inside the customer shell.
 */

export type AuthMode = 'login' | 'register' | 'reset';

/** The one alternate action shown in the header for each mode. */
const HEADER_ACTION: Record<AuthMode, { to: string; label: string } | null> = {
  login: { to: '/register', label: 'Join' },
  register: { to: '/login', label: 'Sign In' },
  reset: null,
};

interface AuthShellProps {
  mode: AuthMode;
  /** Page heading — the single h1 on the screen. */
  title: string;
  /** One supporting sentence under the heading. */
  subtitle: string;
  children: ReactNode;
}

/** Faint grid + one soft radial. Deliberately static and low contrast. */
const AuthBackdrop: React.FC = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
    <div
      className="absolute inset-0 opacity-[0.055]"
      style={{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }}
    />
    <div className="absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(ellipse_at_50%_-10%,rgba(5,150,105,0.28),transparent_65%)]" />
  </div>
);

export const AuthShell: React.FC<AuthShellProps> = ({
  mode,
  title,
  subtitle,
  children,
}) => {
  const action = HEADER_ACTION[mode];

  return (
    <div className="relative flex min-h-screen flex-col bg-brand-deep text-white">
      <AuthBackdrop />

      {/* ── Compact application header ─────────────────────────────── */}
      {/* Pinned on phones so the logo and the single alternate action stay
          reachable while the long sign-up form scrolls under it; from `sm` up
          it is an ordinary bar that scrolls away with the page. The solid
          canvas is applied only where it pins, so the header never masks the
          backdrop on wide screens, and `pt-safe` keeps it clear of the status
          bar on notched devices (viewport-fit=cover). */}
      <header className="sticky top-0 z-20 border-b border-white/10 pt-safe max-sm:bg-brand-deep sm:relative">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="flex h-11 items-center gap-2.5"
            aria-label="SamleyGo home"
          >
            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-white/15 shadow-sm">
              <img src="/logo-mark.png" alt="" className="h-full w-full object-cover" />
            </span>
            <span className="text-lg font-extrabold leading-none tracking-tight text-white sm:text-xl">
              Samley<span className="text-accent">Go</span>
            </span>
          </Link>

          {action && (
            <Link
              to={action.to}
              className="inline-flex h-10 items-center rounded-xl bg-white px-4 text-sm font-bold text-brand-deep shadow-sm transition hover:bg-emerald-50 active:scale-[0.98]"
            >
              {action.label}
            </Link>
          )}
        </div>
      </header>

      {/* ── Form card ──────────────────────────────────────────────── */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-26px_rgba(2,71,45,0.55)] sm:p-8 animate-sg-in">
          <div className="mb-6">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              {title}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{subtitle}</p>
          </div>

          {children}
        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="relative z-10 px-4 pb-6 text-center sm:pb-8">
        <p className="text-[11px] font-medium text-emerald-100/70">
          SamleyGo Ghana · Fast, reliable delivery
        </p>
        <nav
          aria-label="Legal and support"
          className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] font-semibold text-emerald-100/70"
        >
          {['Terms', 'Privacy', 'Support'].map((item) => (
            <Link
              key={item}
              to={`/${item.toLowerCase()}`}
              className="inline-flex min-h-6 items-center px-1 transition hover:text-white"
            >
              {item}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
};

/** Form-level error banner — one implementation shared by all auth screens. */
export const AuthAlert: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div
    role="alert"
    className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-semibold leading-relaxed text-rose-700"
  >
    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />
    <span>{children}</span>
  </div>
);

/** Field chrome: a real `<label>` wired to its input, with an optional hint. */
export const FieldLabel: React.FC<{
  children: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
}> = ({ children, htmlFor, hint }) => (
  <div className="mb-1.5 flex items-center justify-between gap-3">
    <label htmlFor={htmlFor} className="block text-xs font-bold text-slate-700">
      {children}
    </label>
    {hint}
  </div>
);

/** One field height (48px) and one focus treatment across every auth input. */
const INPUT_BASE =
  'h-12 w-full rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-900 placeholder-slate-400 transition focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60';

/** Input with a leading icon. */
export const INPUT_CLASS = `${INPUT_BASE} pl-11 pr-4`;

/** Input with a leading icon and a trailing in-field action (eye toggle). */
export const INPUT_ACTION_CLASS = `${INPUT_BASE} pl-11 pr-12`;

/** Input without a leading icon (select, prefixed phone field). */
export const INPUT_PLAIN_CLASS = `${INPUT_BASE} px-3.5`;

/** Primary auth CTA — normal, hover, pressed, disabled and loading states. */
export const AUTH_SUBMIT_CLASS =
  'flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60';

/** Text link used inside auth cards (hints, back navigation). Sized to clear
 *  the 24px WCAG target minimum without disturbing the row it sits in. */
export const AUTH_LINK_CLASS =
  'inline-flex min-h-6 items-center px-1 text-xs font-bold text-brand transition hover:text-brand-dark hover:underline';
