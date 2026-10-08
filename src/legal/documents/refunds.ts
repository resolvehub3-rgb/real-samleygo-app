import type { LegalDocument } from '../types';

/** Refund & Cancellation Policy — eligibility is case-by-case; nothing is automatic. */
export const refundsDocument: LegalDocument = {
  key: 'refunds',
  path: '/refunds',
  title: 'Refund & Cancellation Policy — SamleyGo Ghana',
  heading: 'Refund & Cancellation Policy',
  navTitle: 'Refund & Cancellation Policy',
  metaTitle: 'Refund & Cancellation Policy | SamleyGo Ghana',
  metaDescription:
    'How to cancel a SamleyGo order in Ghana, when a refund may be due, how claims are handled and how refunds are returned.',
  summary:
    'Food is prepared to order, so cancellations and refunds depend on what has already happened. This policy explains how we assess each situation, what you can ask for, how to raise a claim and how refunds are returned.',
  sections: [
    {
      id: 'about',
      title: '1. About This Policy',
      blocks: [
        {
          kind: 'p',
          text: 'This policy applies to orders placed by customers through SamleyGo, and should be read with our [Terms of Service](/terms), [Delivery Policy](/delivery-policy) and [Payment Policy](/payment-policy).',
        },
        {
          kind: 'p',
          text: 'Nothing in this policy limits any right you have under applicable Ghanaian law. Refunds are assessed on the facts of each case — this policy describes how we normally handle situations, not a promise that a refund is automatic in any particular scenario.',
        },
      ],
    },
    {
      id: 'scope',
      title: '2. What This Policy Covers',
      blocks: [
        {
          kind: 'list',
          items: [
            'Cancelling an order, in whole or in part, before or after preparation has started.',
            'Orders cancelled or rejected by a restaurant, including items that turn out to be unavailable.',
            'Deliveries that cannot be completed — courier problems, an incorrect address, or an unreachable customer.',
            'Payment problems: failed payments, duplicate charges and reversals.',
            'Food-quality complaints: missing items, incorrect items, and damaged or spilled orders.',
            'Full and partial refunds, including the treatment of the delivery fee and any tip.',
          ],
        },
      ],
    },
    {
      id: 'before-order',
      title: '3. Checking Before You Order',
      blocks: [
        {
          kind: 'p',
          text: 'The easiest cancellation is the one you make before confirming. Before you place an order, please check:',
        },
        {
          kind: 'list',
          items: [
            'the items, quantities and any special instructions;',
            'the delivery address, contact number and any access notes;',
            'the restaurant, the delivery fee and the total shown at checkout.',
          ],
        },
        {
          kind: 'p',
          text: 'Once an order is confirmed it goes straight to the kitchen, and the window for stopping it closes quickly.',
        },
      ],
    },
    {
      id: 'customer-cancellation',
      title: '4. Cancelling an Order as a Customer',
      blocks: [
        {
          kind: 'p',
          text: 'To cancel, contact the restaurant where possible and notify us straight away through [Support](/support) or by phone. Whether an order can still be cancelled depends on its current status:',
        },
        {
          kind: 'list',
          items: [
            'Before preparation starts: the restaurant can usually stop the order, and a full refund of the amount paid is normally due.',
            'While preparation is in progress: the restaurant may be unable to stop it. If the order continues, it will be delivered and charged as placed.',
            'After the food is handed to a courier: the order is treated as a delivery to be completed; a cancellation at this stage is assessed individually and may not be refundable.',
          ],
        },
        {
          kind: 'p',
          text: 'Contact us as early as possible — the earlier the request, the more that can still be done.',
        },
      ],
    },
    {
      id: 'restaurant-cancellation',
      title: '5. Restaurant Cancellation or Rejection',
      blocks: [
        {
          kind: 'p',
          text: 'A restaurant may reject an order it cannot fulfil — because of capacity, an unavailable item, closing time, or a safety concern. It may also cancel an order after accepting it.',
        },
        {
          kind: 'list',
          items: [
            'If an order is rejected or cancelled before preparation, food you have not received is not charged for.',
            'You are notified of the status change in the app and it appears in your order history.',
            'Any amount taken for an order that did not proceed is reviewed for a refund, normally in full, including the delivery fee where the delivery is no longer happening.',
          ],
        },
      ],
    },
    {
      id: 'unavailable-items',
      title: '6. Unavailable Food and Partial Orders',
      blocks: [
        {
          kind: 'p',
          text: 'Ingredients run out and menus change. If an item you ordered is unavailable:',
        },
        {
          kind: 'list',
          items: [
            'the restaurant may contact you through the platform to agree a substitute or a removal;',
            'if the item is removed, the amount for that item is refunded — normally as a partial refund of the order;',
            'if removing the item changes whether the order can go ahead (for example, it falls below a minimum), the restaurant may cancel the order instead, which is handled as a cancellation.',
          ],
        },
      ],
    },
    {
      id: 'courier-problems',
      title: '7. Courier Problems',
      blocks: [
        {
          kind: 'p',
          text: 'Sometimes a delivery cannot be completed because of the courier — they may be unable to reach you, may not be able to collect safely, or may have to abandon the trip.',
        },
        {
          kind: 'list',
          items: [
            'If a courier has to withdraw, the platform reassigns the order to another courier where that is possible.',
            'If no delivery can be completed, the order is closed and assessed for a refund under this policy.',
            'You will not be charged a delivery fee for a delivery that was never completed, unless the failure was caused by the information or availability you provided (see sections 9 and 10).',
          ],
        },
      ],
    },
    {
      id: 'failed-delivery',
      title: '8. Failed Delivery',
      blocks: [
        {
          kind: 'p',
          text: 'A delivery fails when the courier cannot hand the order over. This usually happens because nobody is available, the address cannot be found, or the location is unsafe or inaccessible.',
        },
        {
          kind: 'list',
          items: [
            'The courier first tries to reach you using the phone number on the order.',
            'If you respond and can be reached shortly afterwards, the courier will normally wait a reasonable time and complete the delivery.',
            'If the delivery still cannot be completed, the order may be returned to the restaurant and closed; the food value is then reviewed for a refund.',
            'Where the failure was due to an incorrect address or repeated unavailability, the outcome may differ — see section 9.',
          ],
        },
        {
          kind: 'p',
          text: 'Keeping your phone reachable and your address accurate avoids almost all failed deliveries.',
        },
      ],
    },
    {
      id: 'address-unreachable',
      title: '9. Incorrect Address and Unreachable Customer',
      blocks: [
        {
          kind: 'p',
          text: 'You are responsible for the delivery details you give us. If the address is wrong, incomplete or unreachable, the following applies:',
        },
        {
          kind: 'list',
          items: [
            'Extra distance caused by a corrected address may change the delivery fee; the original quoted fee applies where the courier must travel further than agreed.',
            'If the order cannot be delivered because the address could not be found or you could not be reached despite contact attempts, the order may be closed as a failed delivery.',
            'In that case a refund may be partial — for example, the food value may be refunded while a delivery that was actually undertaken is not, depending on the circumstances and on applicable law.',
          ],
        },
        {
          kind: 'note',
          tone: 'important',
          title: 'Please double-check your pin and address',
          text: 'If your order cannot be found, move the pin or type the address carefully before you confirm. Fixing it as soon as the courier calls is the fastest way to keep your order on track.',
        },
      ],
    },
    {
      id: 'payment-issues',
      title: '10. Payment Problems',
      blocks: [
        {
          kind: 'sub',
          title: 'Failed payment',
          blocks: [
            {
              kind: 'p',
              text: 'If a payment does not go through, the order is not confirmed. Nothing should be taken for an order that was not placed; if money leaves your wallet or account anyway, contact us with the reference and we will investigate with your provider.',
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Duplicate charge',
          blocks: [
            {
              kind: 'p',
              text: 'If you believe you have been charged twice for the same order, send us both references (or the wallet message) through [Support](/support). Where a duplicate is confirmed, the duplicate is refunded.',
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Payment reversal',
          blocks: [
            {
              kind: 'p',
              text: 'If your payment provider reverses a transaction, we will reconcile the order against that reversal. Where the reversal is valid, the order may be cancelled and any balance settled with the restaurant or courier as applicable.',
            },
          ],
        },
        {
          kind: 'sub',
          title: 'Cash on delivery',
          blocks: [
            {
              kind: 'p',
              text: 'For cash orders, nothing is refunded to a wallet because nothing was taken online — a refund for a cash order is settled directly with you or applied to a future order as agreed.',
            },
          ],
        },
      ],
    },
    {
      id: 'what-can-be-refunded',
      title: '11. What Can Be Refunded',
      blocks: [
        {
          kind: 'p',
          text: 'The different parts of an order are assessed separately:',
        },
        {
          kind: 'terms',
          items: [
            {
              term: 'Food (full)',
              definition:
                'Normally refunded when the order is cancelled before preparation, rejected by the restaurant, or never delivered.',
            },
            {
              term: 'Food (partial)',
              definition:
                'Normally refunded when specific items are missing, incorrect, unusable or of unacceptable quality.',
            },
            {
              term: 'Delivery fee',
              definition:
                'Reviewed separately from the food. It is normally refunded when the delivery did not happen; where a delivery was genuinely undertaken and failed for reasons within your control, it may not be.',
            },
            {
              term: 'Tip',
              definition:
                'Follows the delivery. If a delivery is cancelled before it takes place, the tip is not retained.',
            },
          ],
        },
        {
          kind: 'p',
          text: 'Whether a refund is full or partial depends on what was provided, what went wrong, and applicable law.',
        },
      ],
    },
    {
      id: 'quality-complaints',
      title: '12. Food Quality, Missing, Incorrect and Damaged Orders',
      blocks: [
        {
          kind: 'p',
          text: 'Tell us as soon as you can — ideally immediately after opening the order — and keep the food and packaging if you can, as it may help us investigate.',
        },
        {
          kind: 'list',
          items: [
            'Missing items: refunded, or re-delivered where that is practical and you prefer it.',
            'Incorrect items: the correct item is arranged, or the wrong item is refunded.',
            'Damaged or spilled orders: assessed on the state of the order on arrival; a partial or full refund, or a replacement, may be offered.',
            'Food quality or safety concerns: treated seriously, reported to the restaurant, and eligible for refund or replacement where the concern is substantiated.',
            'Allergy or dietary concerns: tell us immediately — see section 16.',
          ],
        },
        {
          kind: 'p',
          text: 'Restaurants set out their own descriptions and allergen information on their listings. If a dish did not match its description, report it so we can hold the listing to account.',
        },
      ],
    },
    {
      id: 'making-a-claim',
      title: '13. How to Make a Claim',
      blocks: [
        {
          kind: 'list',
          ordered: true,
          items: [
            'Contact us as soon as possible through the in-app [Support screen](/support), by email at [support@samleygo.com.gh](mailto:support@samleygo.com.gh), or by phone on +233 (0) 30 200 4567.',
            'Give us the order reference, what went wrong, and any photos or details that help (for example, a missing or damaged item).',
            'Allow us reasonable time to check with the restaurant or courier — we usually need their side of the story too.',
            'We will tell you the outcome and, where a refund is due, how it will be returned.',
          ],
        },
        {
          kind: 'p',
          text: 'Claims made promptly are much easier to resolve. Delayed claims may be harder to investigate, and may be refused where the delay materially prevents us from verifying what happened.',
        },
      ],
    },
    {
      id: 'processing-refunds',
      title: '14. How Refunds Are Processed and How Long They Take',
      blocks: [
        {
          kind: 'list',
          items: [
            'A refund is recorded against your order, including the amount and the reason.',
            'Where payment was taken through a payment channel, the money is returned through the same channel so it reaches the original payer.',
            'How long it takes then depends on the method and on your own provider — a mobile money reversal, for example, is subject to your network\'s processing times.',
            'We will tell you when a refund has been recorded and, where we can, give you the reference for it.',
            'Partial refunds are handled the same way, for the amount agreed.',
          ],
        },
        {
          kind: 'p',
          text: 'If a refund you expect has not arrived within the time we quoted, contact [Support](/support) with your order reference so we can trace it.',
        },
      ],
    },
    {
      id: 'eligibility',
      title: '15. Eligibility, Disputes and Your Legal Rights',
      blocks: [
        {
          kind: 'list',
          items: [
            'Eligibility depends on the circumstances of the order and applicable law; a refund is not automatic in every case.',
            'We may decline a claim where our records, the restaurant\'s records or the courier\'s record show the order was delivered as placed, or where a claim appears fraudulent.',
            'Refund abuse — repeated false claims, or claims for food you received — is prohibited under the [Acceptable Use Policy](/acceptable-use) and may lead to account restriction.',
            'If you disagree with a decision, reply to us and ask for a review; if you remain dissatisfied, you may escalate to the contact in section 16 and, where applicable, to the relevant authorities.',
            'Nothing here removes rights you have under Ghanaian consumer law.',
          ],
        },
      ],
    },
    {
      id: 'contact',
      title: '16. Contact',
      blocks: [
        {
          kind: 'p',
          text: 'For cancellations, claims and refund questions: [Support screen](/support) · [support@samleygo.com.gh](mailto:support@samleygo.com.gh) · +233 (0) 30 200 4567.',
        },
        {
          kind: 'p',
          text: 'Related: [Terms of Service](/terms) · [Delivery Policy](/delivery-policy) · [Payment Policy](/payment-policy) · [Privacy Policy](/privacy).',
        },
      ],
    },
  ],
};
