import type { LegalDocument } from '../types';

/** Delivery Policy — describes the real courier workflow and honest ETA wording. */
export const deliveryPolicyDocument: LegalDocument = {
  key: 'delivery',
  path: '/delivery-policy',
  title: 'Delivery Policy — SamleyGo Ghana',
  heading: 'Delivery Policy',
  navTitle: 'Delivery Policy',
  metaTitle: 'Delivery Policy | SamleyGo Ghana',
  metaDescription:
    'How SamleyGo deliveries work in Ghana: preparation, courier assignment, tracking, delivery estimates and failed deliveries.',
  summary:
    'This policy explains how an order travels from a kitchen to your door — how couriers are assigned, what you can track, why arrival times change, and what happens when a delivery cannot be completed.',
  sections: [
    {
      id: 'about',
      title: '1. About This Policy',
      blocks: [
        {
          kind: 'p',
          text: 'This policy applies to deliveries arranged through SamleyGo and should be read with our [Terms of Service](/terms), [Refund & Cancellation Policy](/refunds) and [Payment Policy](/payment-policy).',
        },
        {
          kind: 'p',
          text: 'It applies to customers ordering food and to the restaurants and couriers fulfilling those orders.',
        },
      ],
    },
    {
      id: 'how-it-works',
      title: '2. How Delivery Works',
      blocks: [
        {
          kind: 'p',
          text: 'A delivery follows the same steps every time:',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'You place an order and confirm a delivery address.',
            'The restaurant accepts it and begins preparing the food.',
            'When the order is ready, it is offered to couriers and a courier is assigned.',
            'The courier collects the order from the restaurant.',
            'The courier navigates to you, following the route calculated for the trip.',
            'The courier hands the order to you and confirms delivery in the app.',
            'The order closes and appears in your order history.',
          ],
        },
        {
          kind: 'p',
          text: 'Each step changes the order\'s status, and you see those changes live on your order screen.',
        },
      ],
    },
    {
      id: 'areas-fees',
      title: '3. Delivery Areas and Fees',
      blocks: [
        {
          kind: 'p',
          text: 'Delivery is available where there are participating restaurants and available couriers. The fee for your delivery is calculated for each order and shown before you confirm it.',
        },
        {
          kind: 'list',
          items: [
            'The fee is based on the distance between the restaurant and your delivery point, together with the pricing rules in force at that time.',
            'Distance is measured along the road route where a reasonable route is available; otherwise a direct distance between the two points is used.',
            'A minimum fee applies, and a maximum fee applies where one is configured for the platform.',
            'Fees can change with operational conditions; the fee shown at checkout is the fee for your order.',
          ],
        },
        {
          kind: 'p',
          text: 'More detail is in the [Terms of Service](/terms) and [Payment Policy](/payment-policy).',
        },
      ],
    },
    {
      id: 'preparation',
      title: '4. Restaurant Preparation',
      blocks: [
        {
          kind: 'p',
          text: 'The restaurant controls preparation time. A courier is sent when the order is ready for collection, so that food spends less time waiting.',
        },
        {
          kind: 'list',
          items: [
            'Restaurants indicate readiness through the platform, which triggers the request for a courier.',
            'Preparation can take longer than expected at busy periods; your order screen reflects the status the restaurant has set.',
            'If a restaurant is running late, the courier may wait at the pickup point — the app shows the order as waiting.',
          ],
        },
      ],
    },
    {
      id: 'courier-assignment',
      title: '5. Courier Assignment',
      blocks: [
        {
          kind: 'p',
          text: 'Ready orders are made available to couriers who are online and available. A courier can be assigned by the restaurant or offered to nearby couriers, who accept the trip through the courier app.',
        },
        {
          kind: 'list',
          items: [
            'Couriers must be online in the courier app to receive and carry out deliveries.',
            'While online, a courier\'s device shares their position so they can be matched to a nearby order and tracked on an active delivery.',
            'If an assigned courier cannot take the order — for example they go offline — the order returns to being available for another courier.',
            'Where no courier is available, the order may be delayed; we will tell you if that happens.',
          ],
        },
      ],
    },
    {
      id: 'pickup',
      title: '6. Collection at the Restaurant',
      blocks: [
        {
          kind: 'p',
          text: 'The courier collects the order from the restaurant\'s pickup point, checks it against the order, and confirms collection in the app. That confirmation starts the journey to you.',
        },
        {
          kind: 'list',
          items: [
            'The restaurant hands over the order to the courier — customers do not need to collect in person.',
            'If the courier believes the order is incomplete or damaged at pickup, they will contact the restaurant (and you if needed) before leaving.',
            'The pickup location is the restaurant\'s pinned address, which the courier navigates to directly.',
          ],
        },
      ],
    },
    {
      id: 'navigation',
      title: '7. Routing and Navigation',
      blocks: [
        {
          kind: 'p',
          text: 'When a trip begins, a route is calculated between the pickup point and your delivery point and used for distance, arrival estimates and turn-by-turn guidance in the courier app.',
        },
        {
          kind: 'list',
          items: [
            'Routes are calculated by a routing service using the trip\'s coordinates.',
            'Couriers may follow their own navigation app if they prefer; the delivery remains tracked either way.',
            'If the calculated route is not sensible for the trip, a direct distance is used instead for pricing purposes.',
            'Navigation voice can be turned on or off in the app; the setting is remembered on the courier\'s device.',
          ],
        },
      ],
    },
    {
      id: 'tracking',
      title: '8. Live Tracking',
      blocks: [
        {
          kind: 'p',
          text: 'While your order is being delivered, your order screen shows the courier\'s reported position and the order\'s current status, updated as the courier\'s device reports in.',
        },
        {
          kind: 'list',
          items: [
            'Updates arrive roughly every 10 seconds during an active delivery, and less often between deliveries.',
            'Position breadcrumbs are recorded for the delivery so progress can be followed even if a momentary signal gap occurs.',
            'Tracking is available to you, to the restaurant and to our operations team for that order only.',
            'Tracking stops when the order is delivered or closed; the record stays in your order history.',
          ],
        },
        {
          kind: 'p',
          text: 'A live map needs a data connection. If your connection drops, updates resume when it returns; the underlying delivery continues regardless.',
        },
      ],
    },
    {
      id: 'estimates',
      title: '9. Delivery Estimates',
      blocks: [
        {
          kind: 'p',
          text: 'Any arrival time shown — on the menu, at checkout or on the order screen — is an estimate. It is calculated from preparation time, distance and current conditions, and it can change while your order is in progress.',
        },
        {
          kind: 'note',
          tone: 'important',
          title: 'Estimates are not guarantees',
          text: 'A delivery can arrive earlier or later than shown. Please do not rely on an estimated time for a time-critical commitment without leaving a margin.',
        },
      ],
    },
    {
      id: 'factors',
      title: '10. What Affects Delivery Time',
      blocks: [
        {
          kind: 'list',
          items: [
            'Traffic and road conditions, including jams, road closures and diversions.',
            'Weather — heavy rain and flooding slow down every journey.',
            'Restaurant preparation running long, or an unusually busy period.',
            'Distance and the route available between the restaurant and your address.',
            'Courier availability in your area at that moment.',
            'Your availability and the ease of reaching your exact drop-off point.',
          ],
        },
        {
          kind: 'p',
          text: 'Where a delay is significant and we know about it, your order screen and notifications will reflect the new status.',
        },
      ],
    },
    {
      id: 'availability',
      title: '11. Being Available to Receive an Order',
      blocks: [
        {
          kind: 'p',
          text: 'Someone needs to be at the delivery address to receive the order. Please:',
        },
        {
          kind: 'list',
          items: [
            'keep the phone number on your order reachable — the courier will call on approach;',
            'arrange for someone else to receive it if you cannot be there;',
            'reply promptly if the courier cannot find you or the entrance;',
            'if you expect a delay on your side, tell us early — we may be able to ask the courier to wait a reasonable time.',
          ],
        },
        {
          kind: 'p',
          text: 'Repeated inability to receive an order is treated as a failed delivery under the [Refund & Cancellation Policy](/refunds).',
        },
      ],
    },
    {
      id: 'address',
      title: '12. Delivery Address Accuracy',
      blocks: [
        {
          kind: 'p',
          text: 'The address and map pin you give us are what the courier navigates to. Please check them before confirming.',
        },
        {
          kind: 'list',
          items: [
            'Move the pin to your actual building or gate where the default pin is on the road or in the wrong place.',
            'Add landmarks, floor, room or gate details in the delivery notes — these help enormously in estates and busy areas.',
            'If you realise the address is wrong after ordering, tell the courier and [Support](/support) immediately.',
            'A corrected address that requires significantly more travel may change the delivery fee.',
          ],
        },
      ],
    },
    {
      id: 'failed-delivery',
      title: '13. Failed Delivery',
      blocks: [
        {
          kind: 'p',
          text: 'A delivery fails when the courier cannot hand the order over. The usual causes are that nobody answered, the address could not be found, or the location was not accessible.',
        },
        {
          kind: 'list',
          items: [
            'The courier attempts to contact you on the number provided before anything else happens.',
            'If you respond, the courier will normally wait a reasonable time and complete the delivery.',
            'If the delivery still cannot be completed, the order is closed and reported; the food value is then assessed for a refund.',
            'Where the failure was caused by an incorrect address or by repeated unavailability, the outcome may differ — see the [Refund & Cancellation Policy](/refunds).',
          ],
        },
      ],
    },
    {
      id: 'restricted-unsafe',
      title: '14. Restricted, Difficult or Unsafe Locations',
      blocks: [
        {
          kind: 'p',
          text: 'For the safety of couriers and the reliability of deliveries, a courier may decline to enter a location or to complete a drop-off where:',
        },
        {
          kind: 'list',
          items: [
            'it is unsafe, hostile, or the courier is asked to go somewhere secluded;',
            'access is restricted and cannot be arranged — for example a controlled gate with no way in and no one responding;',
            'the location is outside the area served, or unreachable by the vehicle being used;',
            'completing the delivery would require the courier to break the law or a road-safety rule (for example, entering a place where they cannot safely stop or park).',
          ],
        },
        {
          kind: 'p',
          text: 'If this happens, the courier will contact you to arrange a nearby meeting point where possible. If no safe arrangement can be made, the delivery is treated as failed.',
        },
      ],
    },
    {
      id: 'communication',
      title: '15. Communication During Delivery',
      blocks: [
        {
          kind: 'p',
          text: 'You can reach the courier assigned to your order from the order screen, and the courier can call or message you using the number on the order. Please keep communication professional and focused on completing the delivery.',
        },
        {
          kind: 'list',
          items: [
            'Contact details are shared only for the delivery in progress.',
            'You are not required to share any information beyond what the delivery needs.',
            'Harassment or abuse of a courier (or of restaurant staff) is prohibited and may lead to account action.',
            'If a conversation becomes uncomfortable, end it and report it to [Support](/support).',
          ],
        },
      ],
    },
    {
      id: 'proof',
      title: '16. Proof of Delivery',
      blocks: [
        {
          kind: 'p',
          text: 'A delivery is confirmed when the courier marks the order as delivered in the app. That confirmation — together with the courier\'s reported positions for the trip and any status history — forms the record of the delivery.',
        },
        {
          kind: 'list',
          items: [
            'The courier confirms handover after reaching your address.',
            'If you received it differently (for example, it was left with a gatekeeper or colleague), tell the courier before they close the order so the record is accurate.',
            'The status history of an order is available to you, the restaurant, the courier and our support team.',
          ],
        },
      ],
    },
    {
      id: 'problems',
      title: '17. Problems With a Delivery',
      blocks: [
        {
          kind: 'p',
          text: 'If something goes wrong — late arrival, a missing or damaged order, a courier who could not be reached — contact [Support](/support) with your order reference. Most issues are resolved the same day.',
        },
        {
          kind: 'p',
          text: 'Refunds, replacements and complaints are handled under the [Refund & Cancellation Policy](/refunds). Couriers and restaurants are bound by their own partner terms on conduct, safety and confidentiality.',
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
          text: 'Related: [Terms of Service](/terms) · [Refund & Cancellation Policy](/refunds) · [Payment Policy](/payment-policy) · [Courier / Delivery Partner Terms](/courier-partner-terms).',
        },
      ],
    },
  ],
};
