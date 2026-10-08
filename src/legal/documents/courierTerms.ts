import type { LegalDocument } from '../types';

/** Courier / Delivery Partner Terms — onboarding, GPS duties, earnings and conduct. */
export const courierTermsDocument: LegalDocument = {
  key: 'courier-partner-terms',
  path: '/courier-partner-terms',
  title: 'Courier / Delivery Partner Terms — SamleyGo Ghana',
  heading: 'Courier / Delivery Partner Terms',
  navTitle: 'Courier Partner Terms',
  metaTitle: 'Courier / Delivery Partner Terms | SamleyGo Ghana',
  metaDescription:
    'The terms that apply to couriers delivering with SamleyGo in Ghana: onboarding, verification, GPS, delivery duties, earnings and conduct.',
  summary:
    'These terms apply to delivery couriers who carry out orders on SamleyGo. They cover onboarding and verification, using your device location while online, how collections and deliveries work, how earnings are recorded, and the conduct and safety standards we expect.',
  sections: [
    {
      id: 'about',
      title: '1. About These Terms',
      blocks: [
        {
          kind: 'p',
          text: 'These Courier / Delivery Partner Terms are a supplement to, and form part of, the SamleyGo [Terms of Service](/terms). They apply to you if you register as a courier and are approved to carry out deliveries.',
        },
        {
          kind: 'p',
          text: 'SamleyGo provides the technology that matches you to deliveries, tracks them and records what you earn. You decide for yourself whether to go online and which deliveries to take on, subject to the standards in these terms.',
        },
        {
          kind: 'note',
          tone: 'info',
          title: 'Your working status',
          text: 'These terms describe an independent delivery arrangement: you are not an employee of a restaurant or of the customer. Your own status under Ghanaian law depends on the actual working arrangement and any contract you have signed with us — if you are unsure, ask us before accepting these terms.',
        },
      ],
    },
    {
      id: 'onboarding',
      title: '2. Onboarding',
      blocks: [
        {
          kind: 'p',
          text: 'To become a courier you register through the sign-up screen, choose the courier role and provide the information requested.',
        },
        {
          kind: 'list',
          items: [
            'Your real full name and contact details, so customers and support can reach you.',
            'Vehicle details, including the type and plate where applicable.',
            'The identity documents required for verification (see section 3).',
            'A profile photograph where one is requested.',
            'Accurate information throughout — providing false information is a serious breach and may be reported.',
          ],
        },
        {
          kind: 'p',
          text: 'Registration is not approval. Your account becomes eligible to receive deliveries once an administrator has reviewed and approved your verification.',
        },
      ],
    },
    {
      id: 'verification',
      title: '3. Identity Verification and Documents',
      blocks: [
        {
          kind: 'p',
          text: 'We verify couriers before they carry out deliveries. You may be asked for:',
        },
        {
          kind: 'list',
          items: [
            'a Ghana Card number and a photograph of the card;',
            'a driving licence number and photograph where you use a vehicle that requires one;',
            'vehicle registration details and photographs where applicable;',
            'any other document we reasonably ask for to complete verification.',
          ],
        },
        {
          kind: 'list',
          items: [
            'Document images are stored in private storage that only you and administrators can access; links used to view them expire quickly.',
            'Documents are used for verification, fraud prevention and legal compliance only.',
            'Tell us promptly if any document expires, is replaced or is surrendered so we can update or suspend your account.',
            'Never upload a document belonging to another person.',
          ],
        },
      ],
    },
    {
      id: 'vehicle',
      title: '4. Vehicle Requirements',
      blocks: [
        {
          kind: 'list',
          items: [
            'You must be legally entitled to operate whatever vehicle you use.',
            'The vehicle must be roadworthy, appropriately registered and insured where insurance is required.',
            'You must carry any licence, permit or protective equipment applicable to the work in your area.',
            'Tell us when your vehicle details change, and stop delivering if your vehicle becomes unsafe.',
            'Delivery methods other than a registered vehicle (for example walking or cycling where offered) are subject to what we enable for your area.',
          ],
        },
      ],
    },
    {
      id: 'road-safety',
      title: '5. Road Safety',
      blocks: [
        {
          kind: 'p',
          text: 'Safety comes before speed. You must:',
        },
        {
          kind: 'list',
          items: [
            'obey the Highway Code and all applicable road traffic laws;',
            'wear appropriate protective gear where it is required;',
            'never ride or drive while under the influence of alcohol or drugs;',
            'never read, type or send messages on your phone while moving — stop somewhere safe first;',
            'carry the order securely so it cannot fall or spill;',
            'not carry passengers or loads that are unsafe or unlawful;',
            'prioritise your safety and that of others over an arrival time.',
          ],
        },
        {
          kind: 'p',
          text: 'A late delivery is always preferable to an accident. If you are unsafe to continue, go offline and tell us.',
        },
      ],
    },
    {
      id: 'online-gps',
      title: '6. Going Online and Location Sharing',
      blocks: [
        {
          kind: 'p',
          text: 'Location is how deliveries are matched, routed and tracked. When you switch yourself online in the courier app and keep that screen open:',
        },
        {
          kind: 'list',
          items: [
            'your device shares your position so you can be matched to nearby orders;',
            'your position is reported to the platform roughly every 10 seconds during an active delivery and less often (about every 25 seconds) between deliveries;',
            'during an active delivery, position points for that trip are recorded about once a minute so the customer and support can follow progress;',
            'sharing stops when you switch off or leave the courier dashboard;',
            'a last reported position remains on file until it is next updated or removed.',
          ],
        },
        {
          kind: 'list',
          items: [
            'Location permission must be granted for the courier app to work; withdraw it and you will not receive deliveries.',
            'Never spoof, fake or interfere with your reported position — this is a serious breach (section 15).',
            'Do not use position information about customers or couriers for any purpose other than the delivery in front of you.',
          ],
        },
        {
          kind: 'p',
          text: 'How location is handled is described in the [Privacy Policy](/privacy) and the [Delivery Policy](/delivery-policy).',
        },
      ],
    },
    {
      id: 'accepting-orders',
      title: '7. Order Acceptance and Assignment',
      blocks: [
        {
          kind: 'p',
          text: 'Deliveries reach you in two ways: you can pick up an available delivery, or a delivery can be assigned to you (for example by the restaurant or the platform).',
        },
        {
          kind: 'list',
          items: [
            'Only accept a delivery you can realistically complete safely and on time.',
            'Once accepted, commit to it — dropping a delivery without a good reason harms the customer and the restaurant.',
            'If you can no longer complete a delivery, release it as early as possible so it can be reassigned.',
            'Do not accept deliveries for someone else, and do not let an unapproved person deliver on your account.',
            'Check the order details and any delivery notes when you accept.',
          ],
        },
      ],
    },
    {
      id: 'pickup',
      title: '8. Collection',
      blocks: [
        {
          kind: 'list',
          items: [
            'Go to the pickup point shown — the restaurant\'s pinned location.',
            'Identify the order by its reference and check the package against the order before leaving.',
            'If the order appears incomplete, damaged or wrong, resolve it at the restaurant before departing, and contact support if it cannot be resolved.',
            'Confirm collection in the app — that confirmation is what tells the customer the journey has started.',
            'Wait a reasonable time if the restaurant is still preparing; if the wait is unreasonable, tell us.',
          ],
        },
      ],
    },
    {
      id: 'delivery',
      title: '9. Delivery and Handover',
      blocks: [
        {
          kind: 'list',
          items: [
            'Navigate to the delivery address, following the calculated route or your own navigation.',
            'Contact the customer when you are close if you cannot find the exact drop-off point.',
            'Hand the order to the customer, or to someone they have arranged to receive it.',
            'Confirm delivery in the app only when the order has actually been handed over.',
            'Keep the order in your possession until handover — never leave it unattended unless the customer has explicitly asked you to and it is safe to do so.',
          ],
        },
        {
          kind: 'p',
          text: 'If you cannot complete the delivery, follow the failed-delivery steps in the [Delivery Policy](/delivery-policy) and contact support.',
        },
      ],
    },
    {
      id: 'communication',
      title: '10. Customer Communication',
      blocks: [
        {
          kind: 'list',
          items: [
            'Be polite, clear and professional at all times.',
            'Use the contact details shown for the order only for that delivery.',
            'Keep conversation focused on completing the delivery; do not solicit personal contact or dates, and do not share your own or the customer\'s details afterwards.',
            'Do not call or message a customer after the delivery is complete except about that delivery.',
            'If a conversation becomes abusive, end it and report it to support.',
          ],
        },
      ],
    },
    {
      id: 'proof',
      title: '11. Proof of Delivery',
      blocks: [
        {
          kind: 'p',
          text: 'Your confirmation in the app, together with the recorded positions for the trip and the order\'s status history, forms the record that the delivery was completed.',
        },
        {
          kind: 'list',
          items: [
            'Confirm handover only when you have actually handed the order over.',
            'If the customer asked you to leave it with someone else, note that before confirming.',
            'Do not confirm a delivery you have not made — claiming a delivery that did not happen is fraud (section 15 and the [Acceptable Use Policy](/acceptable-use)).',
            'Keep your profile photograph and vehicle details current so customers can recognise you.',
          ],
        },
      ],
    },
    {
      id: 'earnings',
      title: '12. Earnings and Delivery Fees',
      blocks: [
        {
          kind: 'p',
          text: 'You earn from the deliveries you complete. Each completed delivery records an earning amount against your account, which appears in your earnings screen.',
        },
        {
          kind: 'list',
          items: [
            'Your share of the delivery fee for each order is calculated by the platform and recorded against that order — it is not calculated by the app on your device.',
            'Only deliveries completed and closed count towards earnings.',
            'Cancelled, rejected or failed deliveries do not generate an earning, unless we tell you otherwise for a specific case.',
            'The delivery fee the customer pays is not necessarily the same as your share; your share is the amount recorded for you.',
            'We may correct an obvious recording error, and will tell you where reasonably possible.',
          ],
        },
        {
          kind: 'p',
          text: 'If a figure looks wrong, raise it promptly through [Support](/support) with the delivery reference.',
        },
      ],
    },
    {
      id: 'tips',
      title: '13. Tips',
      blocks: [
        {
          kind: 'p',
          text: 'A tip is a customer\'s voluntary appreciation for you. Tips are added in full to the earnings recorded for the delivery that produced them.',
        },
        {
          kind: 'list',
          items: [
            'A tip is never required and never affects whether you receive a delivery.',
            'If an order is cancelled before delivery, the tip is not retained.',
            'Never ask a customer for a tip or pressure them to give one.',
          ],
        },
      ],
    },
    {
      id: 'payouts',
      title: '14. Payouts and Records',
      blocks: [
        {
          kind: 'list',
          items: [
            'Your earnings records are available in your earnings screen, with the deliveries that produced them.',
            'How and when earnings are paid to you is confirmed in your partner arrangements; if it is not clear to you, ask us before you start delivering.',
            'Keep your payment details (bank or mobile money) accurate so payments reach you.',
            'If you believe a payment is missing or short, contact support with the delivery references and we will reconcile it.',
            'You are responsible for your own taxes and reporting arising from your earnings.',
          ],
        },
      ],
    },
    {
      id: 'account-security',
      title: '15. Account Security and Prohibited Conduct',
      blocks: [
        {
          kind: 'p',
          text: 'You must not:',
        },
        {
          kind: 'list',
          items: [
            'let anyone else operate your account, or deliver under your identity;',
            'accept deliveries and hand them to an unapproved person;',
            'falsify a pickup, a delivery, a position or an order status;',
            'share a customer\'s name, address, phone number or order details with anyone outside that delivery;',
            'solicit or accept payment directly from a customer for an order that belongs on the platform;',
            'tamper with the app, attempt to bypass platform controls or manipulate matching;',
            'harass, threaten or discriminate against customers, restaurant staff or our team;',
            'accept or carry anything unlawful, or use the platform for a criminal purpose;',
            'use the platform while unfit to do so through alcohol, drugs or exhaustion.',
          ],
        },
        {
          kind: 'p',
          text: 'The [Acceptable Use Policy](/acceptable-use) also applies to you.',
        },
      ],
    },
    {
      id: 'safety',
      title: '16. Safety Requirements',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ride and drive within the law and within your own limits.',
            'Use protective equipment as required.',
            'Do not deliver if your vehicle, the weather or your condition makes it unsafe — go offline and tell us.',
            'Handle food hygienically and keep it upright and protected from the elements.',
            'If you are involved in an accident or an incident, secure your safety first, then contact us.',
            'Do not carry out a delivery that would put you or anyone else at risk to meet a time estimate.',
          ],
        },
      ],
    },
    {
      id: 'termination',
      title: '17. Suspension and Termination',
      blocks: [
        {
          kind: 'list',
          items: [
            'You may stop delivering and ask us to close your account at any time, subject to completing deliveries already accepted and to earnings properly due.',
            'We may suspend your account while we investigate a complaint, a safety concern, a verification issue or a suspected breach.',
            'We may terminate your access for fraud, safety failures, serious misconduct, repeated breaches or a persistent pattern of cancellations.',
            'Where the circumstances allow, we will tell you the reason and give you a chance to respond.',
            'We may re-verify your documents or vehicle at any time; failure to re-verify may lead to suspension.',
          ],
        },
      ],
    },
    {
      id: 'contact',
      title: '18. Contact',
      blocks: [
        {
          kind: 'p',
          text: '[Support screen](/support) · [support@samleygo.com.gh](mailto:support@samleygo.com.gh) · +233 (0) 30 200 4567.',
        },
        {
          kind: 'p',
          text: 'Related: [Terms of Service](/terms) · [Delivery Policy](/delivery-policy) · [Payment Policy](/payment-policy) · [Privacy Policy](/privacy) · [Acceptable Use Policy](/acceptable-use).',
        },
      ],
    },
  ],
};
