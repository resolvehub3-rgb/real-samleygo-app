import type { LegalDocument } from '../types';

/**
 * Privacy Policy — every technical claim here was checked against the shipped
 * implementation: no analytics vendors, no cookies, no background tracking,
 * no card storage, and location use limited to what the product actually does.
 */
export const privacyDocument: LegalDocument = {
  key: 'privacy',
  path: '/privacy',
  title: 'Privacy Policy — SamleyGo Ghana',
  heading: 'Privacy Policy',
  navTitle: 'Privacy Policy',
  metaTitle: 'Privacy Policy | SamleyGo Ghana',
  metaDescription:
    'How SamleyGo collects, uses, stores and shares personal information — including account, order, location and payment data — in Ghana.',
  summary:
    'This Privacy Policy explains what personal information SamleyGo collects when you use our food marketplace and delivery platform, why we use it, who we share it with, how long we keep it and the choices available to you. It should be read together with our Terms of Service and Cookie Policy.',
  sections: [
    {
      id: 'introduction',
      title: '1. Introduction',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo is a technology-enabled food marketplace and delivery platform operating in Ghana. To run it we need certain personal information about the people who use it: customers, restaurant partners and couriers.',
        },
        {
          kind: 'p',
          text: 'SamleyGo seeks to process personal information in accordance with applicable data-protection laws and regulations of the Republic of Ghana, including the Data Protection Act, 2012 (Act 843). This policy describes our actual practices and is a production document subject to review by qualified Ghanaian legal and privacy professionals.',
        },
        {
          kind: 'p',
          text: 'Where this policy says "we", "us" or "SamleyGo", we mean the entity operating the SamleyGo platform. Questions about this policy can be sent to [support@samleygo.com.gh](mailto:support@samleygo.com.gh).',
        },
      ],
    },
    {
      id: 'scope',
      title: '2. Scope',
      blocks: [
        {
          kind: 'p',
          text: 'This policy applies to personal information processed through the SamleyGo website, progressive web app and related services, and to the account, ordering, delivery and partner functions within them.',
        },
        {
          kind: 'list',
          items: [
            'It applies to customers, visitors, restaurant partners, couriers and anyone who contacts our support team.',
            'It does not cover a third party\'s own website or service — for example a mapping or payment provider\'s own handling of data under its own policy.',
            'Restaurant partners act as independent controllers of customer information they receive for fulfilling an order (such as the delivery address and order contents) and should have their own privacy practices.',
          ],
        },
      ],
    },
    {
      id: 'information-we-collect',
      title: '3. Information We Collect',
      blocks: [
        {
          kind: 'p',
          text: 'What we collect depends on how you interact with SamleyGo. Depending on your use, information may include:',
        },
        {
          kind: 'list',
          items: [
            'Account: name, email address, phone number and authentication identifiers.',
            'Order: order details, restaurant, food items, delivery address, order status and order history.',
            'Location: GPS coordinates, pickup coordinates, delivery coordinates, and courier location during applicable active delivery functionality.',
            'Technical: IP address, browser, device, operating system, application information, diagnostic information and security information.',
            'Communications: support requests, complaints, feedback and order-related communications.',
            'Payments: transaction references, payment status and payment method information received from payment providers.',
          ],
        },
        {
          kind: 'p',
          text: 'Sections 4 to 8 describe each category in more detail.',
        },
      ],
    },
    {
      id: 'account-information',
      title: '4. Account Information',
      blocks: [
        {
          kind: 'p',
          text: 'When you register we collect the details you provide: your name, email address, phone number and the role you choose (customer, courier or restaurant owner). Sign-in is handled by our authentication provider using your email address and password.',
        },
        {
          kind: 'list',
          items: [
            'You may add a profile photograph, which is stored with your profile and shown to relevant parties (for example your courier or restaurant identity).',
            'Restaurant partners additionally provide a business name, contact details, address and location pin for their kitchen.',
            'Couriers additionally provide vehicle details and, for verification, identity documents such as a Ghana Card or driving licence number and an image of the document.',
            'A profile record is created automatically when you register, and is linked to your authentication record.',
          ],
        },
        {
          kind: 'p',
          text: 'Please do not provide another person\'s information without their knowledge, and keep your own details current.',
        },
      ],
    },
    {
      id: 'order-transaction',
      title: '5. Order and Transaction Information',
      blocks: [
        {
          kind: 'p',
          text: 'When you place an order we record the information needed to fulfil and account for it:',
        },
        {
          kind: 'list',
          items: [
            'the items ordered, quantities, any notes you add and the restaurant you ordered from;',
            'the delivery address, contact number and any delivery notes you provide;',
            'order status and its history as the order progresses from acceptance to completion;',
            'the amounts involved — food subtotal, delivery fee, optional tip and total in Ghana Cedis;',
            'the payment method selected, the payment status and a payment reference for the order.',
          ],
        },
        {
          kind: 'p',
          text: 'Order records are linked to your account and are visible to you, to the restaurant fulfilling the order and to the courier delivering it, as needed to complete it.',
        },
      ],
    },
    {
      id: 'location-information',
      title: '6. Location Information',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo uses location information in a limited, purpose-specific way. Your device asks for permission before any location is read, and you can withdraw that permission at any time in your browser or device settings.',
        },
        {
          kind: 'list',
          items: [
            'Delivery address coordinates: when you place an order, the coordinates for the delivery point are stored with the order so the delivery can be routed, priced and completed.',
            'Pickup coordinates: the restaurant\'s pinned location is used as the collection point.',
            'Pricing snapshot: a short-lived record linking pickup and delivery coordinates to a calculated delivery fee is created when a fee is quoted, expires after a few minutes, and unused records are cleaned up.',
            'Customer live location: while you use the home or checkout screens, your device may show your current position to help you choose an address. This live reading is used on your device and label is saved on your device; it is not continuously uploaded to us.',
            'Courier location: a courier who switches themselves online shares their position so deliveries can be assigned, routed and tracked — see section 11.',
          ],
        },
        {
          kind: 'p',
          text: 'SamleyGo does not collect location in the background of your device outside the app, and does not run location tracking from the service worker or any other background component.',
        },
      ],
    },
    {
      id: 'device-technical',
      title: '7. Device and Technical Information',
      blocks: [
        {
          kind: 'p',
          text: 'Like most online services, we receive technical information when the app is opened, such as your IP address, browser and device type, operating system, screen size and basic diagnostic information from errors.',
        },
        {
          kind: 'list',
          items: [
            'This information is used to deliver and secure the service, to adapt the interface to your screen and to diagnose problems.',
            'SamleyGo does not run third-party analytics, advertising pixels or session-replay tools. We do not build advertising profiles about you.',
            'Our progressive web app stores a small amount of data locally in your browser so it can open quickly and work offline — see the [Cookie Policy](/cookies).',
          ],
        },
      ],
    },
    {
      id: 'communications-support',
      title: '8. Communications and Support Data',
      blocks: [
        {
          kind: 'p',
          text: 'When you contact us — through the in-app support screen, by email or by phone — we collect what you tell us: your name, the contact details you use, order references, complaints, feedback and any documents you send.',
        },
        {
          kind: 'p',
          text: 'Support conversations are kept so we can resolve your issue, follow up, and understand recurring problems. Order-related messages you send to a restaurant or courier through the platform are part of the order record.',
        },
        {
          kind: 'p',
          text: 'We also record service notifications generated by the platform — such as a new order for a restaurant or a delivery request for a courier — in your in-app notification list.',
        },
      ],
    },
    {
      id: 'how-we-use',
      title: '9. How We Use Personal Information',
      blocks: [
        {
          kind: 'p',
          text: 'We use personal information to:',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'create and manage your account and keep you signed in securely;',
            'take, fulfil, deliver and track orders, and show you their status;',
            'calculate delivery distance and fees, and assign couriers;',
            'process payments, keep transaction records and handle refunds;',
            'communicate with you about orders, support requests and account security;',
            'operate restaurant and courier partner functions, including verification and earnings;',
            'detect, prevent and investigate fraud, misuse, safety issues and security incidents;',
            'improve, secure and troubleshoot the platform; and',
            'comply with legal obligations and enforce our agreements.',
          ],
        },
        {
          kind: 'p',
          text: 'We do not sell your personal information, and we do not use it for automated decisions that produce legal or similarly significant effects about you.',
        },
      ],
    },
    {
      id: 'legal-purposes',
      title: '10. Legal/Business Purposes for Processing',
      blocks: [
        {
          kind: 'p',
          text: 'We process personal information on the basis of one or more of the following, depending on the circumstances:',
        },
        {
          kind: 'list',
          items: [
            'to perform our contract with you — for example to place and deliver the order you asked for;',
            'your consent — for example when your browser asks permission to use your location and you allow it (you may withdraw consent at any time without affecting earlier lawful processing);',
            'legitimate interests — such as securing the platform, preventing fraud, improving the service and communicating about an order you placed, balanced against your rights;',
            'legal obligations — where applicable law requires us to keep records or respond to lawful requests.',
          ],
        },
      ],
    },
    {
      id: 'location-processing',
      title: '11. Location Data Processing',
      blocks: [
        {
          kind: 'p',
          text: 'Location data is personal information. This section describes exactly how it flows through the platform.',
        },
        {
          kind: 'sub',
          title: 'Customers',
          blocks: [
            {
              kind: 'list',
              items: [
                'Your device requests a position only when you allow it on the home screen, tap "use my location", or use it at checkout. Your browser will ask for permission first.',
                'The coordinates are used to label your delivery point, calculate the distance and fee, and are stored with the order you place.',
                'A live reading while those screens are open is used to show your current area; it stays on your device unless you confirm it as your delivery address with an order.',
                'Choosing a saved or popular area instead of your device location means your coordinates are not used for that order.',
              ],
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Couriers',
          blocks: [
            {
              kind: 'list',
              items: [
                'A courier\'s device shares position only while they are switched online in the courier app and while that screen is open; switching off stops it.',
                'The current position is written to the platform roughly every 10 seconds during an active delivery and less often (about every 25 seconds) when between deliveries.',
                'During an active delivery, position breadcrumbs are recorded for that order approximately once a minute so the customer, restaurant and support can follow the trip.',
                'A courier\'s most recent reported position remains on the platform after they go offline until it is next updated or removed.',
              ],
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Where location goes',
          blocks: [
            {
              kind: 'p',
              text: 'Coordinates are stored in our cloud database and are shared only as needed with the parties to the delivery (the customer, the restaurant, the courier and our operations team) and with the routing service used to calculate a route. See section 14 for third parties.',
            },
          ],
        },
      ],
    },
    {
      id: 'payments-providers',
      title: '12. Payments and Payment Providers',
      blocks: [
        {
          kind: 'p',
          text: 'Payments for orders are made in Ghana Cedis using the methods shown at checkout, which may include mobile money wallets, bank card and cash on delivery.',
        },
        {
          kind: 'list',
          items: [
            'SamleyGo records the amount, currency, payment method, status and a payment reference against the order, and may record the mobile money wallet number you provide.',
            'SamleyGo does not ask for or store card numbers, card security codes or mobile money PINs. Those credentials are entered only with your payment provider.',
            'Where a payment provider processes a transaction for us, it receives the information needed to complete it (for example amount, currency and reference) and handles data under its own policy.',
            'Payment records are used to prove what was ordered and paid, to reconcile transactions and to handle refunds.',
          ],
        },
        {
          kind: 'p',
          text: 'Further detail is in our [Payment Policy](/payment-policy).',
        },
      ],
    },
    {
      id: 'restaurants-couriers',
      title: '13. Restaurants and Delivery Couriers',
      blocks: [
        {
          kind: 'p',
          text: 'To complete an order we share the information each party needs, and no more:',
        },
        {
          kind: 'list',
          items: [
            'The restaurant receives your order contents, delivery address, contact number and any notes you add, so it can prepare and hand over the order.',
            'The courier assigned to your order receives the pickup and drop-off locations, the customer contact number and the order reference, so they can collect, navigate and deliver.',
            'You see the courier\'s name, photo (if provided), vehicle details and — during an active delivery — their reported position and progress.',
            'Restaurant partners see their own orders, their own listing information and customer details for those orders only.',
            'Couriers see the deliveries assigned or available to them, and their own earnings records.',
          ],
        },
        {
          kind: 'p',
          text: 'Restaurant partners and couriers must use this information only to complete the order and must keep it confidential — this is part of their partner terms.',
        },
      ],
    },
    {
      id: 'service-providers',
      title: '14. Service Providers and Data Processors',
      blocks: [
        {
          kind: 'p',
          text: 'We use a small number of service providers to run the platform. They process information for us under their own terms and, where applicable, their own privacy policies:',
        },
        {
          kind: 'terms',
          items: [
            {
              term: 'Cloud application platform',
              definition:
                'Hosts the database, authentication, file storage and live-update service. Application data — profiles, orders, payments, courier verification documents and notifications — is stored here.',
            },
            {
              term: 'Mapping and address search',
              definition:
                'Used to render maps, to suggest addresses as you type (the text you type is sent for suggestions) and to convert coordinates into readable addresses.',
            },
            {
              term: 'Routing service',
              definition:
                'Used to calculate a road route and distance between a pickup point and a delivery point; the coordinates for that trip are sent for the calculation.',
            },
            {
              term: 'Hosting and delivery network',
              definition:
                'Serves the application files and receives ordinary web request information such as your IP address.',
            },
            {
              term: 'Web fonts',
              definition:
                'The typeface used by the interface is loaded from a font service, which receives a standard web request.',
            },
          ],
        },
        {
          kind: 'p',
          text: 'We do not sell personal information and we do not share it with advertising or analytics networks, because we do not use them.',
        },
      ],
    },
    {
      id: 'cookies',
      title: '15. Cookies and Similar Technologies',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo\'s application does not set first-party cookies. Instead it uses browser storage — localStorage and sessionStorage — and a cached application shell so the platform opens quickly and remembers your basket and preferences between visits.',
        },
        {
          kind: 'list',
          items: [
            'Your sign-in session is kept in your browser\'s local storage so you stay signed in; signing out clears it.',
            'Your basket, chosen delivery area and interface preferences (such as sound and navigation voice settings) are stored locally on your device.',
            'A cached copy of the application\'s own files is kept so it loads faster and can open without a network connection.',
            'Third-party services embedded in the platform, such as maps, may use their own storage or cookies under their own policies.',
          ],
        },
        {
          kind: 'p',
          text: 'Full detail, including how to clear this data, is in our [Cookie Policy](/cookies).',
        },
      ],
    },
    {
      id: 'analytics',
      title: '16. Analytics and Technical Monitoring',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo does not currently use third-party analytics, advertising, heat-mapping, session-replay or crash-reporting tools. We do not track your activity across other websites and do not build advertising profiles.',
        },
        {
          kind: 'p',
          text: 'We do record operational information generated by the platform itself — for example order and status history, audit entries for sensitive administrative actions (such as a recorded refund or a pricing change), and errors reported by the app — so that we can operate, secure and troubleshoot the service.',
        },
        {
          kind: 'p',
          text: 'If we introduce analytics or similar tools in future, we will update this policy before we do, and offer any choice that the law requires.',
        },
      ],
    },
    {
      id: 'security',
      title: '17. Data Security',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo implements technical and organizational safeguards designed to protect personal information against unauthorized access, alteration, disclosure, loss or misuse. These include:',
        },
        {
          kind: 'list',
          items: [
            'encrypted transport — the application and API communicate over HTTPS/TLS;',
            'authentication — accounts are accessed with verified email and password sign-in through our authentication provider;',
            'authorization — access to records is governed by database-level access-control policies, including Row Level Security, so that a signed-in user reaches only the data their role and their own records allow;',
            'server-side validation — sensitive financial and pricing calculations are performed and enforced in the database, not in the browser;',
            'restricted file storage — courier identity documents are kept in private storage that only the owner and administrators can read, and links to private files expire after a short period;',
            'secrets management — database administration credentials and other secrets are kept in server-side environment configuration and are never included in the application bundle;',
            'least-privilege principles and audit logging for sensitive administrative actions.',
          ],
        },
        {
          kind: 'p',
          text: 'No method of transmission or storage is completely secure. We cannot guarantee that unauthorized access will never occur, and we do not claim that our safeguards eliminate all risk. If we become aware of an incident affecting your personal information, we will investigate and respond, and notify you and the relevant authorities as required by applicable law.',
        },
      ],
    },
    {
      id: 'database-access',
      title: '18. Database Access Controls',
      blocks: [
        {
          kind: 'p',
          text: 'Application data is stored in a managed PostgreSQL database. Access is controlled at several levels:',
        },
        {
          kind: 'list',
          items: [
            'Application users connect using their own session — not a shared administrator credential — and every request is evaluated against that identity.',
            'The administrative database credential used for privileged operations is held outside the application code and is never shipped to browsers or devices.',
            'Table, column and row access is granted only where a policy or role allows it; identity documents and internal audit records are restricted to the people they concern and to administrators.',
            'Storage buckets are configured so that courier verification documents are private while profile and restaurant images intended for display are public.',
          ],
        },
      ],
    },
    {
      id: 'row-level-security',
      title: '19. Row Level Security',
      blocks: [
        {
          kind: 'p',
          text: 'Row Level Security (RLS) is a database feature that evaluates every query against the identity making it and allows or denies the rows it would return. SamleyGo enables it across the tables that hold personal and operational data, with policies that follow the shape of the platform:',
        },
        {
          kind: 'list',
          items: [
            'you can see and manage your own profile and notifications;',
            'an order is visible to its customer, its courier, the fulfilling restaurant and administrators — not to unrelated users;',
            'couriers can record delivery positions only for themselves, and those positions are read only by the parties to that delivery;',
            'courier identity documents are readable only by the courier who owns them and by administrators;',
            'platform configuration is readable by the application but writable only by administrators, and audit records are readable only by administrators.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          title: 'What RLS does and does not do',
          text: 'RLS is an important control that enforces data access inside the database itself, rather than relying only on the interface. It is one layer among several — it does not make data "completely secure", and it does not replace strong passwords, secure devices or good operational practices.',
        },
      ],
    },
    {
      id: 'retention',
      title: '20. Data Retention',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo retains personal information only for as long as reasonably necessary to provide services, maintain transaction and business records, resolve disputes, prevent fraud, maintain security, comply with legal obligations, and enforce applicable agreements.',
        },
        {
          kind: 'list',
          items: [
            'Account information is kept while your account is open, and for a reasonable period afterwards where records are still needed.',
            'Order and payment records are kept as transaction and business records, because you, the restaurant and we may need them to resolve a dispute, issue a refund or satisfy an accounting or legal requirement.',
            'Short-lived technical records expire on their own — delivery fee quotes, for example, expire within minutes and unused quotes are cleaned up shortly after.',
            'Courier position breadcrumbs are linked to their delivery and are retained as part of the delivery record; a courier\'s most recent position stays on file until it is updated or removed.',
            'Support correspondence is kept long enough to resolve the matter and to understand recurring issues.',
          ],
        },
        {
          kind: 'p',
          text: 'We do not currently apply a fixed public retention period to account or order records. Where a record is no longer needed, we delete it or anonymise it; where we must keep it (for example a transaction record required for accounting, fraud prevention or a legal claim), we restrict its use to that purpose. If you would like to know more about a specific record, contact us.',
        },
      ],
    },
    {
      id: 'data-sharing',
      title: '21. Data Sharing',
      blocks: [
        {
          kind: 'p',
          text: 'We share personal information only where it has a purpose:',
        },
        {
          kind: 'list',
          items: [
            'with the restaurant fulfilling your order, to prepare and hand it over;',
            'with the courier delivering your order, to collect and deliver it;',
            'with service providers who process data for us under appropriate terms (section 14);',
            'with our own team where they need it to operate, support or secure the platform;',
            'with authorities, or where required by law, a court order, or to protect the safety of a person or the integrity of the platform;',
            'in connection with a business reorganisation, subject to the same standards of protection.',
          ],
        },
        {
          kind: 'p',
          text: 'We do not sell personal information, do not rent it out, and do not share it with advertising networks.',
        },
      ],
    },
    {
      id: 'international-transfers',
      title: '22. International Data Transfers',
      blocks: [
        {
          kind: 'p',
          text: 'Our platform runs on cloud infrastructure and uses service providers that may process information on servers located outside Ghana — for example in the region where our database and mapping services are hosted.',
        },
        {
          kind: 'p',
          text: 'Where information is transferred outside Ghana, we take steps designed to keep it protected — using providers with contractual privacy commitments and the technical safeguards described in section 17 — and we handle it consistently with this policy and applicable Ghanaian law.',
        },
        {
          kind: 'p',
          text: 'You can ask us for more information about where your information is stored by contacting [support@samleygo.com.gh](mailto:support@samleygo.com.gh).',
        },
      ],
    },
    {
      id: 'your-rights',
      title: '23. User Privacy Rights',
      blocks: [
        {
          kind: 'p',
          text: 'Subject to applicable law — including the Data Protection Act, 2012 (Act 843) — and to the limitations described below, you may have the right to:',
        },
        {
          kind: 'list',
          items: [
            'access the personal information we hold about you and ask how it is used;',
            'correct information that is inaccurate or out of date;',
            'request deletion of information we no longer have a lawful reason to keep;',
            'object to, or request restriction of, certain processing;',
            'withdraw consent where processing is based on consent (for example, turning off location permission in your device settings);',
            'make a privacy inquiry or complaint, and escalate it if you are not satisfied.',
          ],
        },
        {
          kind: 'p',
          text: 'Some requests can be completed directly in the app — you can edit your profile details, decline location permission, or sign out at any time. Other requests should be sent to [support@samleygo.com.gh](mailto:support@samleygo.com.gh).',
        },
        {
          kind: 'p',
          text: 'Rights to access, correction and deletion are not absolute. We may decline or limit a request where applicable law permits — for example where information must be retained for a legal obligation, an ongoing transaction or dispute, fraud prevention, or the rights of another person. If we decline a request, we will explain why.',
        },
        {
          kind: 'p',
          text: 'We may need to verify your identity before acting on a request, so that we do not disclose your information to the wrong person.',
        },
      ],
    },
    {
      id: 'account-deletion',
      title: '24. Account Deletion',
      blocks: [
        {
          kind: 'p',
          text: 'You may ask us to close your account and delete your personal information by emailing [support@samleygo.com.gh](mailto:support@samleygo.com.gh) from the address registered to the account. There is no self-service delete button in the app today, so we handle these requests ourselves.',
        },
        {
          kind: 'list',
          items: [
            'We will confirm the request, verify that it comes from you, and act on it within a reasonable time.',
            'Where deletion is not possible — because an order or transaction record must be kept for accounting, legal, fraud-prevention or dispute purposes — we will retain only what is necessary for those purposes and restrict its use.',
            'Some information is removed rather than erased: for example, a profile can be de-identified while the financial record of an order is preserved.',
            'Deleting the app from your device does not close your account or remove information already held on our systems.',
          ],
        },
      ],
    },
    {
      id: 'children',
      title: "25. Children's Privacy",
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo is not directed at children. Our services are intended for adults, and we do not knowingly collect personal information from children.',
        },
        {
          kind: 'p',
          text: 'If you believe a child has provided personal information to us, please contact [support@samleygo.com.gh](mailto:support@samleygo.com.gh) and we will investigate and take appropriate action, including deleting the information where we are not required to keep it.',
        },
      ],
    },
    {
      id: 'incidents',
      title: '26. Security Incident Handling',
      blocks: [
        {
          kind: 'p',
          text: 'If we become aware of a security incident affecting your personal information, we will:',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'investigate promptly and work to contain the incident;',
            'assess what information was affected and who is at risk;',
            'take remedial action, including strengthening the control that failed;',
            'notify affected individuals and the relevant regulator where applicable law requires it, with enough information for you to protect yourself;',
            'record the incident internally for review and follow-up.',
          ],
        },
        {
          kind: 'p',
          text: 'If you believe your account or information has been compromised, contact [support@samleygo.com.gh](mailto:support@samleygo.com.gh) immediately and change your password.',
        },
      ],
    },
    {
      id: 'changes',
      title: '27. Changes to This Privacy Policy',
      blocks: [
        {
          kind: 'p',
          text: 'We may update this policy to reflect changes in the platform, our practices or the law. The date at the top of the document shows when it was last updated.',
        },
        {
          kind: 'p',
          text: 'Where a change is material, we will give reasonable notice — for example in the platform or by email. We encourage you to review this page from time to time.',
        },
      ],
    },
    {
      id: 'contact',
      title: '28. Contact and Privacy Requests',
      blocks: [
        {
          kind: 'terms',
          items: [
            {
              term: 'Privacy requests (access, correction, deletion, complaints)',
              definition: '[support@samleygo.com.gh](mailto:support@samleygo.com.gh), marked "Privacy".',
            },
            {
              term: 'General support',
              definition:
                'In-app [Support screen](/support) or +233 (0) 30 200 4567.',
            },
            {
              term: 'Documents that form part of this policy',
              definition:
                '[Terms of Service](/terms) · [Cookie Policy](/cookies) · [Refund & Cancellation Policy](/refunds) · [Payment Policy](/payment-policy) · [Acceptable Use Policy](/acceptable-use).',
            },
          ],
        },
        {
          kind: 'p',
          text: 'Please include the email address registered to your account and enough detail for us to locate your information. We will acknowledge your request and respond within a reasonable time.',
        },
      ],
    },
  ],
};
