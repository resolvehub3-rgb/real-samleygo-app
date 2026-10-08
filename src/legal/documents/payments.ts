import type { LegalDocument } from '../types';

/**
 * Payment Policy — describes only what the product does: GHS checkout, the
 * methods actually offered, payment records with references, and the fact that
 * no card credentials are ever collected or stored. No gateway is named.
 */
export const paymentPolicyDocument: LegalDocument = {
  key: 'payments',
  path: '/payment-policy',
  title: 'Payment Policy — SamleyGo Ghana',
  heading: 'Payment Policy',
  navTitle: 'Payment Policy',
  metaTitle: 'Payment Policy | SamleyGo Ghana',
  metaDescription:
    'How orders are charged on SamleyGo: Ghana Cedi checkout, mobile money, cards and cash, payment records, duplicates, reversals and refunds.',
  summary:
    'This policy explains how an order is charged, the payment methods SamleyGo offers in Ghana, how payment records work, and what happens when a payment fails, is duplicated or has to be reversed or refunded.',
  sections: [
    {
      id: 'about',
      title: '1. About This Policy',
      blocks: [
        {
          kind: 'p',
          text: 'This policy covers payments for orders placed through SamleyGo. It should be read with our [Terms of Service](/terms) and [Refund & Cancellation Policy](/refunds).',
        },
        {
          kind: 'p',
          text: 'It applies to customers paying for orders. Restaurant partners should also see the [Restaurant Partner Terms](/restaurant-partner-terms), which explain how the restaurant\'s own settlement is calculated.',
        },
      ],
    },
    {
      id: 'currency',
      title: '2. Ghana Cedi Transactions',
      blocks: [
        {
          kind: 'p',
          text: 'All prices, charges, fees, tips and refunds on SamleyGo are expressed in Ghana Cedis (GHS) and shown with the GH₵ symbol.',
        },
        {
          kind: 'list',
          items: [
            'The amount you are charged for an order is the amount displayed in Ghana Cedis on the checkout screen when you confirm it.',
            'Your mobile money wallet or bank may apply its own exchange rate or charges if your account is in another currency; SamleyGo does not control those.',
            'Receipts and transaction records for your orders are available in your order history.',
          ],
        },
      ],
    },
    {
      id: 'methods',
      title: '3. Payment Methods',
      blocks: [
        {
          kind: 'p',
          text: 'The payment methods available for an order are shown when you check out, and may include:',
        },
        {
          kind: 'list',
          items: [
            'MTN Mobile Money (MTN MoMo)',
            'Telecel Cash',
            'AT Money',
            'Bank card',
            'Cash on delivery',
          ],
        },
        {
          kind: 'p',
          text: 'The methods available to you depend on your location, your order and the configuration in place at the time. If you are unsure what is available, check the payment screen before confirming the order.',
        },
      ],
    },
    {
      id: 'mobile-money',
      title: '4. Mobile Money',
      blocks: [
        {
          kind: 'p',
          text: 'For a mobile money payment you select the wallet you want to use and confirm the number the payment should be made from.',
        },
        {
          kind: 'list',
          items: [
            'You authorise the charge for the total shown at checkout for the order you confirm.',
            'Your mobile money PIN is never entered into SamleyGo — it is entered only in your wallet provider\'s own flow.',
            'SamleyGo records the wallet number you provide against the payment so the transaction can be identified and reconciled.',
            'If the payment is not completed, the order is not confirmed; if money leaves your account anyway, contact us with the reference and we will investigate.',
          ],
        },
      ],
    },
    {
      id: 'cards',
      title: '5. Bank Cards',
      blocks: [
        {
          kind: 'p',
          text: 'Where card payment is offered, it is completed through the payment channel presented to you at checkout.',
        },
        {
          kind: 'note',
          tone: 'important',
          title: 'SamleyGo never sees your card number',
          text: 'The application does not ask for, collect or store card numbers, expiry dates, CVVs or banking passwords. Card credentials are entered only with the payment channel handling the transaction.',
        },
      ],
    },
    {
      id: 'cash',
      title: '6. Cash on Delivery',
      blocks: [
        {
          kind: 'p',
          text: 'If cash on delivery is available and you choose it, you pay the courier in cash when the order is handed to you.',
        },
        {
          kind: 'list',
          items: [
            'Prepare the correct amount where you can — couriers may not carry change.',
            'The order still appears in your order history with cash selected as its payment method.',
            'If you do not take delivery of the order, you do not pay cash for it; the order is then handled under the [Refund & Cancellation Policy](/refunds).',
            'A cash order has no online payment to reverse — anything owed is settled directly with you.',
          ],
        },
      ],
    },
    {
      id: 'what-you-pay',
      title: '7. What You Pay',
      blocks: [
        {
          kind: 'p',
          text: 'The checkout screen shows an itemised total before you confirm. It consists of:',
        },
        {
          kind: 'terms',
          items: [
            { term: 'Food subtotal', definition: 'The prices set by the restaurant for the items in your basket.' },
            {
              term: 'Delivery fee',
              definition:
                'Calculated from the delivery distance and the pricing rules in force at the time — see the [Delivery Policy](/delivery-policy).',
            },
            { term: 'Tip', definition: 'Optional, and whatever you choose — including nothing.' },
            {
              term: 'Any other charge',
              definition:
                'Must be shown on the checkout screen before you confirm. If it is not shown, it is not charged.',
            },
          ],
        },
        {
          kind: 'p',
          text: 'SamleyGo does not add a hidden or separate platform commission to a customer checkout. A restaurant\'s commission is a business arrangement between SamleyGo and the restaurant, deducted from the restaurant\'s own settlement — it is never charged to you as a customer fee.',
        },
      ],
    },
    {
      id: 'authorisation',
      title: '8. Authorisation and Confirmation',
      blocks: [
        {
          kind: 'p',
          text: 'When you tap the place-order button you are authorising SamleyGo to charge the total shown, using the method you selected, for that order.',
        },
        {
          kind: 'list',
          items: [
            'The order summary — items, address, delivery fee, tip and total — is displayed for you to check before you confirm.',
            'Once the order is placed, it is sent to the restaurant for acceptance.',
            'A payment record is created for the order showing the amount, the currency (GHS), the method, the status and a payment reference unique to that order.',
            'You can view your order and its payment details in your order history.',
          ],
        },
      ],
    },
    {
      id: 'records',
      title: '9. Payment Records and References',
      blocks: [
        {
          kind: 'p',
          text: 'Every order carries a payment reference. The reference identifies the transaction within SamleyGo and is what you should quote when you contact support about a payment.',
        },
        {
          kind: 'list',
          items: [
            'The recorded amount for an order is taken from the order itself, so the payment record and the order can never disagree.',
            'Payment records can be viewed by the parties to the order and by administrators.',
            'Financial records are used for reconciliation, customer service, refunds and accounting.',
            'Payment records cannot be edited by clients of the platform — corrections are made through controlled, audited processes.',
          ],
        },
      ],
    },
    {
      id: 'failed-payments',
      title: '10. Failed Payments',
      blocks: [
        {
          kind: 'p',
          text: 'A payment can fail — insufficient balance, a network timeout, a wallet limit, or a card decline.',
        },
        {
          kind: 'list',
          items: [
            'If a payment fails, the order should not be confirmed. Try again, or choose another method.',
            'If money appears to have left your account for a failed payment, contact [Support](/support) with the reference and time so we can trace it.',
            'Your provider may take time to release a failed authorisation; we cannot speed up our provider, but we will confirm the position from our records.',
          ],
        },
      ],
    },
    {
      id: 'duplicates',
      title: '11. Duplicate Charges',
      blocks: [
        {
          kind: 'p',
          text: 'If you believe the same order has been charged twice:',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'check your order history — two separate orders are two separate charges;',
            'if you see one order with two charges, contact [Support](/support) with both references or your wallet messages;',
            'we will compare our records with your provider and, where a duplicate is confirmed, refund it.',
          ],
        },
      ],
    },
    {
      id: 'reversals',
      title: '12. Reversals',
      blocks: [
        {
          kind: 'p',
          text: 'A reversal happens when a transaction is unwound — for example when your provider reverses a payment, or when an order is cancelled after payment and the money is returned.',
        },
        {
          kind: 'list',
          items: [
            'Where a reversal is valid, the order and its payment record are updated to reflect it.',
            'If a reversal leaves an order unpaid, the order may be cancelled.',
            'Reversals are recorded against the order so the history remains accurate.',
          ],
        },
      ],
    },
    {
      id: 'refunds',
      title: '13. Refunds',
      blocks: [
        {
          kind: 'p',
          text: 'Refunds are dealt with under our [Refund & Cancellation Policy](/refunds). In summary:',
        },
        {
          kind: 'list',
          items: [
            'Eligibility depends on the circumstances of the order and applicable law; a refund is not automatic in every case.',
            'A refund is recorded against the order, including the amount and the reason.',
            'Where payment was taken through a payment channel, the money is returned through the same channel to the original payer.',
            'How long a refund takes depends on the method and on your own provider; we will tell you when it has been recorded.',
            'Partial refunds are made for the specific amount agreed, for example for a missing item.',
          ],
        },
      ],
    },
    {
      id: 'tips',
      title: '14. Tips',
      blocks: [
        {
          kind: 'p',
          text: 'A tip is a voluntary appreciation for the courier. You can choose from the suggested amounts or give nothing — tipping is never required.',
        },
        {
          kind: 'list',
          items: [
            'A tip is added to the total you see at checkout and shown as a separate line.',
            'Tips are passed on to the courier who delivers the order.',
            'If an order is cancelled before delivery, the tip is not retained.',
            'A tip does not affect how quickly an order is picked up or who delivers it.',
          ],
        },
      ],
    },
    {
      id: 'providers',
      title: '15. Payment Providers',
      blocks: [
        {
          kind: 'p',
          text: 'Where a third-party provider processes a payment for us, it does so under its own terms and conditions and its own privacy policy.',
        },
        {
          kind: 'list',
          items: [
            'We share only what is needed to complete and reconcile the transaction — for example the amount, currency, method and reference.',
            'We do not receive or store your card number, your wallet PIN or your banking password.',
            'A provider may refuse, delay or reverse a transaction under its own rules; if that happens we will tell you what we can see.',
            'If a payment is handled outside SamleyGo (for example cash to a courier), no third-party provider is involved.',
          ],
        },
        {
          kind: 'p',
          text: 'The specific methods and providers available to an order are those presented to you at checkout at the time you place it.',
        },
      ],
    },
    {
      id: 'restaurant-commission',
      title: '16. Restaurant Commission Is Not a Customer Charge',
      blocks: [
        {
          kind: 'p',
          text: 'Participating restaurants pay SamleyGo a commission on the food they sell, under their partner agreement. That commission is calculated on the restaurant\'s own sales and deducted from the restaurant\'s settlement.',
        },
        {
          kind: 'list',
          items: [
            'It is never added to a customer order and never appears as a line on your checkout.',
            'The commission rate is configured for the restaurant and snapshotted against each order for the restaurant\'s own accounting.',
            'Customers pay the food price, the delivery fee, any tip and any charge shown to them before they confirm — nothing else.',
          ],
        },
        {
          kind: 'p',
          text: 'Restaurant partners should read the [Restaurant Partner Terms](/restaurant-partner-terms) for how commission and settlement work.',
        },
      ],
    },
    {
      id: 'security',
      title: '17. Payment Security',
      blocks: [
        {
          kind: 'list',
          items: [
            'Communication between the app and our systems is encrypted in transit (HTTPS/TLS).',
            'Amounts and payment statuses are validated and enforced by the database, not by the browser.',
            'Financial records can be corrected only through controlled, audited administrative processes.',
            'Administrative credentials and secrets are kept in server-side configuration and are never part of the application bundle.',
            'SamleyGo does not store card credentials or wallet PINs at any time.',
          ],
        },
        {
          kind: 'p',
          text: 'If you suspect fraud on your account or your wallet, contact [Support](/support) and your payment provider immediately.',
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
          text: 'Related: [Refund & Cancellation Policy](/refunds) · [Delivery Policy](/delivery-policy) · [Terms of Service](/terms) · [Privacy Policy](/privacy).',
        },
      ],
    },
  ],
};
