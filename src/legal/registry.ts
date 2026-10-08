import type { LegalDocument } from './types';
import { termsDocument } from './documents/terms';
import { privacyDocument } from './documents/privacy';
import { cookiesDocument } from './documents/cookies';
import { refundsDocument } from './documents/refunds';
import { deliveryPolicyDocument } from './documents/delivery';
import { paymentPolicyDocument } from './documents/payments';
import { acceptableUseDocument } from './documents/acceptableUse';
import { restaurantTermsDocument } from './documents/restaurantTerms';
import { courierTermsDocument } from './documents/courierTerms';

/**
 * Shared dates for the legal centre. Every document is re-issued together in
 * this production update, so one pair of dates is shown across the set.
 */
export const LEGAL_LAST_UPDATED = 'October 8, 2026';
export const LEGAL_EFFECTIVE_DATE = 'October 8, 2026';

/**
 * Every legal document, in the order they appear in the footer and in any
 * "related documents" lists. One entry per route — the route table in App.tsx
 * is generated from this list so the two can never drift apart.
 */
export const LEGAL_DOCUMENTS: LegalDocument[] = [
  termsDocument,
  privacyDocument,
  cookiesDocument,
  refundsDocument,
  deliveryPolicyDocument,
  paymentPolicyDocument,
  acceptableUseDocument,
  restaurantTermsDocument,
  courierTermsDocument,
];

/** Strips query/hash and any trailing slash so `/terms/` still resolves. */
const matchKey = (path: string): string =>
  path.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';

/** The document published at a path, or `undefined` for non-legal routes. */
export const legalDocumentForPath = (pathname: string): LegalDocument | undefined => {
  const key = matchKey(pathname);
  return LEGAL_DOCUMENTS.find((doc) => doc.path === key);
};

/** True for `/terms`, `/privacy`, `/cookies`, … — used to opt out of shell UI. */
export const isLegalPath = (pathname: string): boolean =>
  legalDocumentForPath(pathname) !== undefined;
