import type { LegalDocument } from '../types';

/** Restaurant Partner Terms — onboarding, obligations, commission and settlement. */
export const restaurantTermsDocument: LegalDocument = {
  key: 'restaurant-partner-terms',
  path: '/restaurant-partner-terms',
  title: 'Restaurant Partner Terms — SamleyGo Ghana',
  heading: 'Restaurant Partner Terms',
  navTitle: 'Restaurant Partner Terms',
  metaTitle: 'Restaurant Partner Terms | SamleyGo Ghana',
  metaDescription:
    'The terms that apply to restaurants partnering with SamleyGo: onboarding, menus, food safety, orders, commission and settlement.',
  summary:
    'These terms apply to restaurants that list and sell food through SamleyGo. They cover onboarding, listing accuracy, food preparation and safety, order handling, commission, settlement and the conduct we expect.',
  sections: [
    {
      id: 'about',
      title: '1. About These Terms',
      blocks: [
        {
          kind: 'p',
          text: 'These Restaurant Partner Terms are a supplement to, and form part of, the SamleyGo [Terms of Service](/terms). Where these terms conflict with the general Terms on a matter specific to restaurants, these terms apply.',
        },
        {
          kind: 'p',
          text: 'In these terms, "you" or "the restaurant" means the restaurant business that registers and lists on SamleyGo; "we", "us" and "SamleyGo" means the operator of the platform.',
        },
        {
          kind: 'p',
          text: 'Capitalised terms such as "commission" and "settlement" are explained in sections 13 and 14.',
        },
      ],
    },
    {
      id: 'onboarding',
      title: '2. Onboarding and Approval',
      blocks: [
        {
          kind: 'p',
          text: 'To partner with SamleyGo you register an account, provide your business details and request approval. We review applications before a listing goes live.',
        },
        {
          kind: 'list',
          items: [
            'Provide accurate business information: the restaurant\'s name, contact details, address, and the location pin for your kitchen.',
            'Represent that you have the right to operate the kitchen and to sell the food you offer.',
            'Keep contact details current so that orders and support messages reach you.',
            'Approval is at our discretion, and we may refuse or delay an application where information is missing, inconsistent or cannot be verified.',
            'Approval covers the account and the location registered; a new location requires its own registration and approval.',
          ],
        },
      ],
    },
    {
      id: 'account-access',
      title: '3. Account and Access',
      blocks: [
        {
          kind: 'list',
          items: [
            'Your account is for your business and the staff you authorise to operate it.',
            'You are responsible for everything done through your account, including orders accepted, rejected or marked ready.',
            'Only approved users should sign in; do not share credentials outside your authorised staff.',
            'Tell us immediately if your account is used without your permission.',
          ],
        },
      ],
    },
    {
      id: 'listings',
      title: '4. Menu, Listings and Accuracy',
      blocks: [
        {
          kind: 'p',
          text: 'You control your listing. Customers rely on it, so it must be accurate and current:',
        },
        {
          kind: 'list',
          items: [
            'Item names, descriptions and photographs must represent what the customer will actually receive.',
            'Prices must be the prices you intend to charge, in Ghana Cedis.',
            'Availability, portion sizes and any limits must be correct.',
            'Allergen, dietary and ingredient information you choose to publish must be accurate to the best of your knowledge.',
            'Opening hours and preparation expectations must be kept up to date.',
            'Do not use images or branding you do not have the right to use.',
          ],
        },
        {
          kind: 'p',
          text: 'We may correct, suspend or remove a listing that is misleading, unsafe or in breach of these terms, and will tell you where reasonably possible.',
        },
      ],
    },
    {
      id: 'pricing',
      title: '5. Pricing',
      blocks: [
        {
          kind: 'list',
          items: [
            'You set your own prices; SamleyGo does not set your food prices.',
            'The price shown to a customer at checkout for your items is the price you will be settled on, before commission.',
            'Promotional prices you choose apply to orders placed while the promotion is live.',
            'You must not charge a customer more than the amount shown at checkout, or add unlisted charges to an order placed through the platform.',
          ],
        },
      ],
    },
    {
      id: 'availability',
      title: '6. Food Availability',
      blocks: [
        {
          kind: 'p',
          text: 'An order that has been accepted must be fulfilled. Keep your availability honest so customers are not disappointed:',
        },
        {
          kind: 'list',
          items: [
            'Mark items as unavailable the moment they run out.',
            'Close your listing when you cannot accept orders, rather than accepting and rejecting repeatedly.',
            'If you cannot fulfil an accepted order, reject it promptly in the app so the customer can be told and refunded.',
            'Do not accept orders you know you cannot prepare within a reasonable time.',
          ],
        },
      ],
    },
    {
      id: 'preparation-safety',
      title: '7. Preparation and Food Safety',
      blocks: [
        {
          kind: 'p',
          text: 'You are responsible for the food you prepare and sell. This includes compliance with applicable Ghanaian food-safety, hygiene and licensing requirements for your business.',
        },
        {
          kind: 'list',
          items: [
            'Prepare food hygienically, using ingredients that are safe and within their usable life.',
            'Handle allergen requests seriously and never claim an item is allergen-free unless you can support it.',
            'Do not supply spoiled, contaminated, expired or unsafe food.',
            'Do not prepare items you are not permitted to sell.',
            'Keep your kitchen and staff meet the standards you would expect of your own business.',
          ],
        },
        {
          kind: 'p',
          text: 'Food-safety failures are treated as serious matters and may lead to immediate suspension pending investigation.',
        },
      ],
    },
    {
      id: 'packaging',
      title: '8. Packaging and Handover',
      blocks: [
        {
          kind: 'list',
          items: [
            'Package food so that it survives the journey — sealed, spill-resistant and suitable for hot or cold items as appropriate.',
            'Include cutlery, condiments or extras only where the order includes them.',
            'Attach the order reference to the package so the courier can match it.',
            'Hand the order to the assigned courier and mark it ready for pickup only when it is genuinely ready.',
            'If an order is delayed, use the app to communicate rather than leaving a courier waiting without explanation.',
          ],
        },
      ],
    },
    {
      id: 'order-handling',
      title: '9. Order Acceptance and Response',
      blocks: [
        {
          kind: 'p',
          text: 'Orders arrive in your kitchen dashboard in real time. Respond to them promptly and honestly:',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Review the order contents and notes when it arrives.',
            'Accept and begin preparing, or reject with a reason, as quickly as you can.',
            'Mark the order ready for pickup when it is packed.',
            'When a courier is required, the order is offered for assignment; you can also assign an available courier.',
            'Keep the status history accurate — it is the record both the customer and we rely on.',
          ],
        },
      ],
    },
    {
      id: 'cancellations',
      title: '10. Cancellations and Rejections',
      blocks: [
        {
          kind: 'list',
          items: [
            'You may reject an order you cannot fulfil — for example when an item is unavailable or you are at capacity.',
            'Reject as early as possible so the customer is not left waiting.',
            'Rejecting or cancelling an accepted order stops the settlement for that order; food that is not delivered is not charged to the customer.',
            'A pattern of unexplained rejections or very slow responses may affect how orders are offered to you.',
            'Cancellation and refund handling for customers is set out in the [Refund & Cancellation Policy](/refunds).',
          ],
        },
      ],
    },
    {
      id: 'courier-handover',
      title: '11. Working With Couriers',
      blocks: [
        {
          kind: 'list',
          items: [
            'Treat couriers professionally; they represent the collection side of your customer\'s experience.',
            'Allow a courier a reasonable wait at pickup without penalty where you are running late.',
            'If a courier reports a problem with an order at pickup, resolve it at the counter before they leave.',
            'Do not ask a courier to carry items outside the platform or to accept cash on your behalf.',
            'Do not share customer details you receive with anyone outside fulfilling the order.',
          ],
        },
      ],
    },
    {
      id: 'complaints',
      title: '12. Customer Complaints',
      blocks: [
        {
          kind: 'p',
          text: 'Complaints about food quality, missing items, incorrect items or substitutions are, first, your responsibility — you fulfilled the order.',
        },
        {
          kind: 'list',
          items: [
            'Respond to complaints routed to you promptly and in good faith.',
            'Where a refund or replacement is appropriate, we may arrange it and reflect it against your records.',
            'Do not retaliate against a customer for making a complaint.',
            'Serious or repeated substantiated complaints may lead to review of your listing or partner status.',
          ],
        },
      ],
    },
    {
      id: 'commission',
      title: '13. Commission',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo charges the restaurant a commission on the food value of orders fulfilled through the platform. Commission is a restaurant-side commercial arrangement — it is never charged to a customer, and never appears on a customer\'s checkout.',
        },
        {
          kind: 'list',
          items: [
            'Commission is calculated as a percentage of the food subtotal of each order. The delivery fee and the customer\'s tip are not part of the commission base.',
            'The rate that applies to you is configured for your restaurant (or the platform default where no restaurant-specific rate is set), and the rate for each order is recorded against that order.',
            'The commission recorded on an order does not change if the rate is changed later — historical orders keep the rate that applied when they were placed.',
            'The applicable rate is confirmed to you with your partner agreement. Commission rates are configured and changed only by administrators, and each change is audited.',
          ],
        },
        {
          kind: 'note',
          tone: 'important',
          title: 'Commission is never a hidden customer fee',
          text: 'Customers pay the food price, the delivery fee and any tip they choose. Your commission is deducted from your own settlement, not added to their bill.',
        },
      ],
    },
    {
      id: 'settlement',
      title: '14. Settlement and Payment Records',
      blocks: [
        {
          kind: 'p',
          text: 'For each order we record the food value, the commission, and the resulting net amount payable to you (your settlement figure).',
        },
        {
          kind: 'list',
          items: [
            'Your net amount for an order is the food subtotal less the commission recorded for that order.',
            'Orders that are cancelled, rejected or failed do not generate a settlement for you.',
            'Settlement status is managed by our administrators; you can see your figures in your restaurant dashboard.',
            'Refunds recorded against an order reduce the amount settled for that order.',
            'Settlement records are reconciled against the order and payment records; raise any discrepancy promptly with your order references.',
            'You are responsible for your own accounting, taxes and reporting arising from sales made through the platform.',
          ],
        },
        {
          kind: 'p',
          text: 'The timing and method of settlement to your bank or mobile money account is confirmed in your partner agreement. If it is not stated there, contact us before relying on a particular schedule.',
        },
      ],
    },
    {
      id: 'data-confidentiality',
      title: '15. Customer Data and Confidentiality',
      blocks: [
        {
          kind: 'list',
          items: [
            'You receive customer details only to the extent needed to fulfil an order — typically the items, address, contact number and notes.',
            'Use that information only to prepare and hand over the order; do not use it for marketing without consent, and do not share it.',
            'Keep your own account credentials, business information and platform documents confidential.',
            'Tell us promptly if customer data you hold is exposed or compromised.',
          ],
        },
        {
          kind: 'p',
          text: 'How SamleyGo handles personal information generally is set out in the [Privacy Policy](/privacy).',
        },
      ],
    },
    {
      id: 'intellectual-property',
      title: '16. Intellectual Property',
      blocks: [
        {
          kind: 'list',
          items: [
            'Your menu content, photographs, trademarks and business name remain yours; you grant us a licence to display them on the platform to promote and fulfil orders.',
            'You must hold the rights to everything you upload.',
            'SamleyGo\'s own platform, brand and software remain ours and may not be copied or reused.',
            'Do not use another restaurant\'s name, images or branding in your listing.',
          ],
        },
      ],
    },
    {
      id: 'prohibited',
      title: '17. Prohibited Conduct',
      blocks: [
        {
          kind: 'p',
          text: 'In addition to the [Acceptable Use Policy](/acceptable-use), you must not:',
        },
        {
          kind: 'list',
          items: [
            'list or sell food that is unsafe, unlicensed or unlawfully supplied;',
            'misrepresent your kitchen, your location or your food;',
            'accept orders on behalf of another restaurant through your account;',
            'collude with a courier to fake deliveries or inflate order values;',
            'manipulate ratings, reviews or order statistics;',
            'solicit customers away from the platform in a way that breaches your agreement;',
            'interfere with the platform or attempt to bypass commission or settlement controls.',
          ],
        },
      ],
    },
    {
      id: 'suspension',
      title: '18. Suspension and Termination',
      blocks: [
        {
          kind: 'list',
          items: [
            'You may leave the partnership by telling us, subject to completing orders already in progress and to settlement of amounts properly due.',
            'We may suspend your listing while we investigate a serious complaint, a safety concern or a suspected breach.',
            'We may terminate the partnership for a material or repeated breach, unlawful conduct, a food-safety failure, or prolonged inactivity.',
            'Where the circumstances allow, we will give you notice and a chance to respond.',
            'Termination does not affect amounts properly accrued before termination, or records we must keep.',
          ],
        },
      ],
    },
    {
      id: 'contact',
      title: '19. Contact',
      blocks: [
        {
          kind: 'p',
          text: '[Support screen](/support) · [support@samleygo.com.gh](mailto:support@samleygo.com.gh) · +233 (0) 30 200 4567.',
        },
        {
          kind: 'p',
          text: 'Related: [Terms of Service](/terms) · [Payment Policy](/payment-policy) · [Refund & Cancellation Policy](/refunds) · [Privacy Policy](/privacy) · [Acceptable Use Policy](/acceptable-use).',
        },
      ],
    },
  ],
};
