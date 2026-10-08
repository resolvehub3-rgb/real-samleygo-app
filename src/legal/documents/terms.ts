import type { LegalDocument } from '../types';

/**
 * Terms of Service — authored against the shipped product: real checkout flow,
 * delivery pricing engine, location behaviour and partner (restaurant/courier)
 * model. No price, provider or certification is claimed that the code does not
 * implement.
 */
export const termsDocument: LegalDocument = {
  key: 'terms',
  path: '/terms',
  title: 'Terms of Service — SamleyGo Ghana',
  heading: 'Terms of Service',
  navTitle: 'Terms of Service',
  metaTitle: 'Terms of Service | SamleyGo Ghana',
  metaDescription:
    'The terms that govern your use of SamleyGo for food ordering, delivery, payments and partner services in Ghana.',
  summary:
    'These Terms govern access to and use of the SamleyGo platform — the SamleyGo website, progressive web app and related services — together with the rights and responsibilities of customers, restaurants and delivery couriers who use it. Please read them carefully before placing an order.',
  sections: [
    {
      id: 'about-samleygo',
      title: '1. About SamleyGo',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo is a Ghana-focused, technology-enabled food marketplace and delivery platform. SamleyGo provides the technology that connects three groups: customers looking to order food, participating restaurants (also called kitchens) that prepare and sell that food, and couriers who carry out deliveries.',
        },
        {
          kind: 'p',
          text: 'SamleyGo provides the marketplace, ordering, checkout, order management, location and tracking tools. Restaurants remain responsible for the food they prepare and sell, and couriers remain responsible for the deliveries they accept. Where these Terms say "SamleyGo", "we" or "us", we mean the operator of the SamleyGo platform.',
        },
        {
          kind: 'p',
          text: 'You can reach our team through the in-app [Support screen](/support), by email at [support@samleygo.com.gh](mailto:support@samleygo.com.gh) or by phone on +233 (0) 30 200 4567.',
        },
      ],
    },
    {
      id: 'acceptance',
      title: '2. Acceptance of These Terms',
      blocks: [
        {
          kind: 'p',
          text: 'By creating an account, browsing the platform or placing an order, you agree to be bound by these Terms and by the policies they refer to — including our Privacy Policy, Cookie Policy, Refund & Cancellation Policy, Delivery Policy, Payment Policy and Acceptable Use Policy.',
        },
        {
          kind: 'p',
          text: 'If you register as a restaurant or a courier, you additionally agree to the partner terms that apply to your role: Restaurant Partner Terms or Courier / Delivery Partner Terms.',
        },
        {
          kind: 'p',
          text: 'If you do not agree with any part of these Terms, do not use the platform. Where applicable law gives you rights that cannot be excluded, these Terms do not limit those rights.',
        },
      ],
    },
    {
      id: 'eligibility',
      title: '3. Eligibility',
      blocks: [
        {
          kind: 'p',
          text: 'You must be legally able to enter into a binding contract under the laws of Ghana to use SamleyGo. The platform is intended for personal use by adults; if you are under 18, please use it only with the involvement of a parent or guardian.',
        },
        {
          kind: 'p',
          text: 'Restaurant and courier accounts are for business operators and working couriers acting in the course of that activity, and may be subject to eligibility checks, documents and approvals before activation.',
        },
        {
          kind: 'p',
          text: 'You must provide accurate, current information — including your name, a valid email address and a reachable Ghanaian phone number — and keep it up to date.',
        },
      ],
    },
    {
      id: 'user-accounts',
      title: '4. User Accounts',
      blocks: [
        {
          kind: 'p',
          text: 'Accounts are created with an email address and a password, and are verified through our authentication provider. You are responsible for keeping your sign-in credentials confidential and for all activity that happens under your account.',
        },
        {
          kind: 'list',
          items: [
            'Do not share your account with another person, or allow a courier or restaurant account to be operated by someone who has not been approved.',
            'Tell us promptly at [support@samleygo.com.gh](mailto:support@samleygo.com.gh) if you believe your account has been accessed without your permission.',
            'Keep your phone number and email reachable so that order, delivery and security messages can reach you.',
            'One person may not hold multiple accounts to manipulate promotions, reviews or order limits.',
          ],
        },
        {
          kind: 'p',
          text: 'You can ask us to correct the personal information held about you, or to close your account, by contacting support. Closing an account does not remove records we are required to keep — for example transaction and order records — as described in our Privacy Policy.',
        },
      ],
    },
    {
      id: 'restaurant-listings',
      title: '5. Restaurant Listings',
      blocks: [
        {
          kind: 'p',
          text: 'Restaurants control their own listings: names, descriptions, menu items, photographs, prices, allergen or ingredient notes and opening hours. SamleyGo displays that information and does not independently verify every detail.',
        },
        {
          kind: 'p',
          text: 'A listing shown as open means the restaurant has indicated it is accepting orders at that time. Availability, pricing and preparation times can change during the day without notice, and the menu shown to you at checkout is the one that applies to your order.',
        },
        {
          kind: 'p',
          text: 'If a listing appears wrong or misleading, report it through [Support](/support) and we will pass it to the restaurant and, where appropriate, take action under these Terms.',
        },
      ],
    },
    {
      id: 'food-orders',
      title: '6. Food Orders',
      blocks: [
        {
          kind: 'p',
          text: 'You review your basket — items, quantities, any notes, the delivery address, the delivery fee and the total — before placing an order. Placing an order sends it to the restaurant together with your delivery details.',
        },
        {
          kind: 'p',
          text: 'The order summary you see before confirming, including the itemised food price, delivery fee, any optional tip and the total in Ghana Cedis (GHS), is the amount your order will be charged at.',
        },
        {
          kind: 'p',
          text: 'You are responsible for checking your basket, your delivery address and your contact details before confirming. If you spot an error immediately after ordering, contact the restaurant and support as quickly as possible — see sections 14 and 15.',
        },
      ],
    },
    {
      id: 'order-acceptance',
      title: '7. Order Acceptance',
      blocks: [
        {
          kind: 'p',
          text: 'An order is submitted to the restaurant for acceptance. The restaurant may accept it and begin preparing it, or reject it — for example when an item is unavailable, the kitchen is at capacity or the order cannot be fulfilled safely.',
        },
        {
          kind: 'p',
          text: 'An order is not guaranteed to be accepted. If a restaurant rejects an order, the order stops progressing, you are not charged for food that is not prepared, and any payment taken for that order becomes eligible for review under our Refund & Cancellation Policy.',
        },
        {
          kind: 'p',
          text: 'Acceptance and every later status change — preparation, readiness, courier assignment, pickup, delivery and completion — are recorded against your order and shown in your order history.',
        },
      ],
    },
    {
      id: 'pricing',
      title: '8. Pricing',
      blocks: [
        {
          kind: 'p',
          text: 'All prices are set by the restaurant and displayed in Ghana Cedis (GHS). Unless a listing states otherwise, prices shown on the menu are the prices you pay for the food itself, before any delivery fee and any tip you choose to add.',
        },
        {
          kind: 'list',
          items: [
            'Food price — set by the restaurant for each item.',
            'Delivery fee — calculated for your order as described in section 9.',
            'Tip — optional, and entirely your choice, including choosing nothing.',
            'Any other charge — must be shown to you on the order summary before you confirm.',
          ],
        },
        {
          kind: 'p',
          text: 'The total you see on the checkout screen before confirming is the total you are charged. SamleyGo does not add a hidden platform or restaurant commission to a customer checkout, and no separate restaurant commission is charged to you — restaurant commission is an arrangement between SamleyGo and the restaurant, and is never presented to you as a customer fee.',
        },
        {
          kind: 'p',
          text: 'If a price displayed is obviously wrong — for example a clear typographical error — we or the restaurant may cancel the order and refund anything taken for it, and we will tell you if that happens.',
        },
      ],
    },
    {
      id: 'delivery-fees',
      title: '9. Delivery Fees',
      blocks: [
        {
          kind: 'p',
          text: 'A delivery fee is calculated for each order from the delivery distance and the pricing rules configured for the platform at that time. It is shown to you on the order summary before you confirm.',
        },
        {
          kind: 'p',
          text: 'The delivery fee may take into account the pickup location, your delivery location, the distance of the route between them, the applicable pricing rules, a minimum fee, a maximum fee (where one is configured) and other operational conditions such as prevailing demand.',
        },
        {
          kind: 'list',
          items: [
            'Where a usable road route is available, delivery distance is measured along that route.',
            'Where a route cannot be confirmed as reasonable for the trip, the platform falls back to a direct (straight-line) distance between the two points.',
            'A minimum delivery fee and, where configured, a maximum delivery fee may apply.',
            'A calculated fee is only held for a short window — a few minutes — after which it is recalculated for a later order.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          title: 'No fixed delivery price is promised',
          text: 'Delivery fees vary with distance, the pricing rules in force at the time of your order and operational conditions. The fee shown at checkout is the fee that applies to that order.',
        },
      ],
    },
    {
      id: 'payments',
      title: '10. Payments',
      blocks: [
        {
          kind: 'p',
          text: 'Payment methods offered for your order are shown at checkout and may include mobile money wallets (such as MTN Mobile Money, Telecel Cash and AT Money), bank card and cash on delivery. The methods available to you can change by order, location or configuration.',
        },
        {
          kind: 'list',
          items: [
            'You authorise SamleyGo to charge the total shown at checkout for the order you confirm, including the delivery fee and any tip you added.',
            'For each order we create a payment record showing the amount, the currency (GHS), the method you chose and a payment reference for that order.',
            'SamleyGo does not ask for, collect or store card numbers, card security codes or mobile money PINs. Mobile money PINs are entered only in your wallet provider\'s own flow.',
            'Where a third-party payment provider handles a transaction, that provider processes it under its own terms, and we receive only the payment status, method, amount and reference.',
          ],
        },
        {
          kind: 'p',
          text: 'Payment, refunds, reversals and duplicate charges are dealt with in our [Payment Policy](/payment-policy) and [Refund & Cancellation Policy](/refunds).',
        },
      ],
    },
    {
      id: 'delivery-services',
      title: '11. Delivery Services',
      blocks: [
        {
          kind: 'p',
          text: 'Once a restaurant accepts an order and the food is ready, the order is offered to available couriers. The restaurant or the platform assigns a courier, the courier collects the order, and the courier delivers it to the address you provided.',
        },
        {
          kind: 'p',
          text: 'You are responsible for giving a complete and correct delivery address, a reachable phone number and any access notes the courier will need. Full details are in our [Delivery Policy](/delivery-policy).',
        },
        {
          kind: 'p',
          text: 'SamleyGo does not itself employ or control restaurants or couriers in the preparation or carriage of an order; the platform coordinates and records the service. Nothing in these Terms removes a responsibility that applicable law places on SamleyGo, a restaurant or a courier.',
        },
      ],
    },
    {
      id: 'gps-location',
      title: '12. GPS and Location Services',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo uses location information, obtained through your device with your browser\'s permission, only where it is needed to provide the service:',
        },
        {
          kind: 'list',
          items: [
            'to determine or confirm your delivery address when you choose "use my location" or allow it on the home screen;',
            'to calculate the delivery distance and therefore the delivery fee for an order;',
            'to let a courier find the pickup point and the drop-off point, and to calculate a route;',
            'to estimate arrival times and to show progress on an order that is being delivered;',
            'to synchronise what you see with what the courier sees during an active delivery;',
            'to support safety, customer service and fraud or security investigations where legitimately necessary.',
          ],
        },
        {
          kind: 'p',
          text: 'Your device asks for permission before any location is read, and you can withdraw that permission at any time through your browser or device settings. Declining location does not stop you ordering — you can enter or choose a delivery address manually.',
        },
        {
          kind: 'p',
          text: 'SamleyGo does not run location tracking in the background of your device outside the app. A customer\'s live location is used while the ordering screens are open and is not continuously uploaded to us; the delivery address coordinates you order with are stored against the order. Couriers who switch themselves online on the courier dashboard share their position so that deliveries can be assigned, routed and tracked — see our [Privacy Policy](/privacy) for exactly what is stored.',
        },
      ],
    },
    {
      id: 'order-tracking',
      title: '13. Order Tracking',
      blocks: [
        {
          kind: 'p',
          text: 'Your order screen shows live status updates while an order is in progress — preparation, courier assignment, pickup, progress and completion — and, during an active delivery, the courier\'s position as it is reported to the platform.',
        },
        {
          kind: 'p',
          text: 'Tracking is provided to help you follow the order you placed. Positions and times shown are estimates based on information available at that moment; road conditions, traffic and signal coverage affect what is shown and when it updates.',
        },
        {
          kind: 'p',
          text: 'Tracking information for an order stops updating once the order is delivered or otherwise closed. Completed orders remain available in your order history.',
        },
      ],
    },
    {
      id: 'cancellations',
      title: '14. Cancellations',
      blocks: [
        {
          kind: 'p',
          text: 'Because orders go straight to a working kitchen, a cancellation has to be assessed against the current state of your order. The earlier you ask, the more likely it is that an order can still be stopped.',
        },
        {
          kind: 'list',
          items: [
            'Before a restaurant begins preparing: we will ask the restaurant to stop the order; if it has not started, the order can usually be cancelled.',
            'After preparation has started: the restaurant may be unable to cancel, and the order may be delivered as placed.',
            'If a restaurant rejects or cancels an order: the order stops and any payment taken for food not prepared is reviewed for a refund.',
            'If a courier cannot complete a delivery: see section 16 and the Delivery Policy.',
          ],
        },
        {
          kind: 'p',
          text: 'To request a cancellation, contact the restaurant where possible and notify us immediately through [Support](/support). Cancellations, eligibility and their effects are set out in full in our [Refund & Cancellation Policy](/refunds).',
        },
      ],
    },
    {
      id: 'refunds',
      title: '15. Refunds',
      blocks: [
        {
          kind: 'p',
          text: 'Refunds are considered individually, based on what happened, the state of the order and applicable law. We do not promise an automatic refund in every situation.',
        },
        {
          kind: 'list',
          items: [
            'Orders cancelled before preparation, rejected by a restaurant, or not delivered through no fault of yours are normally eligible for a refund of the amount paid for the undelivered order.',
            'Where part of an order is missing, incorrect, damaged or unacceptable, a partial refund or replacement may be appropriate.',
            'The delivery fee is reviewed separately from the food amount, and may be refunded in whole or in part depending on the circumstances.',
            'Tips follow the underlying delivery: if a delivery is cancelled before it happens, the tip is not retained.',
          ],
        },
        {
          kind: 'p',
          text: 'Refunds are recorded against your order and returned through the payment method used for that order. Timing depends on the method and on your own provider. Full details, including how to raise a claim, are in our [Refund & Cancellation Policy](/refunds).',
        },
      ],
    },
    {
      id: 'failed-deliveries',
      title: '16. Failed or Delayed Deliveries',
      blocks: [
        {
          kind: 'p',
          text: 'Deliveries can be delayed or fail for reasons outside anyone\'s control — traffic, weather, road closures, a kitchen running late, an unreachable recipient or an address that cannot be found.',
        },
        {
          kind: 'list',
          items: [
            'If we cannot reach you or find the address, the courier will attempt to contact you using the number on the order.',
            'If the delivery still cannot be completed, the order may be returned to the restaurant or otherwise closed, and the matter is reviewed under the Refund & Cancellation Policy.',
            'A delayed order that is delivered late is still a completed order; chronic problems should be reported to [Support](/support) so we can investigate.',
          ],
        },
        {
          kind: 'p',
          text: 'Estimated arrival times are estimates, not guarantees. They change with real-world conditions as described in the [Delivery Policy](/delivery-policy).',
        },
      ],
    },
    {
      id: 'customer-responsibilities',
      title: '17. Customer Responsibilities',
      blocks: [
        {
          kind: 'p',
          text: 'As a customer you agree to:',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'give accurate order details and a deliverable address, and keep your contact details reachable;',
            'be available to receive the order, or make alternative arrangements if you cannot be;',
            'check the food on arrival and report problems promptly;',
            'pay the amount shown at checkout through a method you are entitled to use;',
            'use promotions honestly, and keep your account credentials secure;',
            'treat restaurants, couriers and our support team with respect.',
          ],
        },
      ],
    },
    {
      id: 'restaurant-responsibilities',
      title: '18. Restaurant Responsibilities',
      blocks: [
        {
          kind: 'p',
          text: 'Participating restaurants are responsible for their own listings and for fulfilling accepted orders. Their full obligations are set out in the [Restaurant Partner Terms](/restaurant-partner-terms); in summary, a restaurant must:',
        },
        {
          kind: 'list',
          items: [
            'keep menu information, pricing, availability and opening hours accurate and current;',
            'prepare food safely, hygienically and in line with applicable Ghanaian food-safety requirements;',
            'accept or reject orders promptly and communicate honestly through the platform;',
            'package food so that it survives the journey to the customer;',
            'handle customer complaints about food quality, missing items and incorrect orders.',
          ],
        },
      ],
    },
    {
      id: 'courier-responsibilities',
      title: '19. Courier Responsibilities',
      blocks: [
        {
          kind: 'p',
          text: 'Couriers carry out the collection and delivery of orders. Their full obligations are set out in the [Courier / Delivery Partner Terms](/courier-partner-terms); in summary, a courier must:',
        },
        {
          kind: 'list',
          items: [
            'hold the documents and, where applicable, the vehicle permissions required for the work they take on;',
            'accept orders honestly, collect them carefully and deliver them to the right address;',
            'keep their device location available while online so that orders can be routed and tracked;',
            'treat customers and restaurant staff professionally and keep customer details confidential;',
            'prioritise road safety, and never use a phone in a way that is unsafe while riding or driving.',
          ],
        },
      ],
    },
    {
      id: 'promotions',
      title: '20. Promotions and Discounts',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo or a restaurant may offer promotions, discounts or credits. When a promotion applies, its rules — validity period, eligible orders, minimum spend and any limit — are shown with the offer.',
        },
        {
          kind: 'list',
          items: [
            'Promotions have no cash value and cannot be transferred except where the offer says so.',
            'A promotion can be amended or withdrawn before you order; the rules shown at the time you confirm are the ones that apply.',
            'Creating false accounts or placing fraudulent orders to obtain promotions is prohibited — see the [Acceptable Use Policy](/acceptable-use).',
          ],
        },
        {
          kind: 'p',
          text: 'The restaurant still receives the normal food price for a discounted order; any discount funded by SamleyGo is settled between us and the restaurant and is never a charge to you.',
        },
      ],
    },
    {
      id: 'prohibited',
      title: '21. Prohibited Activities',
      blocks: [
        {
          kind: 'p',
          text: 'You must not misuse the platform. The full list of prohibited behaviour is in our [Acceptable Use Policy](/acceptable-use), which forms part of these Terms. In summary, you must not:',
        },
        {
          kind: 'list',
          items: [
            'commit fraud, make fraudulent orders, or abuse payment, promotion or refund processes;',
            'harass, threaten or abuse other users, restaurant staff, couriers or our team;',
            'access accounts, systems or data you are not authorised to use, or attempt to bypass platform controls;',
            'scrape, mine, copy or reverse-engineer the platform except where law expressly allows it;',
            'post false complaints, fake reviews, or orders intended to harm a restaurant or courier.',
          ],
        },
      ],
    },
    {
      id: 'intellectual-property',
      title: '22. Intellectual Property',
      blocks: [
        {
          kind: 'p',
          text: 'The SamleyGo platform — including its software, design, wordmark, logo, text and graphics owned by SamleyGo — is protected by intellectual property law. You may use the platform only as intended, and may not copy, modify, distribute or create derivative works from it without permission.',
        },
        {
          kind: 'p',
          text: 'Menu content, photographs, trademarks and business names belong to the restaurants that provide them. Customer photos and reviews belong to the person who created them; by posting them you give SamleyGo a licence to display them in connection with the order and the platform.',
        },
        {
          kind: 'p',
          text: 'If you believe content on the platform infringes your rights, contact [support@samleygo.com.gh](mailto:support@samleygo.com.gh) with enough detail for us to investigate.',
        },
      ],
    },
    {
      id: 'third-party',
      title: '23. Third-Party Services',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo relies on third-party services to operate: a cloud application backend for data, authentication and live updates; mapping, address autocomplete and routing services; and the hosting and delivery network for the app itself.',
        },
        {
          kind: 'p',
          text: 'These services process information for us in order to run the platform — for example, coordinates sent to a routing service to calculate a route, or address text typed into an address search. Where we describe exactly what is sent, see our [Privacy Policy](/privacy).',
        },
        {
          kind: 'p',
          text: 'Third-party services operate under their own terms and policies. SamleyGo is not responsible for the availability or content of a third-party service, but we remain responsible for the way we use your information.',
        },
      ],
    },
    {
      id: 'availability',
      title: '24. Platform Availability',
      blocks: [
        {
          kind: 'p',
          text: 'We work to keep SamleyGo available, but the platform is provided on an "as available" basis. Maintenance, updates, internet conditions, outages or events beyond our control may interrupt access, including live tracking and notifications.',
        },
        {
          kind: 'list',
          items: [
            'We may suspend all or part of the platform for maintenance or security work.',
            'We may change, add or remove features to improve the service.',
            'Where a planned interruption is material and we can do so, we will try to give notice.',
          ],
        },
        {
          kind: 'p',
          text: 'Nothing here affects rights you have under applicable law, or our responsibility to provide services we have already been paid for.',
        },
      ],
    },
    {
      id: 'security',
      title: '25. Security',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo implements technical and organisational safeguards designed to protect personal information and platform data against unauthorised access, alteration, disclosure, loss or misuse — including encrypted transport (HTTPS/TLS), authenticated access, database-level authorisation controls and restricted internal access.',
        },
        {
          kind: 'p',
          text: 'You also play a part: choose a strong, unique password, do not share your sign-in details, and tell us immediately if you suspect unauthorised use of your account.',
        },
        {
          kind: 'p',
          text: 'No system can be guaranteed completely secure. If we become aware of a breach affecting your personal information, we will respond and notify you as required by applicable law — see section 26 of our [Privacy Policy](/privacy).',
        },
      ],
    },
    {
      id: 'liability',
      title: '26. Limitation of Liability',
      blocks: [
        {
          kind: 'p',
          text: 'To the maximum extent permitted by law, SamleyGo is not liable for indirect, incidental, special or consequential losses, or for loss of profit, goodwill or data, arising from your use of the platform.',
        },
        {
          kind: 'p',
          text: 'SamleyGo is a marketplace and coordination platform. Subject to applicable law, where a claim relates to an order, our total liability is limited to the amount you paid for that order through the platform.',
        },
        {
          kind: 'list',
          items: [
            'Restaurants are responsible for the food they prepare, including quality, hygiene, allergens and packaging.',
            'Couriers are responsible for the conduct of the delivery they accept, including care of the order in transit.',
            'These Terms do not limit liability that cannot be limited under the laws of Ghana, including liability for fraud or for death or personal injury caused by negligence.',
          ],
        },
        {
          kind: 'p',
          text: 'If you are unhappy with an order, your first step should be to contact [Support](/support) — most problems can be resolved quickly.',
        },
      ],
    },
    {
      id: 'indemnification',
      title: '27. Indemnification',
      blocks: [
        {
          kind: 'p',
          text: 'You agree to be responsible for losses, claims or costs (including reasonable legal costs) arising from your misuse of the platform, your breach of these Terms, or your violation of another person\'s rights — for example, listing or posting content you have no right to use.',
        },
        {
          kind: 'p',
          text: 'This does not apply where the claim results from our own breach or negligence, and does not apply to the extent the law does not permit it.',
        },
      ],
    },
    {
      id: 'termination',
      title: '28. Account Suspension and Termination',
      blocks: [
        {
          kind: 'p',
          text: 'You may stop using SamleyGo at any time and ask us to close your account through [Support](/support).',
        },
        {
          kind: 'p',
          text: 'We may suspend or close an account where we reasonably believe there has been a breach of these Terms or the Acceptable Use Policy, a risk to customers, restaurants, couriers or the platform, unlawful activity, or extended inactivity. Where the circumstances allow, we will tell you the reason and, for non-serious matters, offer a chance to respond.',
        },
        {
          kind: 'p',
          text: 'Suspending an account pauses access; it does not by itself cancel orders already in progress, which are handled under the cancellation and refund rules. Provisions that by their nature should survive — including liability, intellectual property and governing law — continue after termination.',
        },
      ],
    },
    {
      id: 'changes',
      title: "29. Changes to These Terms",
      blocks: [
        {
          kind: 'p',
          text: 'We may update these Terms to reflect changes to the platform, our practices or the law. The date at the top of this document shows when it was last updated.',
        },
        {
          kind: 'p',
          text: 'For material changes, we will give reasonable notice — for example through the platform or by email. Continuing to use SamleyGo after an update takes effect means you accept the revised Terms; if you do not accept them, you should stop using the platform.',
        },
      ],
    },
    {
      id: 'governing-law',
      title: '30. Governing Law',
      blocks: [
        {
          kind: 'p',
          text: 'These Terms are governed by the laws of the Republic of Ghana, and the courts of Ghana have jurisdiction over disputes arising from them, subject to any consumer rights you have under applicable law.',
        },
        {
          kind: 'p',
          text: 'Before starting formal proceedings, please contact us through [Support](/support) — most disputes are resolved faster and more cheaply by talking first.',
        },
      ],
    },
    {
      id: 'contact',
      title: '31. Contact Information',
      blocks: [
        {
          kind: 'terms',
          items: [
            {
              term: 'Support and general enquiries',
              definition:
                'In-app [Support screen](/support), [support@samleygo.com.gh](mailto:support@samleygo.com.gh), or +233 (0) 30 200 4567.',
            },
            {
              term: 'Legal notices',
              definition: '[support@samleygo.com.gh](mailto:support@samleygo.com.gh), marked "Legal".',
            },
            {
              term: 'Privacy requests',
              definition: 'See the [Privacy Policy](/privacy) for how to make a privacy request.',
            },
          ],
        },
        {
          kind: 'p',
          text: 'Related documents: [Privacy Policy](/privacy) · [Cookie Policy](/cookies) · [Refund & Cancellation Policy](/refunds) · [Delivery Policy](/delivery-policy) · [Payment Policy](/payment-policy) · [Acceptable Use Policy](/acceptable-use) · [Restaurant Partner Terms](/restaurant-partner-terms) · [Courier / Delivery Partner Terms](/courier-partner-terms).',
        },
      ],
    },
  ],
};
