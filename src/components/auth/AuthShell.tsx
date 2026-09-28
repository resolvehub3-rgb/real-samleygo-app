import React, { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, type LucideIcon } from 'lucide-react';

/**
 * Shared chrome for the sign-in and sign-up screens.
 *
 * Layout contract:
 *  - `lg` and up: a true split screen — the brand/story column sits on the left
 *    and the white form card sits on the right, both inside one max-width grid.
 *  - below `lg`: the story column collapses to a compact header above the same
 *    card, so the form stays the primary focus on phones.
 *
 * The whole page is painted on one dark emerald canvas with soft blurred blobs
 * (see `AuthBackdrop`) so the white card always reads as the interactive layer.
 * The fixed mobile tab bar is `h-16`, so the shell reserves `pb-24` on phones
 * to keep the footer clear of it.
 */

export interface AuthFeature {
  icon: LucideIcon;
  title: string;
  detail: string;
}

interface AuthShellProps {
  /** Small badge above the headline, e.g. "Welcome back". */
  eyebrow: string;
  headline: ReactNode;
  description: string;
  features: AuthFeature[];
  /** Compact label shown on phones above the card (keeps the brand visible). */
  mobileBrand: string;
  cardTitle: string;
  cardSubtitle: string;
  children: ReactNode;
}

/** Blurred colour blobs + faint grid that sit behind both columns. */
const AuthBackdrop: React.FC = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
    <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-emerald-500/25 blur-3xl animate-blob" />
    <div className="absolute -right-32 top-1/3 h-[26rem] w-[26rem] rounded-full bg-teal-500/20 blur-3xl animate-blob [animation-delay:-8s]" />
    <div className="absolute bottom-0 left-1/4 h-[22rem] w-[22rem] rounded-full bg-orange-500/10 blur-3xl animate-blob [animation-delay:-16s]" />
    <div
      className="absolute inset-0 opacity-[0.07]"
      style={{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
        backgroundSize: '44px 44px',
        maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 78%)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 78%)',
      }}
    />
  </div>
);

export const AuthShell: React.FC<AuthShellProps> = ({
  eyebrow,
  headline,
  description,
  features,
  mobileBrand,
  cardTitle,
  cardSubtitle,
  children,
}) => (
  <div className="relative min-h-[calc(100vh-4rem)] bg-[#04140e] text-white overflow-hidden">
    <AuthBackdrop />

    {/* The grid carries the viewport min-height (not just the outer wrapper)
        so both columns stretch full height and centre their content. */}
    <div className="relative mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl grid-cols-1 gap-8 px-4 pb-24 pt-6 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:px-8 lg:pb-16 lg:pt-12">
      {/* ── Left · brand / story column ─────────────────────────────── */}
      <div className="flex flex-col justify-center animate-fade-up">
        {/* Top bar: back link + live badge (only on the story column) */}
        <div className="mb-8 flex items-center justify-between lg:mb-12">
          <Link
            to="/"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20 active:scale-95"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Live across Ghana
          </span>
        </div>

        {/* Mobile: condensed brand block */}
        <div className="mb-6 flex items-center gap-3 lg:hidden">
          <span className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-white ring-1 ring-white/20 shadow-lg">
            <img src="/logo-mark.png" alt="" className="h-full w-full object-cover" />
          </span>
          <span className="text-lg font-extrabold tracking-tight">
            Samley<span className="text-orange-400">Go</span>
          </span>
          <span className="ml-auto rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
            {mobileBrand}
          </span>
        </div>

        {/* Desktop: full story */}
        <div className="hidden lg:block">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-300">
            {eyebrow}
          </span>
          <h1 className="mt-5 text-4xl font-black leading-[1.08] tracking-tight xl:text-[2.75rem]">
            {headline}
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-emerald-100/70">
            {description}
          </p>

          <ul className="mt-8 space-y-4">
            {features.map((feature) => (
              <li key={feature.title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/25">
                  <feature.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-bold text-white">{feature.title}</span>
                  <span className="block text-[13px] leading-snug text-emerald-100/60">
                    {feature.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-9 flex items-center gap-2 text-[11px] font-semibold text-emerald-100/50">
            <Check className="h-3.5 w-3.5 text-emerald-400" />
            No delivery fees hidden · Cancel anytime · 24/7 human support
          </div>
        </div>

        {/* Mobile: one-line promise + compact feature chips instead of the
            full story block, so phones still get the value props without a
            wall of text pushing the form down. */}
        <div className="lg:hidden">
          <p className="text-sm leading-relaxed text-emerald-100/70">{description}</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {features.map((feature) => (
              <li
                key={feature.title}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-emerald-100/80 backdrop-blur-sm"
              >
                <feature.icon className="h-3.5 w-3.5 text-emerald-300" />
                {feature.title}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Right · form card ───────────────────────────────────────── */}
      <div className="flex items-center justify-center animate-fade-up [animation-delay:120ms]">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-5 text-slate-900 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.85)] sm:p-7 lg:max-w-lg lg:p-8">
          <div className="mb-6 text-center">
            <h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
              {cardTitle}
            </h2>
            <p className="mt-1.5 text-[13px] text-slate-500">{cardSubtitle}</p>
          </div>

          {children}
        </div>
      </div>
    </div>
  </div>
);

/**
 * Sign In / Create Account segmented control shared by both auth screens.
 * The active side is a solid emerald pill so the current mode is obvious at
 * a glance without relying on colour alone (the active item also switches to
 * `font-extrabold`).
 */
export const AuthTabs: React.FC<{
  active: 'login' | 'register';
}> = ({ active }) => (
  <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1">
    <Link
      to="/login"
      className={`rounded-xl py-2.5 text-center text-xs transition ${
        active === 'login'
          ? 'bg-emerald-600 font-extrabold text-white shadow-sm'
          : 'font-semibold text-slate-600 hover:text-slate-900'
      }`}
    >
      Sign In
    </Link>
    <Link
      to="/register"
      className={`rounded-xl py-2.5 text-center text-xs transition ${
        active === 'register'
          ? 'bg-emerald-600 font-extrabold text-white shadow-sm'
          : 'font-semibold text-slate-600 hover:text-slate-900'
      }`}
    >
      Create Account
    </Link>
  </div>
);

/** Standard field chrome: bold label + helper slot underneath. */
export const FieldLabel: React.FC<{ children: ReactNode; hint?: ReactNode }> = ({
  children,
  hint,
}) => (
  <div className="mb-1.5 flex items-center justify-between gap-3">
    <span className="block text-xs font-bold text-slate-700">{children}</span>
    {hint}
  </div>
);

/** Input base classes — light theme, matches the white card. */
export const INPUT_CLASS =
  'w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-900 placeholder-slate-400 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/15';

/**
 * Same as `INPUT_CLASS` but with room for an in-field action (eye toggle).
 * Built from the pieces rather than appending `pr-11`, otherwise the two
 * padding-right utilities fight and whichever Tailwind emits last wins.
 */
export const INPUT_ACTION_CLASS =
  'w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-11 text-sm text-slate-900 placeholder-slate-400 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/15';
