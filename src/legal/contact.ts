/**
 * Official SamleyGo contact channels, in one place so the support page, the
 * footer and every legal document quote exactly the same details.
 *
 * These are the channels already published in the product (Support screen).
 * A dedicated legal/privacy mailbox has not been published, so privacy and
 * legal requests are routed through the existing support channel rather than
 * inventing an address that no one monitors.
 */

/** Primary support mailbox — published on the in-app Support screen. */
export const SUPPORT_EMAIL = 'support@samleygo.com.gh';

/** Dispatch/support hotline — published on the in-app Support screen. */
export const SUPPORT_PHONE = '+233 (0) 30 200 4567';
export const SUPPORT_PHONE_HREF = '+233302004567';

/** Where privacy requests and legal notices are sent (routes to support). */
export const PRIVACY_CONTACT_EMAIL = SUPPORT_EMAIL;
export const LEGAL_CONTACT_EMAIL = SUPPORT_EMAIL;

/** In-app support route linked from documents and the footer. */
export const SUPPORT_PATH = '/support';
