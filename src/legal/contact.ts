/**
 * Official SamleyGo contact channels, in one place so the support screen, the
 * footer and every legal document quote exactly the same details.
 *
 * These are SamleyGo's published support channels for the Ghana market.
 * There is no separate legal or privacy mailbox, so privacy requests and
 * legal notices are routed through the same support channel rather than
 * inventing an address nobody monitors.
 */

/** Primary support mailbox — the address customers are asked to write to. */
export const SUPPORT_EMAIL = 'samleygo@gmail.com';

/** Primary support line. Digits only, as dialled with the Ghana country code. */
export const SUPPORT_PHONE = '0594345424';
export const SUPPORT_PHONE_HREF = '+233594345424';

/** Secondary support line, used when the primary line is busy. */
export const SUPPORT_PHONE_ALT = '0572207831';
export const SUPPORT_PHONE_ALT_HREF = '+233572207831';

/** Where privacy requests and legal notices are sent (routes to support). */
export const PRIVACY_CONTACT_EMAIL = SUPPORT_EMAIL;
export const LEGAL_CONTACT_EMAIL = SUPPORT_EMAIL;

/** In-app support route linked from documents and the footer. */
export const SUPPORT_PATH = '/support';
