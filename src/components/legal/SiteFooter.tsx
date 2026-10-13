import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Mail, Phone } from 'lucide-react';
import {
  LEGAL_DOCUMENTS,
  legalDocumentForPath,
} from '../../legal/registry';
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_HREF,
  SUPPORT_PHONE_ALT,
  SUPPORT_PHONE_ALT_HREF,
  SUPPORT_PATH,
} from '../../legal/contact';
import { isAuthPath } from '../../lib/roleRoutes';

/** The three destinations every user should be able to reach from any page. */
const PRIMARY_LINKS = [
  { to: '/terms', label: 'Terms of Service' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: SUPPORT_PATH, label: 'Help & Support' },
];

/** Routes that already render their own footer or their own full-screen chrome. */
const hasOwnChrome = (pathname: string): boolean =>
  // The home screen is a browse-and-decide surface — a nine-item policy index
  // under it pushes the app's own content a long way down the page.
  pathname === '/' ||
  isAuthPath(pathname) ||
  legalDocumentForPath(pathname) !== undefined ||
  pathname.startsWith('/admin') ||
  pathname.startsWith('/courier') ||
  pathname.startsWith('/restaurant/dashboard') ||
  pathname.startsWith('/restaurant/menu') ||
  pathname.startsWith('/restaurant/addons') ||
  pathname.startsWith('/restaurant/settings');

/**
 * The site-wide legal footer.
 *
 * Rendered once by the app shell so Terms of Service, Privacy Policy and
 * Help & Support are one tap away from the home screen, the cart, an order
 * and every other customer page. It steps aside on routes that carry their
 * own chrome — the legal centre, the auth screens, the partner dashboards —
 * so nothing is ever shown twice.
 */
export const SiteFooter: React.FC = () => {
  const { pathname } = useLocation();

  if (hasOwnChrome(pathname)) return null;

  return (
    <footer className="mt-10 border-t border-slate-200 bg-white/70 px-4 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Primary destinations — the three pages people look for */}
        <nav aria-label="Legal and support">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {PRIMARY_LINKS.map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className="inline-flex min-h-8 items-center text-sm font-bold text-slate-700 underline-offset-4 transition hover:text-brand-dark hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* The rest of the legal centre, for people who want the detail */}
        <nav aria-labelledby="site-footer-legal-heading">
          <h2
            id="site-footer-legal-heading"
            className="text-xs font-bold uppercase tracking-wider text-slate-500"
          >
            All policies
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_DOCUMENTS.map((doc) => (
              <li key={doc.key}>
                <Link
                  to={doc.path}
                  className="inline-flex min-h-6 items-center text-xs text-slate-500 underline-offset-4 transition hover:text-brand-dark hover:underline"
                >
                  {doc.navTitle}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Support channels — tap to call, tap to email */}
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-slate-600">SamleyGo Ghana</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex min-h-6 items-center gap-1.5 underline-offset-4 transition hover:text-brand-dark hover:underline"
            >
              <Mail className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <span>{SUPPORT_EMAIL}</span>
            </a>
            <a
              href={`tel:${SUPPORT_PHONE_HREF}`}
              className="inline-flex min-h-6 items-center gap-1.5 underline-offset-4 transition hover:text-brand-dark hover:underline"
            >
              <Phone className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <span>{SUPPORT_PHONE}</span>
            </a>
            <a
              href={`tel:${SUPPORT_PHONE_ALT_HREF}`}
              className="inline-flex min-h-6 items-center gap-1.5 underline-offset-4 transition hover:text-brand-dark hover:underline"
            >
              <span>{SUPPORT_PHONE_ALT}</span>
            </a>
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          © {new Date().getFullYear()} SamleyGo. All rights reserved.
        </p>
      </div>
    </footer>
  );
};
