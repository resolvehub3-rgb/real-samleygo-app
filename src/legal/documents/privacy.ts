import type { LegalDocument } from '../types';
import {
  PRIVACY_CONTACT_EMAIL,
  SUPPORT_EMAIL,
  SUPPORT_PATH,
  SUPPORT_PHONE,
  SUPPORT_PHONE_ALT,
} from '../contact';

const privacyEmailLink = `[${PRIVACY_CONTACT_EMAIL}](mailto:${PRIVACY_CONTACT_EMAIL})`;
const supportScreenLink = `[Support screen](${SUPPORT_PATH})`;

/**
 * Privacy Policy.
 *
 * Describes the platform as it actually operates: Supabase for accounts and
 * data, Google Maps and the Google Routes API for geocoding and routing, and
 * browser local storage for the session, cart and saved delivery address.
 * No analytics or advertising vendor is disclosed because none is deployed,
 * and no card-credential storage is claimed because none happens here.
 */
export const privacyDocument: LegalDocument = {
  key: 'privacy',
  path: '/privacy',
  title: 'Privacy Policy — SamleyGo Ghana',
  heading: 'Privacy Policy',
  navTitle: 'Privacy Policy',
  metaTitle: 'Privacy Policy | SamleyGo Ghana',
  metaDescription:
    'How SamleyGo collects, uses, shares, retains and protects personal information across food ordering, delivery, errands and partner services in Ghana.',
  summary:
    "SamleyGo respects your privacy and is committed to handling personal information responsibly. This Privacy Policy explains how information may be collected, used, disclosed, retained, and protected when you use SamleyGo's website, installable web application, food ordering services, delivery services, errands, rides where enabled, and related platform features.",
  sections: [
    {
      id: 'scope',
      title: '1. Scope',
      blocks: [
        {
          kind: 'p',
          text: 'This Policy applies to customers, restaurant partners, drivers, riders, and other authorised users of SamleyGo.',
        },
        {
          kind: 'p',
          text: 'It covers personal information processed through the platform and related service interactions.',
        },
        {
          kind: 'p',
          text: `Where this Policy says "we", "us" or "SamleyGo", we mean the operator of the SamleyGo platform. Questions about this Policy can be sent to ${privacyEmailLink}.`,
        },
      ],
    },
    {
      id: 'information-collected',
      title: '2. Information We May Collect',
      blocks: [
        {
          kind: 'p',
          text: 'The information collected depends on your role, the features you use, and the permissions you grant.',
        },
        {
          kind: 'sub',
          title: 'Account information',
          blocks: [
            {
              kind: 'list',
              items: [
                'Name.',
                'Email address.',
                'Telephone number.',
                'Account identifier.',
                'Authentication and account security information.',
                'Account preferences and role (customer, restaurant partner, courier, or administrator).',
                'Profile photograph, if you choose to upload one.',
              ],
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Location information',
          blocks: [
            {
              kind: 'p',
              text: 'Where required and permitted, SamleyGo may process:',
            },
            {
              kind: 'list',
              items: [
                'Pickup coordinates.',
                'Delivery and destination coordinates.',
                'Addresses entered by users.',
                'Current location while using relevant features, including the "use current device location" option.',
                'Driver or rider location while a courier is online or working on an assignment.',
                'Route, distance, and estimated travel information.',
              ],
            },
            {
              kind: 'note',
              tone: 'info',
              title: 'Background tracking',
              text: 'SamleyGo does not track your device in the background when the app is closed. Courier location is collected in the foreground while a courier is online or completing a job, so that customers can see progress and the platform can match and complete bookings.',
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Order and booking information',
          blocks: [
            {
              kind: 'list',
              items: [
                'Restaurant selections.',
                'Meals, quantities, and additional items or customisations.',
                'Special instructions you add to a meal or an order.',
                'Delivery instructions.',
                'Errand descriptions.',
                'Pickup and destination details.',
                'Booking and order status.',
                'Transaction references.',
                'Customer support history.',
                'Ratings and feedback, where enabled.',
              ],
            },
            {
              kind: 'p',
              text: 'When an order is confirmed, the platform stores a record of what was ordered — the meal names, quantities, chosen extras and their prices at that moment — so the restaurant, the courier and your receipt all show the same order even if the menu changes later.',
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Payment information',
          blocks: [
            {
              kind: 'p',
              text: 'SamleyGo may process transaction amounts, payment status, the payment method used, transaction references, and related records.',
            },
            {
              kind: 'note',
              tone: 'important',
              title: 'SamleyGo does not store your card number or PIN',
              text: 'Card numbers, mobile money PINs and one-time codes are entered with, and handled by, the payment provider you choose. SamleyGo records the amount, method, status and reference of a transaction so that an order can be reconciled and a disputed charge investigated.',
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Driver and rider information',
          blocks: [
            {
              kind: 'p',
              text: 'For service providers, this may include:',
            },
            {
              kind: 'list',
              items: [
                'Profile information.',
                'Vehicle and service category.',
                'Required onboarding documents, including identity documents submitted for approval.',
                'Approval and eligibility status.',
                'Availability status.',
                'Relevant location information while online or on a job.',
                'Earnings, commission and settlement records.',
                'Ratings and operational records.',
              ],
            },
            {
              kind: 'note',
              tone: 'important',
              title: 'Restricted access',
              text: 'Identity documents and other sensitive operational records are not shown on shared screens and are only accessible to the authorised personnel who need them to review an account.',
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Restaurant information',
          blocks: [
            {
              kind: 'list',
              items: [
                'Business and contact details.',
                'Menu, pricing and add-on configuration.',
                'Operating and availability information.',
                'Order history.',
                'Settlement and commission records.',
                'Account and verification status.',
              ],
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Technical information',
          blocks: [
            {
              kind: 'p',
              text: 'Depending on the deployed configuration, we may process:',
            },
            {
              kind: 'list',
              items: [
                'IP address.',
                'Device and browser information.',
                'Application logs.',
                'Error reports.',
                'Security and authentication events.',
                'Basic usage and performance information.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'how-we-use',
      title: '3. How We Use Information',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo may use personal information to:',
        },
        {
          kind: 'list',
          items: [
            'Create and maintain accounts.',
            'Authenticate users and protect account security.',
            'Process food orders and meal customisations.',
            'Connect customers with restaurants and eligible providers.',
            'Calculate fares and delivery charges.',
            'Identify pickup and destination locations.',
            'Provide route information and live tracking.',
            'Facilitate delivery and errand completion.',
            'Process and reconcile payments.',
            'Communicate order and booking updates.',
            'Handle complaints, disputes, and support requests.',
            'Prevent fraud and investigate security incidents.',
            'Maintain service reliability and diagnose technical failures.',
            'Meet applicable legal, tax, accounting, and regulatory obligations.',
            'Improve the platform in ways consistent with applicable law.',
          ],
        },
        {
          kind: 'p',
          text: 'Where consent is required, SamleyGo will seek it before processing the relevant information.',
        },
      ],
    },
    {
      id: 'location-tracking',
      title: '4. Location Tracking',
      blocks: [
        {
          kind: 'p',
          text: 'Location information is important for delivery, errands, and transportation services.',
        },
        {
          kind: 'p',
          text: 'For customers, location may be used to identify pickup points, destinations, nearby providers, and routes. You can type or search for an address instead of sharing your device location, and you can edit the address before you confirm an order.',
        },
        {
          kind: 'p',
          text: 'For drivers and riders, location may be used to display availability, identify nearby service requests, provide navigation, and support active bookings.',
        },
        {
          kind: 'p',
          text: 'Access is limited to the relevant service purpose and the operational period in which it is needed.',
        },
        {
          kind: 'p',
          text: 'Users can manage device location permissions through their device or browser settings. Disabling location may prevent certain features from working.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Where the map cannot load or permission is denied, SamleyGo tells you and offers the address search instead — it does not silently place a guess on your behalf.',
        },
      ],
    },
    {
      id: 'sharing',
      title: '5. How We Share Information',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo may share relevant information with:',
        },
        {
          kind: 'terms',
          items: [
            {
              term: 'Restaurants',
              definition:
                'Order contents, the extras you chose, customer-provided delivery instructions, and information needed to fulfil orders.',
            },
            {
              term: 'Drivers and riders',
              definition:
                'Relevant pickup and destination information, service instructions, and contact information necessary to complete an assigned service.',
            },
            {
              term: 'Customers',
              definition:
                'Appropriate provider profile and booking information necessary for the service.',
            },
            {
              term: 'Payment providers',
              definition:
                'Transaction information required to process or reconcile a supported payment.',
            },
            {
              term: 'Mapping and routing providers',
              definition:
                'Coordinates and routing requests needed to calculate routes, distances or fares, and to display maps.',
            },
            {
              term: 'Hosting and technical service providers',
              definition:
                'Information necessary to host, secure, operate, and maintain the platform.',
            },
            {
              term: 'Professional advisers and authorities',
              definition:
                'Information where reasonably necessary for legal compliance, lawful requests, dispute resolution, or protection of rights and safety.',
            },
          ],
        },
        {
          kind: 'note',
          tone: 'important',
          title: 'No selling of personal information',
          text: 'SamleyGo does not sell personal information, and it does not authorise service providers to use customer information for unrelated purposes merely because they receive it to fulfil an order.',
        },
      ],
    },
    {
      id: 'cookies',
      title: '6. Cookies and Similar Technologies',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo uses essential storage in your browser — session mechanisms, local storage and similar technologies — that are required for authentication, security, preferences and application functionality.',
        },
        {
          kind: 'p',
          text: 'In practice this means your sign-in session, the contents of your cart, your saved delivery address and your sound and navigation preferences are kept on your device so the app can restore them when you return. You can clear these at any time through your browser; doing so will sign you out and empty your cart.',
        },
        {
          kind: 'note',
          tone: 'info',
          title: 'No advertising cookies today',
          text: 'SamleyGo does not currently use analytics or advertising cookies. If that changes, this Policy will be updated and any consent required by law will be requested before those technologies are used.',
        },
      ],
    },
    {
      id: 'security',
      title: '7. Data Security',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo applies appropriate technical and organisational safeguards, including:',
        },
        {
          kind: 'list',
          items: [
            'Access controls and role-based permissions.',
            'Authentication and authorisation.',
            'Encrypted connections in transit.',
            'Database access restrictions and Supabase Row Level Security policies, so a signed-in user can only read and change their own records.',
            'Secret management for server-side services.',
            'Monitoring and incident response.',
            'Reasonable retention and deletion procedures.',
          ],
        },
        {
          kind: 'note',
          tone: 'important',
          text: 'No system can guarantee absolute security. Users should protect their account credentials and report suspected compromise promptly.',
        },
      ],
    },
    {
      id: 'retention',
      title: '8. Data Retention',
      blocks: [
        {
          kind: 'p',
          text: 'Personal information is retained only for as long as reasonably necessary for the purposes for which it was collected, subject to applicable legal, accounting, security, and dispute-resolution requirements.',
        },
        {
          kind: 'p',
          text: 'Retention periods may differ for account records, orders, payment records, location data, support requests, and regulatory documentation.',
        },
        {
          kind: 'p',
          text: 'SamleyGo should establish and follow documented retention periods rather than retaining all information indefinitely.',
        },
        {
          kind: 'p',
          text: 'Some requests can be completed directly in the app — you can edit your profile details, decline location permission, or sign out at any time.',
        },
      ],
    },
    {
      id: 'your-rights',
      title: '9. Your Privacy Rights',
      blocks: [
        {
          kind: 'p',
          text: 'Subject to applicable law, you may have rights to:',
        },
        {
          kind: 'list',
          items: [
            'Request access to your personal information.',
            'Request correction of inaccurate information.',
            'Request deletion where legally available.',
            'Object to or request restriction of certain processing.',
            'Withdraw consent where processing relies on consent.',
            'Request information about relevant disclosures.',
            'Submit a complaint to the appropriate data protection authority.',
          ],
        },
        {
          kind: 'p',
          text: `Requests can be submitted using the contact information in section 14. SamleyGo may need to verify your identity before acting on a request. To ask us to close your account, write from the email address registered to it, because there is no self-service account-deletion button in the app today and we handle these requests ourselves.`,
        },
        {
          kind: 'p',
          text: 'Some records may need to be retained where the law requires it.',
        },
      ],
    },
    {
      id: 'children',
      title: '10. Children and Young Users',
      blocks: [
        {
          kind: 'p',
          text: "SamleyGo's services are not intended to be used by children in ways that violate applicable law or the eligibility rules of a particular service.",
        },
        {
          kind: 'p',
          text: 'Where a service has age restrictions, those restrictions must be followed.',
        },
        {
          kind: 'p',
          text: `If SamleyGo becomes aware that personal information has been collected unlawfully from a child, it will take appropriate steps in accordance with applicable law. Please contact ${privacyEmailLink}.`,
        },
      ],
    },
    {
      id: 'international',
      title: '11. International Processing',
      blocks: [
        {
          kind: 'p',
          text: 'Some hosting, mapping, communications, or payment providers may process information outside Ghana.',
        },
        {
          kind: 'p',
          text: 'Where personal information is transferred internationally, SamleyGo must apply the safeguards and legal requirements applicable to that transfer.',
        },
        {
          kind: 'p',
          text: `You can ask us for more information about where your information is stored by contacting ${privacyEmailLink}.`,
        },
      ],
    },
    {
      id: 'third-parties',
      title: '12. Third-Party Services',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo relies on external services to support parts of the platform. Those services may have their own privacy policies and contractual terms.',
        },
        {
          kind: 'p',
          text: 'The providers SamleyGo actually uses include:',
        },
        {
          kind: 'list',
          items: [
            'Supabase — for account authentication, the application database and row-level access control.',
            'Google Maps and the Google Routes API — for address search, geocoding, maps, routing, distance and travel estimates.',
            'A web-font provider, for the typeface used across the interface.',
          ],
        },
        {
          kind: 'p',
          text: 'Where SamleyGo links to a third-party service, that service is responsible for its own disclosures and practices.',
        },
      ],
    },
    {
      id: 'changes',
      title: '13. Changes to This Policy',
      blocks: [
        {
          kind: 'p',
          text: 'This Policy may be updated when SamleyGo introduces new services, changes its data practices, or responds to legal requirements.',
        },
        {
          kind: 'p',
          text: 'Material changes will be communicated through appropriate channels where required.',
        },
        {
          kind: 'p',
          text: 'The effective date will be updated whenever a revised Policy is published.',
        },
      ],
    },
    {
      id: 'privacy-contact',
      title: '14. Privacy Contact',
      blocks: [
        {
          kind: 'p',
          text: 'For privacy questions or personal data requests, contact SamleyGo Support:',
        },
        {
          kind: 'terms',
          items: [
            {
              term: 'Email',
              definition: `[${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL})`,
            },
            {
              term: 'Phone',
              definition: `[${SUPPORT_PHONE}](tel:+233594345424)`,
            },
            {
              term: 'Alternative phone',
              definition: `[${SUPPORT_PHONE_ALT}](tel:+233572207831)`,
            },
            {
              term: 'In-app',
              definition: `${supportScreenLink} — see [Help & Support](/support) for what to include in your request.`,
            },
          ],
        },
        {
          kind: 'note',
          tone: 'important',
          title: 'What to send',
          text: 'Please describe your request clearly and include the information needed to identify your account — without sending passwords, PINs, or authentication codes.',
        },
      ],
    },
    {
      id: 'applicable-law',
      title: '15. Applicable Data Protection Law',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo intends to handle personal information in accordance with applicable Ghanaian data protection law, including the Data Protection Act, 2012 (Act 843), as applicable, and any other relevant legal requirements.',
        },
        {
          kind: 'p',
          text: "This Policy should be reviewed and updated as necessary to reflect applicable legal changes and the platform's actual data processing practices.",
        },
      ],
    },
  ],
};
