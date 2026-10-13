import type { LegalDocument } from '../types';
import {
  LEGAL_CONTACT_EMAIL,
  SUPPORT_EMAIL,
  SUPPORT_PATH,
  SUPPORT_PHONE,
  SUPPORT_PHONE_ALT,
} from '../contact';

const supportEmailLink = `[${LEGAL_CONTACT_EMAIL}](mailto:${LEGAL_CONTACT_EMAIL})`;
const supportScreenLink = `[Support screen](${SUPPORT_PATH})`;

/**
 * Terms of Service.
 *
 * Written for the platform as it is actually built: a Ghana market, a food
 * marketplace with meal extras, motorcycle and car delivery, errands, and
 * rides where they are enabled. Nothing is claimed that the product does not
 * do — there are no invented registration numbers, addresses, certifications,
 * insurance schemes, background-check programmes or refund guarantees.
 */
export const termsDocument: LegalDocument = {
  key: 'terms',
  path: '/terms',
  title: 'Terms of Service — SamleyGo Ghana',
  heading: 'Terms of Service',
  navTitle: 'Terms of Service',
  metaTitle: 'Terms of Service | SamleyGo Ghana',
  metaDescription:
    'The terms that govern your access to and use of SamleyGo for food ordering, delivery, errands, rides and partner services in Ghana.',
  summary:
    'Welcome to SamleyGo. These Terms of Service govern your access to and use of the SamleyGo website, installable web application and related services. By accessing or using SamleyGo, you agree to these Terms. If you do not agree, you should not use the services.',
  sections: [
    {
      id: 'about-samleygo',
      title: '1. About SamleyGo',
      blocks: [
        {
          kind: 'p',
          text: "SamleyGo is a digital platform designed to connect customers with participating restaurants, delivery providers, drivers, riders and other service providers for supported services. Where these Terms say \"SamleyGo\", \"we\" or \"us\", we mean the operator of the SamleyGo platform.",
        },
        {
          kind: 'p',
          text: "Depending on availability and the features enabled in your location, SamleyGo may offer:",
        },
        {
          kind: 'list',
          items: [
            'Food discovery and ordering.',
            'Restaurant menus, meal customisation, and additional food items.',
            'Food pickup and delivery.',
            'Motorcycle courier and parcel delivery.',
            'Errands and collection or delivery requests.',
            'Passenger transportation, where enabled.',
            'Car-based delivery services, where enabled.',
            'Driver and courier discovery, booking, and tracking.',
            'Order status updates, notifications, and customer support.',
            'Supported payment and transaction workflows.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Not every service is necessarily available in every location or at all times. What you can request in the app reflects what is configured and operating near you.',
        },
        {
          kind: 'p',
          text: `You can reach our team through the ${supportScreenLink}, by email at ${supportEmailLink} or by phone on ${SUPPORT_PHONE} (alternative ${SUPPORT_PHONE_ALT}).`,
        },
      ],
    },
    {
      id: 'eligibility',
      title: '2. Eligibility and Account Registration',
      blocks: [
        {
          kind: 'list',
          items: [
            'You must provide accurate information when registering or using account-based services.',
            'You are responsible for maintaining the security of your account credentials and for activities performed through your account, subject to applicable law.',
            `You must promptly notify SamleyGo if you suspect unauthorised access to your account, by contacting ${supportScreenLink} or ${supportEmailLink}.`,
            'You must not create fraudulent accounts, impersonate another person, manipulate orders, or use the platform for unlawful purposes.',
          ],
        },
        {
          kind: 'p',
          text: 'Additional eligibility requirements may apply to drivers, riders, restaurant partners and other service providers, including documentation and approval checks required before those accounts can use partner features.',
        },
      ],
    },
    {
      id: 'customer-responsibilities',
      title: '3. Customer Responsibilities',
      blocks: [
        {
          kind: 'p',
          text: 'Customers agree to:',
        },
        {
          kind: 'list',
          items: [
            'Provide accurate contact details.',
            'Provide valid pickup and delivery locations.',
            'Review orders, quantities, extras, prices, and applicable fees before confirmation.',
            'Provide accurate instructions for deliveries and errands.',
            'Ensure someone is available to receive an order where necessary.',
            'Treat restaurant staff, drivers, riders, and support personnel respectfully.',
            'Pay applicable charges for confirmed services.',
            'Avoid fraudulent, abusive, threatening, or unlawful conduct.',
          ],
        },
        {
          kind: 'p',
          text: 'Customers must not use SamleyGo to request prohibited items or unlawful transportation, delivery, or other activities.',
        },
      ],
    },
    {
      id: 'food-ordering',
      title: '4. Food Ordering and Meal Customisation',
      blocks: [
        {
          kind: 'p',
          text: 'Customers may browse participating restaurants, select meals, adjust quantities, and choose available extras.',
        },
        {
          kind: 'p',
          text: 'Additional items may include drinks, sides, sauces, proteins, and other products configured by the restaurant. Some extras can be offered on every meal in a restaurant\'s menu, while others are offered only on the meals the restaurant has chosen. Some groups require at least one selection, and some limit how many options or how much of an option you can add.',
        },
        {
          kind: 'p',
          text: 'The displayed price is based on the menu and options available at the time of the order. Applicable taxes, delivery charges, discounts, and other disclosed fees may affect the final total.',
        },
        {
          kind: 'note',
          tone: 'important',
          title: 'Prices are recalculated before you pay',
          text: 'When you confirm an order, the restaurant\'s system re-checks the price and availability of every meal and extra. If something has changed, you are told before the order is placed rather than being charged a different amount afterwards.',
        },
        {
          kind: 'p',
          text: 'Restaurants are responsible for the accuracy of the menu information they supply, subject to applicable law and SamleyGo\'s platform processes.',
        },
        {
          kind: 'p',
          text: 'An item may become unavailable. Where this affects an order, the available resolution will depend on the circumstances, the order status, and applicable law.',
        },
        {
          kind: 'p',
          text: 'Customers should review the order carefully before confirming payment or submitting an order request. An order that has already been placed can only be changed in the ways the app makes available at that time.',
        },
      ],
    },
    {
      id: 'orders',
      title: '5. Orders, Acceptance, and Cancellation',
      blocks: [
        {
          kind: 'p',
          text: 'Submitting an order or booking request does not necessarily mean that the service provider has accepted it.',
        },
        {
          kind: 'p',
          text: 'An order becomes subject to the applicable fulfilment process once accepted or confirmed through the platform.',
        },
        {
          kind: 'p',
          text: 'Cancellation availability and any applicable charges depend on the order status, the service involved, the disclosed cancellation rules, and applicable law.',
        },
        {
          kind: 'note',
          tone: 'important',
          text: 'Cancelling a request does not automatically reverse a completed payment. Refunds and payment reversals are handled according to the applicable payment process described in section 10.',
        },
        {
          kind: 'p',
          text: 'Where an order has already been prepared, collected, dispatched, or completed, cancellation options may be limited, subject to applicable consumer rights.',
        },
      ],
    },
    {
      id: 'errands-rides-delivery',
      title: '6. Errands, Rides, and Delivery Services',
      blocks: [
        {
          kind: 'p',
          text: 'Where enabled, customers may request motorcycle or car services for eligible trips, parcel delivery, collections, and errands.',
        },
        {
          kind: 'p',
          text: 'Customers must provide accurate pickup and destination information and describe the requested task clearly.',
        },
        {
          kind: 'p',
          text: 'Certain errands may require additional instructions, proof of collection, recipient details, or confirmation of delivery.',
        },
        {
          kind: 'p',
          text: 'SamleyGo may display available drivers or riders, estimated pickup times, route information, and estimated fares. These estimates may change because of traffic, route availability, location accuracy, demand, or other operational conditions.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Where a fare is quoted to you before you book, that quote is produced by SamleyGo\'s pricing system using the route and service you selected. A booking is subject to provider availability and confirmation.',
        },
        {
          kind: 'p',
          text: 'Customers must not request drivers or riders to transport illegal goods, dangerous prohibited items, or anything that would violate applicable law or platform rules.',
        },
      ],
    },
    {
      id: 'service-providers',
      title: '7. Drivers, Riders, and Independent Service Providers',
      blocks: [
        {
          kind: 'p',
          text: "Drivers, riders, and other service providers must satisfy the platform's applicable onboarding, documentation, eligibility, and operational requirements.",
        },
        {
          kind: 'p',
          text: 'They are responsible for maintaining accurate profile and vehicle information, complying with applicable laws, and performing accepted services professionally.',
        },
        {
          kind: 'p',
          text: 'Only approved and eligible providers may access services restricted to approved accounts.',
        },
        {
          kind: 'p',
          text: 'Where service providers operate independently, their relationship with SamleyGo is governed by the applicable provider agreement and relevant law.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'The legal relationship between SamleyGo, customers, restaurants, and service providers must be determined by the actual contractual arrangements and applicable law; this section does not override statutory rights.',
        },
      ],
    },
    {
      id: 'restaurant-partners',
      title: '8. Restaurant Partners',
      blocks: [
        {
          kind: 'p',
          text: 'Participating restaurants are responsible for preparing the items they accept, maintaining accurate menus and prices, communicating availability, and complying with applicable food safety and business requirements.',
        },
        {
          kind: 'p',
          text: 'Restaurant partners must provide accurate order information and must not manipulate prices, misuse customer data, or engage in fraudulent conduct.',
        },
        {
          kind: 'p',
          text: 'Restaurant commissions, settlement arrangements, service fees, and other commercial terms are governed by the applicable restaurant agreement.',
        },
        {
          kind: 'note',
          tone: 'info',
          title: 'Commission is a partner-side charge',
          text: "Any commission SamleyGo charges a restaurant is a commercial term between SamleyGo and that restaurant. It is not added to a customer's bill as a separate customer fee unless it has been disclosed to the customer as part of the price they see.",
        },
      ],
    },
    {
      id: 'fares-fees',
      title: '9. Fares, Fees, and Pricing',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo may calculate delivery charges, ride fares, or errand fees using configured pricing rules, route distance, vehicle category, minimum charges, and other disclosed factors.',
        },
        {
          kind: 'p',
          text: 'Estimated prices should be reviewed before confirmation.',
        },
        {
          kind: 'p',
          text: 'Where a quote is provided, the applicable fare and amendment rules depend on the service and the information disclosed during booking.',
        },
        {
          kind: 'p',
          text: 'No undisclosed charge should be added without an appropriate contractual basis and required customer disclosure.',
        },
        {
          kind: 'p',
          text: 'Restaurant commissions and other partner-side commercial charges are separate from customer-facing fees unless expressly disclosed otherwise.',
        },
      ],
    },
    {
      id: 'payments',
      title: '10. Payments and Refunds',
      blocks: [
        {
          kind: 'p',
          text: 'Customers must use payment methods supported by the applicable service. The methods available to you are shown at checkout and may include mobile money, card, and cash on delivery where those are enabled for the service you are using.',
        },
        {
          kind: 'p',
          text: 'Available methods may vary by location, account, and operational configuration.',
        },
        {
          kind: 'p',
          text: 'Transaction processing may involve authorised third-party payment providers or financial institutions. Those providers process payments under their own terms.',
        },
        {
          kind: 'note',
          tone: 'important',
          title: 'What SamleyGo records',
          text: 'SamleyGo records the amount, status, method and reference of a transaction so an order can be reconciled. Payment credentials such as your card number or mobile money PIN are handled by the payment provider and are not something SamleyGo support staff will ever ask you for.',
        },
        {
          kind: 'p',
          text: 'Refund eligibility, processing times, and dispute handling depend on the transaction, the applicable payment provider, the order status, and applicable law.',
        },
        {
          kind: 'p',
          text: `Contact SamleyGo Support for assistance with a disputed charge, duplicate payment, failed transaction, or eligible refund request — ${supportScreenLink}, ${supportEmailLink} or ${SUPPORT_PHONE}.`,
        },
        {
          kind: 'note',
          tone: 'important',
          title: 'Never share your security codes',
          text: 'Do not share your password, PIN, or one-time authentication codes with anyone claiming to provide support. SamleyGo will never ask for them.',
        },
      ],
    },
    {
      id: 'location',
      title: '11. Location Services and Tracking',
      blocks: [
        {
          kind: 'p',
          text: 'Some services require location access to identify pickup points, calculate routes, discover nearby providers, or display delivery progress.',
        },
        {
          kind: 'p',
          text: 'Customers, drivers, and riders may receive location-related features appropriate to their roles.',
        },
        {
          kind: 'p',
          text: 'Location information should be used only for legitimate service purposes and handled in accordance with the [Privacy Policy](/privacy).',
        },
        {
          kind: 'p',
          text: 'Location estimates can be inaccurate because of GPS limitations, network conditions, map data, and other technical factors.',
        },
      ],
    },
    {
      id: 'prohibited-conduct',
      title: '12. Prohibited Conduct',
      blocks: [
        {
          kind: 'p',
          text: 'Users must not:',
        },
        {
          kind: 'list',
          items: [
            'Commit fraud or make intentionally false bookings.',
            'Harass, threaten, exploit, or discriminate against others.',
            'Circumvent security controls.',
            "Access another user's account without permission.",
            'Interfere with tracking, booking, payment, or pricing systems.',
            'Submit malicious files or exploit application vulnerabilities.',
            'Use the platform to facilitate unlawful activity.',
            'Misuse personal information obtained through a transaction.',
          ],
        },
        {
          kind: 'p',
          text: 'SamleyGo may investigate suspected misuse and take proportionate action, subject to applicable law and relevant contractual procedures.',
        },
      ],
    },
    {
      id: 'availability',
      title: '13. Service Availability and Technical Limitations',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo aims to provide a reliable service but does not guarantee uninterrupted availability, error-free operation, continuous driver availability, or the accuracy of all third-party mapping and estimated arrival information.',
        },
        {
          kind: 'p',
          text: 'Services may be temporarily unavailable due to maintenance, network failures, weather, operational disruptions, or third-party outages.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Nothing in these Terms excludes rights or remedies that cannot lawfully be excluded.',
        },
      ],
    },
    {
      id: 'complaints',
      title: '14. Complaints and Disputes',
      blocks: [
        {
          kind: 'p',
          text: 'Customers, restaurant partners, and service providers should contact SamleyGo Support with relevant order IDs, booking references, transaction details, or other information necessary to investigate a complaint.',
        },
        {
          kind: 'p',
          text: 'SamleyGo will review complaints and communicate available next steps.',
        },
        {
          kind: 'p',
          text: 'Nothing in these Terms removes any right a consumer may have under applicable Ghanaian law.',
        },
      ],
    },
    {
      id: 'suspension',
      title: '15. Suspension and Termination',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo may restrict or suspend an account where reasonably necessary to address suspected fraud, safety concerns, security incidents, unlawful activity, or material violations of these Terms.',
        },
        {
          kind: 'p',
          text: 'Where appropriate and lawful, the affected user may be informed of the reason and available review process.',
        },
        {
          kind: 'p',
          text: 'Users may stop using the service and may request account-related assistance through Support.',
        },
        {
          kind: 'p',
          text: 'Account closure does not automatically remove records that SamleyGo must retain for legal, security, financial, dispute-resolution, or other lawful purposes.',
        },
      ],
    },
    {
      id: 'intellectual-property',
      title: '16. Intellectual Property',
      blocks: [
        {
          kind: 'p',
          text: 'The SamleyGo name, branding, software, design, and original platform content are protected by applicable intellectual property laws.',
        },
        {
          kind: 'p',
          text: 'Users may not copy, modify, redistribute, reverse engineer, or commercially exploit protected platform materials except as permitted by law or with appropriate authorisation.',
        },
        {
          kind: 'p',
          text: 'Third-party trademarks and content remain the property of their respective owners.',
        },
      ],
    },
    {
      id: 'privacy',
      title: '17. Privacy',
      blocks: [
        {
          kind: 'p',
          text: 'Use of SamleyGo is also governed by the SamleyGo [Privacy Policy](/privacy), which explains how personal information is collected, used, stored, and disclosed.',
        },
      ],
    },
    {
      id: 'changes',
      title: '18. Changes to These Terms',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo may update these Terms to reflect changes in its services, operational practices, or legal requirements.',
        },
        {
          kind: 'p',
          text: 'Material changes will be communicated through appropriate channels where required.',
        },
        {
          kind: 'p',
          text: 'The effective date will be updated when a revised version is published.',
        },
      ],
    },
    {
      id: 'governing-law',
      title: '19. Governing Law',
      blocks: [
        {
          kind: 'p',
          text: 'These Terms are intended to operate in accordance with the laws of Ghana, subject to applicable mandatory consumer protections and other applicable legal requirements.',
        },
        {
          kind: 'p',
          text: 'Disputes will be handled through the appropriate legal or dispute-resolution process under applicable law.',
        },
      ],
    },
    {
      id: 'contact',
      title: '20. Contact',
      blocks: [
        {
          kind: 'p',
          text: 'For questions about these Terms, contact SamleyGo Support:',
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
              definition: `${supportScreenLink} — see [Help & Support](/support) for what to include.`,
            },
          ],
        },
      ],
    },
  ],
};
