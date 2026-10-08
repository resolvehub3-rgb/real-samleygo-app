import type { LegalDocument } from '../types';

/** Acceptable Use Policy — the platform's conduct rules and enforcement ladder. */
export const acceptableUseDocument: LegalDocument = {
  key: 'acceptable-use',
  path: '/acceptable-use',
  title: 'Acceptable Use Policy — SamleyGo Ghana',
  heading: 'Acceptable Use Policy',
  navTitle: 'Acceptable Use Policy',
  metaTitle: 'Acceptable Use Policy | SamleyGo Ghana',
  metaDescription:
    'The conduct rules for using SamleyGo: prohibited behaviour, account integrity, enforcement and how to report abuse.',
  summary:
    'SamleyGo works when customers, restaurants and couriers can trust each other. This policy sets out what is not allowed on the platform, how we respond to breaches, and how to report a problem.',
  sections: [
    {
      id: 'scope',
      title: '1. Scope',
      blocks: [
        {
          kind: 'p',
          text: 'This policy applies to everyone who uses SamleyGo — customers, restaurant partners, couriers, and anyone who accesses the platform or its interfaces. It forms part of our [Terms of Service](/terms).',
        },
        {
          kind: 'p',
          text: 'The examples below are not exhaustive. Where a use of the platform is harmful, unlawful or abusive, we may act on it even if it is not listed here.',
        },
      ],
    },
    {
      id: 'account-integrity',
      title: '2. Account Integrity',
      blocks: [
        {
          kind: 'p',
          text: 'Accounts are personal and must be used honestly:',
        },
        {
          kind: 'list',
          items: [
            'Provide accurate registration details and keep them current.',
            'Do not create accounts with false names, disposable details or details belonging to someone else.',
            'Do not lend your account to another person, and do not operate a courier or restaurant account you are not approved for.',
            'Do not open multiple accounts to evade restrictions, manipulate promotions or duplicate benefits.',
            'Keep your password to yourself and sign out on shared devices.',
          ],
        },
      ],
    },
    {
      id: 'fraud',
      title: '3. Fraud',
      blocks: [
        {
          kind: 'p',
          text: 'Fraud is prohibited. This includes, without limitation:',
        },
        {
          kind: 'list',
          items: [
            'placing orders with no intention of paying for them, or paying with instruments you are not entitled to use;',
            'using another person\'s payment method or wallet without permission;',
            'impersonating another person, a restaurant or a courier;',
            'claiming a delivery was completed when it was not;',
            'creating false records, documents or identities to obtain an account or verification.',
          ],
        },
      ],
    },
    {
      id: 'payment-abuse',
      title: '4. Payment and Refund Abuse',
      blocks: [
        {
          kind: 'list',
          items: [
            'Do not reverse, charge back or dispute a payment in bad faith, or when the goods were delivered as ordered.',
            'Do not claim refunds for food you received, for orders that were never placed, or for amounts you were not charged.',
            'Do not exploit errors in pricing, payment or refund processes to obtain money or goods you are not entitled to.',
            'Do not use a payment instrument associated with fraudulent activity.',
          ],
        },
        {
          kind: 'p',
          text: 'Repeated refund claims, or claims that our records contradict, may lead to restrictions on your account — see section 15.',
        },
      ],
    },
    {
      id: 'promotion-abuse',
      title: '5. Promotion Abuse',
      blocks: [
        {
          kind: 'list',
          items: [
            'Do not create multiple accounts, use false identities or collude to claim a promotion more times than its rules allow.',
            'Do not manipulate referral, discount or credit offers.',
            'Do not place orders solely to extract promotional value with no genuine intent to receive the order.',
            'Do not resell or exchange promotional credits for cash except where an offer expressly permits it.',
          ],
        },
      ],
    },
    {
      id: 'harassment',
      title: '6. Harassment, Threats and Abuse',
      blocks: [
        {
          kind: 'p',
          text: 'Everyone using SamleyGo deserves to be treated with respect. You must not:',
        },
        {
          kind: 'list',
          items: [
            'harass, insult, threaten, bully or abuse a customer, restaurant worker, courier or member of our team;',
            'use discriminatory, hateful or sexually harassing language or behaviour;',
            'persistently contact someone after they have asked you to stop;',
            'put a courier or restaurant staff member at ease by pressure, intimidation or deception;',
            'share another person\'s personal details publicly, including in reviews or notes.',
          ],
        },
      ],
    },
    {
      id: 'illegal',
      title: '7. Illegal Activity',
      blocks: [
        {
          kind: 'p',
          text: 'The platform must not be used for unlawful purposes, including:',
        },
        {
          kind: 'list',
          items: [
            'offering, requesting or facilitating prohibited goods or services;',
            'money laundering, theft, deception or any other criminal offence;',
            'violating another person\'s privacy or intellectual property rights;',
            'breaching any licence, permit or food-safety requirement that applies to your activity;',
            'conduct that endangers public safety.',
          ],
        },
        {
          kind: 'p',
          text: 'Where we reasonably believe unlawful activity has occurred, we may report it to the relevant authorities.',
        },
      ],
    },
    {
      id: 'malware',
      title: '8. Malicious Software',
      blocks: [
        {
          kind: 'list',
          items: [
            'Do not upload or transmit malicious code, or interfere with the platform\'s files or data.',
            'Do not introduce viruses, bots, worms or any component designed to damage, disable or gain unauthorised access.',
            'Do not probe, scan or test the vulnerability of the platform or its endpoints without our written authorisation.',
            'Do not attempt to deny service to the platform or its users.',
          ],
        },
      ],
    },
    {
      id: 'unauthorized-access',
      title: '9. Unauthorised Access',
      blocks: [
        {
          kind: 'list',
          items: [
            'Access only the accounts, orders and information you are entitled to.',
            'Do not access another user\'s account, another restaurant\'s orders, or administrative interfaces without permission.',
            'Do not share, sell or transfer access credentials, sessions or API keys.',
            'Do not attempt to obtain data through a channel or role that was not intended for you.',
          ],
        },
      ],
    },
    {
      id: 'scraping',
      title: '10. Automated Access and Scraping',
      blocks: [
        {
          kind: 'list',
          items: [
            'Do not scrape, crawl, harvest or mine listings, prices, users, images or any other content at volume.',
            'Do not use automated scripts or bots to place orders, accept deliveries, reserve promotions or generate traffic.',
            'Do not use the platform to build a competing dataset or service without our written permission.',
            'Accessibility aids and personal automation that assist your own use of the platform are not the intent of this rule.',
          ],
        },
      ],
    },
    {
      id: 'reverse-engineering',
      title: '11. Reverse Engineering',
      blocks: [
        {
          kind: 'p',
          text: 'You must not disassemble, decompile, reverse engineer, copy or create derivative works from the platform, its application files or its interfaces, except where applicable law expressly permits that activity notwithstanding this restriction.',
        },
        {
          kind: 'p',
          text: 'This does not prevent you from reporting a security vulnerability to us responsibly — we welcome responsible disclosure at [support@samleygo.com.gh](mailto:support@samleygo.com.gh).',
        },
      ],
    },
    {
      id: 'manipulation',
      title: '12. Platform Manipulation',
      blocks: [
        {
          kind: 'list',
          items: [
            'Do not artificially inflate ratings, reviews, order counts or sales.',
            'Do not collude with others to influence pricing, availability, ratings or promotions.',
            'Do not interfere with another person\'s order, delivery or account.',
            'Do not misrepresent your role — for example, a customer acting as a courier, or a courier as a customer, to intercept orders.',
            'Do not manipulate live tracking, including spoofing a position or interfering with location reporting.',
          ],
        },
      ],
    },
    {
      id: 'false-claims',
      title: '13. False Complaints and Fraudulent Orders',
      blocks: [
        {
          kind: 'list',
          items: [
            'Do not report an order as missing, damaged or incorrect when it was delivered as placed.',
            'Do not place orders intended to burden, discredit or harm a restaurant or courier.',
            'Do not leave reviews for orders you did not place, or reviews that are false, defamatory or paid for.',
            'Do not misuse support by submitting repeated, abusive or unfounded complaints.',
          ],
        },
      ],
    },
    {
      id: 'tracking-abuse',
      title: '14. Abuse of Tracking and Partner Systems',
      blocks: [
        {
          kind: 'list',
          items: [
            'Customers must not use tracking to stalk, follow or intimidate a courier, or to obtain a courier\'s location outside an active delivery.',
            'Couriers must not use their position access for any purpose other than the delivery they are carrying out.',
            'Couriers must not share customer details, including addresses and phone numbers, with anyone outside that delivery.',
            'Restaurants must not use customer details for marketing they have not consented to.',
            'No one may attempt to disable, spoof or interfere with location sharing while online.',
          ],
        },
      ],
    },
    {
      id: 'bypassing-security',
      title: '15. Bypassing Platform Controls',
      blocks: [
        {
          kind: 'list',
          items: [
            'Do not attempt to circumvent access controls, rate limits, verification steps or role checks.',
            'Do not attempt to change your role, another user\'s role, or an administrator setting.',
            'Do not interfere with the measures used to protect orders, payments or personal information.',
            'Do not use the platform in a way that disables or degrades it for others.',
          ],
        },
      ],
    },
    {
      id: 'enforcement',
      title: '16. How We Respond',
      blocks: [
        {
          kind: 'p',
          text: 'We take breaches seriously and respond in proportion to what happened. Action may include, in ascending order:',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'a warning, where the matter is minor or accidental;',
            'removal of content, or reversal of manipulated activity such as ratings or promotions;',
            'restriction — for example limiting promotions, ordering or features on your account;',
            'suspension of your account while we investigate;',
            'termination of your account and, for partners, of the partner relationship;',
            'reporting to the police or other competent authorities, where legally appropriate, and pursuing available legal remedies.',
          ],
        },
        {
          kind: 'p',
          text: 'We consider the seriousness of the breach, whether it is repeated, the impact on others and whether there is a risk to safety. Serious breaches — fraud, threats, endangering a courier or customer — may lead to immediate suspension.',
        },
        {
          kind: 'p',
          text: 'Where the circumstances allow, we will tell you what action we took and why, and you may ask us to review it through [Support](/support).',
        },
      ],
    },
    {
      id: 'reporting',
      title: '17. Reporting a Problem',
      blocks: [
        {
          kind: 'p',
          text: 'If you see behaviour that breaches this policy, tell us through the in-app [Support screen](/support) or at [support@samleygo.com.gh](mailto:support@samleygo.com.gh), with as much detail as you can — the order reference, the account involved, what happened and when.',
        },
        {
          kind: 'p',
          text: 'In an emergency, or where a crime may have been committed, contact the Ghana Police Service first; you can tell us afterwards so we can secure the account and preserve records.',
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
          text: 'Related: [Terms of Service](/terms) · [Privacy Policy](/privacy) · [Refund & Cancellation Policy](/refunds).',
        },
      ],
    },
  ],
};
