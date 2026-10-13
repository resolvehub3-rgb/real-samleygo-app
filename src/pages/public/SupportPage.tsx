import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bike,
  Check,
  ClipboardList,
  CreditCard,
  LifeBuoy,
  Mail,
  Phone,
  Send,
  ShieldAlert,
  Smartphone,
  Store,
  Utensils,
} from 'lucide-react';
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_HREF,
  SUPPORT_PHONE_ALT,
  SUPPORT_PHONE_ALT_HREF,
} from '../../legal/contact';
import { useAuth } from '../../context/AuthContext';
import { LegalFooter } from '../../components/legal/LegalFooter';

/**
 * Help & Support.
 *
 * Every channel here is one the platform actually operates — a mailbox and two
 * phone lines. There is no ticket backend, so nothing on this page claims that
 * a message was "logged": the composer below builds a real, addressed email and
 * hands it to the visitor's own mail app to send.
 */

interface Topic {
  id: string;
  icon: React.ReactNode;
  title: string;
  intro: string;
  items: string[];
}

const TOPICS: Topic[] = [
  {
    id: 'food-orders',
    icon: <Utensils className="h-4 w-4" aria-hidden="true" />,
    title: 'Food orders',
    intro: 'Get assistance with:',
    items: [
      'Placing an order.',
      'Adding extra meals, drinks, sides, and customisations.',
      'Correcting an order before confirmation.',
      'Restaurant acceptance and preparation status.',
      'Missing or incorrect items.',
      'Delayed delivery.',
      'Cancellation requests.',
      'Order receipts and payment questions.',
    ],
  },
  {
    id: 'errands-rides',
    icon: <Bike className="h-4 w-4" aria-hidden="true" />,
    title: 'Errands, rides, and deliveries',
    intro: 'Get assistance with:',
    items: [
      'Selecting a pickup location and destination.',
      'Understanding estimated fares.',
      'Finding an eligible available driver or rider.',
      'Booking motorcycle or car services.',
      'Sending eligible parcels.',
      'Providing collection and delivery instructions.',
      'Tracking an active booking.',
      'Driver or rider arrival.',
      'Completed or disputed services.',
    ],
  },
  {
    id: 'driver-support',
    icon: <Smartphone className="h-4 w-4" aria-hidden="true" />,
    title: 'Driver and rider support',
    intro: 'Drivers and riders can contact Support about:',
    items: [
      'Account registration.',
      'Required documentation.',
      'Account verification and approval.',
      'Availability status.',
      'Booking assignments.',
      'Navigation or location problems.',
      'Delivery confirmation.',
      'Earnings and settlement questions.',
      'Account access and security.',
    ],
  },
  {
    id: 'restaurant-support',
    icon: <Store className="h-4 w-4" aria-hidden="true" />,
    title: 'Restaurant partner support',
    intro: 'Restaurants can contact Support about:',
    items: [
      'Restaurant onboarding.',
      'Menu and price updates.',
      'Meal extras and add-on management.',
      'Product availability.',
      'Incoming orders.',
      'Order preparation and fulfilment.',
      'Restaurant dashboard access.',
      'Commission and settlement questions.',
      'Customer disputes.',
      'Technical problems.',
    ],
  },
  {
    id: 'account-technical',
    icon: <ShieldAlert className="h-4 w-4" aria-hidden="true" />,
    title: 'Account and technical support',
    intro: 'Contact us if you experience:',
    items: [
      'Login or registration difficulties.',
      'Incorrect account details.',
      'Location permission issues.',
      'Map or route problems.',
      'Missing order information.',
      'Failed application pages.',
      'Unexpected errors.',
      'Suspected unauthorised account access.',
    ],
  },
];

/** Payment-issues checklist — kept separate because it is always relevant. */
const PAYMENT_DETAILS = [
  'Order or booking reference.',
  'Date of transaction.',
  'Amount involved.',
  'Payment method used.',
  'Transaction reference, if available.',
  'A short explanation of the issue.',
];

/** What a useful support request contains, in the order we read them. */
const REQUEST_CHECKLIST = [
  'Your name or account identifier.',
  'Your registered contact details.',
  'Your order, booking, or transaction reference, if applicable.',
  'The date and approximate time of the issue.',
  'A clear description of what happened.',
  'A screenshot, if useful and safe to share.',
];

export const SupportPage: React.FC = () => {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [detail, setDetail] = useState('');

  /** Builds a real, addressed email — the visitor's mail app does the sending. */
  const preparedBody = [
    name.trim() ? `Name / account: ${name.trim()}` : '',
    reference.trim() ? `Reference: ${reference.trim()}` : '',
    '',
    detail.trim(),
    '',
    'Sent from the SamleyGo Help & Support page.',
  ].join('\n');

  const mailtoHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    reference.trim() ? `SamleyGo support — ${reference.trim()}` : 'SamleyGo support request'
  )}&body=${encodeURIComponent(preparedBody)}`;

  return (
    <div className="min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12 bg-canvas">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        {/* ── Masthead ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-100">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
            SamleyGo Support
          </span>
          <h1 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Help &amp; Support
          </h1>
          <p className="text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
            We&apos;re here to help you. Whether you&apos;re ordering food, adding extra items,
            requesting an errand, booking a ride where available, delivering a parcel, managing a
            restaurant, or working as a driver or rider, SamleyGo Support can help you with
            service-related questions.
          </p>
        </div>

        {/* ── 1. Contact channels ──────────────────────────────────── */}
        <section aria-labelledby="contact-heading" className="space-y-4">
          <h2 id="contact-heading" className="text-lg font-bold text-slate-900">
            1. Contact SamleyGo Support
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="group flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-emerald-300 hover:shadow-sm"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Mail className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Email
                </span>
                <span className="block truncate text-sm font-bold text-slate-900 group-hover:text-brand-dark">
                  {SUPPORT_EMAIL}
                </span>
              </span>
            </a>

            <a
              href={`tel:${SUPPORT_PHONE_HREF}`}
              className="group flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-emerald-300 hover:shadow-sm"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Phone className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Phone
                </span>
                <span className="block truncate text-sm font-bold text-slate-900 group-hover:text-brand-dark">
                  {SUPPORT_PHONE}
                </span>
              </span>
            </a>

            <a
              href={`tel:${SUPPORT_PHONE_ALT_HREF}`}
              className="group flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-emerald-300 hover:shadow-sm"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Phone className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Alternative phone
                </span>
                <span className="block truncate text-sm font-bold text-slate-900 group-hover:text-brand-dark">
                  {SUPPORT_PHONE_ALT}
                </span>
              </span>
            </a>
          </div>

          {/* ── Message composer — prepares a real email, never a fake ticket ── */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Send className="h-4.5 w-4.5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Write to us</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  This opens your own email app with the message addressed to {SUPPORT_EMAIL}. You
                  review and send it — nothing leaves your device until you do.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="support-name" className="block text-xs font-bold text-slate-700 mb-1">
                  Your name or account
                </label>
                <input
                  id="support-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label
                  htmlFor="support-reference"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Order, booking or transaction reference
                </label>
                <input
                  id="support-reference"
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. order #SG-123456"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs placeholder:text-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="support-detail" className="block text-xs font-bold text-slate-700 mb-1">
                What happened?
              </label>
              <textarea
                id="support-detail"
                rows={4}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={mailtoHref}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-xs font-bold text-white transition hover:bg-slate-800 active:scale-[0.98]"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Open in my email app
              </a>
              <a
                href={`tel:${SUPPORT_PHONE_HREF}`}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call instead
              </a>
            </div>

            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
              Never send your password, mobile money PIN or a one-time code to anyone. SamleyGo
              support will never ask for them.
            </p>
          </div>
        </section>

        {/* ── 2. Food orders ───────────────────────────────────────── */}
        <section aria-labelledby="orders-heading" className="space-y-3">
          <h2 id="orders-heading" className="text-lg font-bold text-slate-900">
            2. Food orders
          </h2>
          <p className="text-sm text-slate-600">
            Get help with an order you placed, or review what you have ordered before.
          </p>
          <div className="flex flex-wrap gap-3">
            {user && (
              <Link
                to="/orders"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-xs font-bold text-white shadow-md transition hover:bg-brand-dark active:scale-[0.98]"
              >
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                My orders
              </Link>
            )}
            <Link
              to={user ? '/cart' : '/register'}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
            >
              {user ? 'Open my cart' : 'Create an account'}
            </Link>
          </div>
        </section>

        {/* ── Topic accordions (3–7) ───────────────────────────────── */}
        <section aria-labelledby="topics-heading" className="space-y-3">
          <h2 id="topics-heading" className="sr-only">
            Support topics
          </h2>
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xs">
            {TOPICS.map((topic, index) => (
              <details
                key={topic.id}
                open={index === 0}
                className="group border-b border-slate-100 last:border-b-0"
              >
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-4 transition hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    {topic.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-900">
                      {index + 2}. {topic.title}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-slate-400 transition group-open:rotate-180"
                  >
                    ▾
                  </span>
                </summary>
                <div className="px-5 pb-5">
                  <p className="text-xs font-semibold text-slate-500">{topic.intro}</p>
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {topic.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs text-slate-600">
                        <span
                          className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  {topic.id === 'driver-support' && (
                    <p className="mt-3 text-[11px] text-slate-500">
                      Provide the account identifier or relevant booking reference when possible.
                    </p>
                  )}
                  {topic.id === 'restaurant-support' && (
                    <p className="mt-3 text-[11px] text-slate-500">
                      Use the restaurant account associated with the affected order when submitting
                      a request.
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* ── 4. Payments and refunds ──────────────────────────────── */}
        <section
          aria-labelledby="payments-heading"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <CreditCard className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <h2 id="payments-heading" className="text-lg font-bold text-slate-900">
              Payments and refunds
            </h2>
          </div>

          <p className="text-sm text-slate-600">For a payment issue, please provide:</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {PAYMENT_DETAILS.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-slate-600">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-100">
            Refunds and payment reversals are assessed according to the applicable transaction,
            service status, payment provider procedures, and applicable law. Please see our{' '}
            <Link
              to="/refunds"
              className="font-bold text-brand-dark underline underline-offset-4"
            >
              Refund Policy
            </Link>{' '}
            for how those assessments work.
          </p>
        </section>

        {/* ── 8. How to submit a useful request ────────────────────── */}
        <section
          aria-labelledby="checklist-heading"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <ClipboardList className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <h2 id="checklist-heading" className="text-lg font-bold text-slate-900">
              How to submit a useful support request
            </h2>
          </div>

          <p className="text-sm text-slate-600">Please include:</p>
          <ol className="grid gap-2">
            {REQUEST_CHECKLIST.map((item, index) => (
              <li key={item} className="flex items-start gap-3 text-xs text-slate-600">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-100">
                  {index + 1}
                </span>
                <span className="pt-0.5">{item}</span>
              </li>
            ))}
          </ol>

          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-100">
            Do not include unnecessary identity documents, payment credentials, or other sensitive
            personal information.
          </p>
        </section>

        {/* ── 9. Safety concerns ───────────────────────────────────── */}
        <section
          aria-labelledby="safety-heading"
          className="rounded-3xl border border-amber-200 bg-amber-50/60 p-6 space-y-3"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <AlertTriangle className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <h2 id="safety-heading" className="text-lg font-bold text-slate-900">
              Safety concerns
            </h2>
          </div>
          <p className="text-sm leading-relaxed text-slate-700">
            If a service creates an immediate threat to life or safety, contact the appropriate
            local emergency services first.
          </p>
          <p className="text-sm leading-relaxed text-slate-700">
            You may then contact SamleyGo to report the incident and provide the relevant booking
            reference. SamleyGo will review reports through its applicable operational and safety
            procedures.
          </p>
        </section>

        {/* ── 10. Our support commitment ───────────────────────────── */}
        <section aria-labelledby="commitment-heading" className="space-y-3">
          <h2 id="commitment-heading" className="text-lg font-bold text-slate-900">
            Our support commitment
          </h2>
          <p className="text-sm leading-relaxed text-slate-600">
            SamleyGo aims to handle customer, restaurant, driver, and rider enquiries professionally
            and fairly.
          </p>
          <p className="text-sm leading-relaxed text-slate-600">
            Resolution times depend on the nature of the issue, the availability of relevant records,
            and whether third-party providers must be consulted.
          </p>
          <p className="text-sm leading-relaxed text-slate-600">
            We will not promise a specific resolution time unless it is supported by the actual
            support operation.
          </p>
        </section>

        {/* ── 11. Related policies ─────────────────────────────────── */}
        <section aria-labelledby="policies-heading" className="space-y-3">
          <h2 id="policies-heading" className="text-lg font-bold text-slate-900">
            Related policies
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/terms"
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-emerald-300 hover:shadow-sm"
            >
              <span className="block text-sm font-bold text-slate-900">Terms of Service</span>
              <span className="mt-1 block text-xs text-slate-500">
                The rules that apply when you use SamleyGo to order, book or deliver.
              </span>
            </Link>
            <Link
              to="/privacy"
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-emerald-300 hover:shadow-sm"
            >
              <span className="block text-sm font-bold text-slate-900">Privacy Policy</span>
              <span className="mt-1 block text-xs text-slate-500">
                How we collect, use, share and protect your personal information.
              </span>
            </Link>
          </div>
        </section>

        {/* ── 12. Contact us ───────────────────────────────────────── */}
        <section aria-labelledby="contact-us-heading" className="space-y-3">
          <h2 id="contact-us-heading" className="text-lg font-bold text-slate-900">
            Contact us
          </h2>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-2 text-sm">
            <p className="font-bold text-slate-900">SamleyGo Support</p>
            <p className="text-slate-600">
              Email:{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-semibold text-brand-dark underline underline-offset-4"
              >
                {SUPPORT_EMAIL}
              </a>
            </p>
            <p className="text-slate-600">
              Phone:{' '}
              <a
                href={`tel:${SUPPORT_PHONE_HREF}`}
                className="font-semibold text-brand-dark underline underline-offset-4"
              >
                {SUPPORT_PHONE}
              </a>
            </p>
            <p className="text-slate-600">
              Alternative phone:{' '}
              <a
                href={`tel:${SUPPORT_PHONE_ALT_HREF}`}
                className="font-semibold text-brand-dark underline underline-offset-4"
              >
                {SUPPORT_PHONE_ALT}
              </a>
            </p>
          </div>
          <p className="text-sm text-slate-600">
            Thank you for choosing SamleyGo. We appreciate your trust and feedback as we continue
            improving the platform.
          </p>
        </section>

        <LegalFooter />
      </div>
    </div>
  );
};
