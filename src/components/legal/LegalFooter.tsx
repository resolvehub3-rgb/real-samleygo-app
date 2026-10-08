import React from 'react';
import { Link } from 'react-router-dom';
import { LEGAL_DOCUMENTS } from '../../legal/registry';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_HREF, SUPPORT_PATH } from '../../legal/contact';

/**
 * The legal centre's footer: brand block, the full document index and the
 * support channels. Rendered once by `LegalDocumentLayout` so every document
 * carries the same navigation — no duplicated link lists across nine pages.
 *
 * It is part of the page flow (not fixed), so it can never overlap content,
 * and the page above it carries the bottom-navigation padding.
 */
export const LegalFooter: React.FC = () => {
  return (
    <footer className="mt-14 border-t border-slate-200 pt-8">
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Brand */}
        <div>
          <div className="flex items-center gap-2.5">
            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 shadow-xs">
              <img src="/logo-mark.png" alt="" className="h-full w-full object-cover" />
            </span>
            <span className="text-base font-extrabold tracking-tight text-brand-deep">
              Samley<span className="text-accent">Go</span> Ghana
            </span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
            Food delivery and digital marketplace services.
          </p>
          <p className="mt-5 text-xs text-slate-500">
            © {new Date().getFullYear()} SamleyGo. All rights reserved.
          </p>
        </div>

        {/* Legal index + support */}
        <div className="grid gap-8 sm:grid-cols-2">
          <nav aria-labelledby="legal-footer-heading">
            <h2 id="legal-footer-heading" className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Legal
            </h2>
            <ul className="mt-3 grid gap-2">
              {LEGAL_DOCUMENTS.map((doc) => (
                <li key={doc.key}>
                  <Link
                    to={doc.path}
                    className="inline-flex min-h-6 items-center text-sm text-slate-600 underline-offset-4 transition hover:text-brand-dark hover:underline"
                  >
                    {doc.navTitle}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Support</h2>
            <ul className="mt-3 grid gap-2">
              <li>
                <Link
                  to={SUPPORT_PATH}
                  className="inline-flex min-h-6 items-center text-sm text-slate-600 underline-offset-4 transition hover:text-brand-dark hover:underline"
                >
                  Contact Support
                </Link>
              </li>
              <li>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="inline-flex min-h-6 items-center break-all text-sm text-slate-600 underline-offset-4 transition hover:text-brand-dark hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>
              </li>
              <li>
                <a
                  href={`tel:${SUPPORT_PHONE_HREF}`}
                  className="inline-flex min-h-6 items-center text-sm text-slate-600 underline-offset-4 transition hover:text-brand-dark hover:underline"
                >
                  {SUPPORT_PHONE}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
};
