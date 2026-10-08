import type { LegalDocument } from '../types';

/** Cookie Policy — the app sets no cookies; this documents what it uses instead. */
export const cookiesDocument: LegalDocument = {
  key: 'cookies',
  path: '/cookies',
  title: 'Cookie Policy — SamleyGo Ghana',
  heading: 'Cookie Policy',
  navTitle: 'Cookie Policy',
  metaTitle: 'Cookie Policy | SamleyGo Ghana',
  metaDescription:
    'How SamleyGo uses cookies, local storage, session storage and cached files — and how to control them.',
  summary:
    'This Cookie Policy explains the technologies SamleyGo uses to keep you signed in, remember your basket and preferences, and load the application quickly — and what "cookies" means for a platform like ours.',
  sections: [
    {
      id: 'what-cookies-are',
      title: '1. What Cookies Are',
      blocks: [
        {
          kind: 'p',
          text: 'Cookies are small text files that a website asks your browser to store. They are commonly used to keep you signed in, remember choices between visits and measure how a site is used.',
        },
        {
          kind: 'p',
          text: 'Related technologies work in similar ways: local storage and session storage keep key-value data in your browser, and cached application files let an app open without downloading everything again. This policy covers all of them.',
        },
      ],
    },
    {
      id: 'why-samleygo-uses',
      title: '2. Why SamleyGo Uses These Technologies',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo uses browser storage rather than cookies. The purposes are practical ones:',
        },
        {
          kind: 'list',
          items: [
            'to keep you signed in while you move through the app;',
            'to remember the basket you are building and the restaurant it belongs to;',
            'to remember your chosen delivery area and whether you are using your device location;',
            'to remember preferences such as alert sounds and turn-by-turn voice;',
            'to store your session so the sign-in screen does not appear every time you open the app;',
            'to cache the application\'s own files so it opens quickly and continues to work with a poor connection.',
          ],
        },
        {
          kind: 'p',
          text: 'We do not use these technologies to follow you across other websites, to build advertising profiles or to power third-party analytics.',
        },
      ],
    },
    {
      id: 'essential',
      title: '3. Essential Storage',
      blocks: [
        {
          kind: 'p',
          text: 'Essential storage is what the platform needs to function. Turning it off — by clearing site data or blocking storage — will stop the app from working properly.',
        },
        {
          kind: 'terms',
          items: [
            {
              term: 'Basket',
              definition:
                'Remembers the items in your basket and the restaurant they belong to between pages and between visits.',
            },
            {
              term: 'Delivery area',
              definition:
                'Remembers the delivery area or address label you last chose, and whether you asked the app to use your device location.',
            },
            {
              term: 'Application cache',
              definition:
                'A cached copy of the app\'s own files, so it loads fast and can open without a connection. It never contains other users\' data.',
            },
          ],
        },
      ],
    },
    {
      id: 'auth-session',
      title: '4. Authentication and Session Storage',
      blocks: [
        {
          kind: 'p',
          text: 'When you sign in, our authentication provider issues a session that your browser stores locally (under a key that identifies the SamleyGo project). This is what keeps you signed in.',
        },
        {
          kind: 'list',
          items: [
            'The session contains your sign-in tokens and basic account details needed to restore your login.',
            'It is refreshed automatically while you use the app so you are not repeatedly asked to sign in.',
            'Signing out clears it from your browser.',
            'If you clear your browser data, you will simply be signed out and can sign in again.',
            'Never store your password in the browser, and sign out on a shared device.',
          ],
        },
      ],
    },
    {
      id: 'preferences',
      title: '5. Preferences',
      blocks: [
        {
          kind: 'p',
          text: 'Small preference flags are stored on your device so the app behaves the way you last set it:',
        },
        {
          kind: 'list',
          items: [
            'order-alert sound muted or on;',
            'turn-by-turn navigation voice enabled or off;',
            'whether the launch screen has already been shown in this session (so it does not play every time you switch tabs);',
            'the last delivery label you chose.',
          ],
        },
        {
          kind: 'p',
          text: 'These values stay on your device and are not sent to us.',
        },
      ],
    },
    {
      id: 'security',
      title: '6. Security',
      blocks: [
        {
          kind: 'p',
          text: 'Storage is also used to protect the platform: your session identifies you to the server, and every request is checked against your identity and role before data is returned.',
        },
        {
          kind: 'list',
          items: [
            'Information in your browser is only as safe as your device — use a screen lock and do not share your sign-in.',
            'If you suspect your session has been compromised, sign out, change your password and contact [support@samleygo.com.gh](mailto:support@samleygo.com.gh).',
            'Clearing your browser data removes the local session; it does not delete your account.',
          ],
        },
      ],
    },
    {
      id: 'analytics',
      title: '7. Analytics',
      blocks: [
        {
          kind: 'p',
          text: 'SamleyGo does not currently use cookies or storage for analytics. There is no Google Analytics, advertising pixel, heat-mapping or session-replay tool in the application.',
        },
        {
          kind: 'p',
          text: 'We may use operational information the platform generates itself — such as order history and error reports — to keep the service running and secure. If analytics are ever introduced, this policy will be updated first.',
        },
      ],
    },
    {
      id: 'third-party',
      title: '8. Third-Party Technologies',
      blocks: [
        {
          kind: 'p',
          text: 'Some services we embed are operated by other companies. They may use their own cookies or storage under their own policies:',
        },
        {
          kind: 'list',
          items: [
            'Mapping and address search services — used to draw the map and suggest addresses as you type.',
            'The routing service — used to calculate a route between a pickup and delivery point.',
            'The cloud platform behind SamleyGo — which stores your session and application data.',
            'The font service used to display the interface typeface.',
          ],
        },
        {
          kind: 'p',
          text: 'SamleyGo does not control these technologies and recommends reviewing the policies of the providers concerned.',
        },
      ],
    },
    {
      id: 'local-storage',
      title: '9. Local Storage and Similar Technologies',
      blocks: [
        {
          kind: 'p',
          text: 'In summary, the SamleyGo application stores the following in your browser. None of it is a traditional cookie, and none of it is shared with advertisers.',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Your sign-in session (issued by our authentication provider).',
            'Your basket — items and the selected restaurant.',
            'Your last chosen delivery area and your device-location preference.',
            'Interface preferences: alert sound and navigation voice.',
            'A fallback application configuration value used when the app is connected to a project at runtime.',
            'Session flags: whether the launch screen has already played, and a temporary sign-up notice.',
            'A cached copy of the application\'s own files (cache storage, managed by the app\'s service worker).',
          ],
        },
      ],
    },
    {
      id: 'managing',
      title: '10. Managing These Technologies',
      blocks: [
        {
          kind: 'p',
          text: 'You are in control of what your browser stores:',
        },
        {
          kind: 'list',
          items: [
            'Clear site data for SamleyGo in your browser settings to remove stored session, basket and preference values — you will be signed out and your basket will be emptied.',
            'Use private/incognito browsing if you do not want data retained after you close the window.',
            'Block storage for the site if you prefer — the platform will not function correctly without it.',
            'Turn location permission on or off at any time through your browser or device settings; this is separate from storage.',
            'Uninstalling the app removes its cached files from your device; it does not close your account.',
          ],
        },
        {
          kind: 'p',
          text: 'Instructions for clearing site data differ by browser and device; your browser\'s help pages will have the steps.',
        },
      ],
    },
    {
      id: 'changes',
      title: '11. Changes to This Cookie Policy',
      blocks: [
        {
          kind: 'p',
          text: 'We may update this policy as the platform changes. The date at the top of the document shows when it was last updated, and material changes will be signalled through the platform.',
        },
        {
          kind: 'p',
          text: 'See also our [Privacy Policy](/privacy) for how we handle personal information generally.',
        },
      ],
    },
    {
      id: 'contact',
      title: '12. Contact',
      blocks: [
        {
          kind: 'p',
          text: 'Questions about this policy, or about data stored in your browser, can be sent to [support@samleygo.com.gh](mailto:support@samleygo.com.gh), through the in-app [Support screen](/support), or by phone on +233 (0) 30 200 4567.',
        },
      ],
    },
  ],
};
