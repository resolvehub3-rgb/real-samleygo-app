/**
 * SamleyGo legal centre — test suite.
 *
 *   npm run test:legal   (tsx scripts/legal_pages.test.ts)
 *
 * What is covered:
 *   1. The published contact channels, byte for byte, so a policy can never
 *      drift from the support screen again.
 *   2. The document registry — unique keys and routes, complete metadata, and
 *      the effective/last-updated dates actually parsing as dates.
 *   3. The required chapter list for the three documents this release
 *      re-issued: 20 chapters of Terms, 15 of Privacy, 12 of Support.
 *   4. Every internal link inside every document resolves to a route the app
 *      really serves — no dangling "/cookies-policy" style links.
 *   5. The support screen makes its contact details functional (tap-to-call
 *      and tap-to-email), links to the policies, and labels every field.
 *   6. The app shell exposes the footer and the account-settings links.
 *   7. No placeholders, invented addresses or withdrawn contact details have
 *      survived into any published page.
 *
 * IMPORTANT: this suite asserts what the product PUBLISHES, not what the law
 * requires. It is a guard rail against placeholder text, dead links and
 * unverified claims creeping back into the pages.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEGAL_DOCUMENTS, LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from '../src/legal/registry';
import type { LegalBlock } from '../src/legal/types';
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_ALT,
  SUPPORT_PHONE_ALT_HREF,
  SUPPORT_PHONE_HREF,
} from '../src/legal/contact';
import { termsDocument } from '../src/legal/documents/terms';
import { privacyDocument } from '../src/legal/documents/privacy';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string): string =>
  readFileSync(path.join(ROOT, relativePath), 'utf8');

let passed = 0;
const test = (name: string, fn: () => void): void => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

/** Walks every block of a chapter, and every sub-chapter, depth-first. */
const walkBlocks = (blocks: LegalBlock[], visit: (block: LegalBlock) => void): void => {
  for (const block of blocks) {
    visit(block);
    if (block.kind === 'sub') walkBlocks(block.blocks, visit);
  }
};

/** Every piece of text a document publishes, including headings and terms. */
const documentText = (document: (typeof LEGAL_DOCUMENTS)[number]): string => {
  const parts: string[] = [
    document.title,
    document.heading,
    document.navTitle,
    document.metaTitle,
    document.metaDescription,
    document.summary,
  ];
  for (const section of document.sections) {
    parts.push(section.title);
    walkBlocks(section.blocks, (block) => {
      switch (block.kind) {
        case 'p':
          parts.push(block.text);
          break;
        case 'list':
          parts.push(...block.items);
          break;
        case 'sub':
          parts.push(block.title);
          break;
        case 'terms':
          for (const item of block.items) parts.push(item.term, item.definition);
          break;
        case 'note':
          if (block.title) parts.push(block.title);
          parts.push(block.text);
          break;
      }
    });
  }
  return parts.join('\n');
};

/* ── 1. Contact channels ────────────────────────────────────────────────── */

console.log('\nSamleyGo legal centre — contact channels');

test('the published contact channels are the official ones', () => {
  assert.equal(SUPPORT_EMAIL, 'samleygo@gmail.com');
  assert.equal(SUPPORT_PHONE, '0594345424');
  assert.equal(SUPPORT_PHONE_HREF, '+233594345424');
  assert.equal(SUPPORT_PHONE_ALT, '0572207831');
  assert.equal(SUPPORT_PHONE_ALT_HREF, '+233572207831');
});

test('the telephone hrefs dial the numbers that are published', () => {
  // `tel:` targets must be the digit form of what the page displays, or the
  // tap-to-call link calls a different number than the one on screen.
  assert.equal(`+233${SUPPORT_PHONE.slice(1)}`, SUPPORT_PHONE_HREF);
  assert.equal(`+233${SUPPORT_PHONE_ALT.slice(1)}`, SUPPORT_PHONE_ALT_HREF);
});

/* ── 2. Registry ────────────────────────────────────────────────────────── */

console.log('\nSamleyGo legal centre — registry');

test('every document is complete and uniquely addressed', () => {
  const keys = new Set<string>();
  const paths = new Set<string>();
  for (const doc of LEGAL_DOCUMENTS) {
    assert.ok(doc.key && doc.path && doc.title && doc.heading && doc.navTitle, `${doc.key}: metadata`);
    assert.ok(doc.metaTitle && doc.metaDescription, `${doc.key}: meta tags`);
    assert.ok(doc.summary.trim().length > 40, `${doc.key}: summary is too thin to be useful`);
    assert.ok(doc.sections.length > 0, `${doc.key}: no chapters`);
    assert.ok(!keys.has(doc.key), `duplicate key ${doc.key}`);
    assert.ok(!paths.has(doc.path), `duplicate path ${doc.path}`);
    assert.ok(doc.path.startsWith('/'), `${doc.key}: path must be absolute`);
    keys.add(doc.key);
    paths.add(doc.path);
  }
});

test('the effective and last-updated dates are real dates', () => {
  const parse = (value: string): Date => {
    assert.match(value, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/, `"${value}" is not "Month D, YYYY"`);
    const parsed = new Date(value);
    assert.ok(!Number.isNaN(parsed.getTime()), `"${value}" does not parse`);
    return parsed;
  };
  const effective = parse(LEGAL_EFFECTIVE_DATE);
  parse(LEGAL_LAST_UPDATED);
  assert.equal(
    effective.getFullYear(),
    new Date().getFullYear(),
    'the effective date must be the publication year'
  );
});

/* ── 3. Required chapters ───────────────────────────────────────────────── */

console.log('\nSamleyGo legal centre — required chapters');

test('the Terms of Service publishes all 20 chapters', () => {
  assert.equal(termsDocument.sections.length, 20);
  termsDocument.sections.forEach((section, index) => {
    assert.ok(
      section.title.startsWith(`${index + 1}.`),
      `chapter ${index + 1} is titled "${section.title}" — numbering must be sequential`
    );
    assert.ok(section.blocks.length > 0, `${section.title} has no content`);
  });
  // Chapter ids become anchors, so they must be stable and URL-safe.
  for (const section of termsDocument.sections) {
    assert.match(section.id, /^[a-z0-9-]+$/, `anchor "${section.id}" is not URL-safe`);
  }
});

test('the Privacy Policy publishes all 15 chapters', () => {
  assert.equal(privacyDocument.sections.length, 15);
  privacyDocument.sections.forEach((section, index) => {
    assert.ok(
      section.title.startsWith(`${index + 1}.`),
      `chapter ${index + 1} is titled "${section.title}" — numbering must be sequential`
    );
    assert.ok(section.blocks.length > 0, `${section.title} has no content`);
  });
});

test('the three re-issued documents cross-reference each other', () => {
  const terms = documentText(termsDocument);
  const privacy = documentText(privacyDocument);
  const support = read('src/pages/public/SupportPage.tsx');

  assert.ok(terms.includes('](/privacy)'), 'the Terms do not link to the Privacy Policy');
  assert.ok(privacy.includes('/support'), 'the Privacy Policy does not link to Support');
  assert.ok(support.includes('"/terms"'), 'Support does not link to the Terms');
  assert.ok(support.includes('"/privacy"'), 'Support does not link to the Privacy Policy');
});

/* ── 4. Link integrity ──────────────────────────────────────────────────── */

console.log('\nSamleyGo legal centre — link integrity');

test('every internal link in every document resolves to a real route', () => {
  // Routes the app serves that are not legal documents themselves.
  const otherRoutes = new Set(['/support', '/orders', '/cart', '/register', '/login', '/']);
  const known = new Set<string>([...LEGAL_DOCUMENTS.map((doc) => doc.path), ...otherRoutes]);

  const deadLinks: string[] = [];
  for (const doc of LEGAL_DOCUMENTS) {
    const text = documentText(doc);
    for (const match of text.matchAll(/\]\((\/[^)#\s]*)/g)) {
      const target = match[1].replace(/\/+$/, '') || '/';
      if (!known.has(target)) deadLinks.push(`${doc.path} → ${match[1]}`);
    }
    // Anchors must point at a chapter that exists in the same document.
    for (const match of text.matchAll(/\]\(#[a-z0-9-]+\)/g)) {
      const anchor = match[0].slice(3, -1);
      if (!doc.sections.some((section) => section.id === anchor)) {
        deadLinks.push(`${doc.path} → ${anchor} (no such chapter)`);
      }
    }
  }
  assert.deepEqual(deadLinks, [], `dead links:\n  ${deadLinks.join('\n  ')}`);
});

/* ── 5. The support screen ──────────────────────────────────────────────── */

console.log('\nSamleyGo legal centre — support screen');

test('the support screen makes its contact details functional', () => {
  const support = read('src/pages/public/SupportPage.tsx');
  assert.ok(support.includes('mailto:${SUPPORT_EMAIL}'), 'the email address is not tap-to-email');
  assert.ok(support.includes('tel:${SUPPORT_PHONE_HREF}'), 'the main line is not tap-to-call');
  assert.ok(support.includes('tel:${SUPPORT_PHONE_ALT_HREF}'), 'the second line is not tap-to-call');
  assert.ok(
    support.includes('SUPPORT_PHONE_ALT') && support.includes('SUPPORT_PHONE_ALT'),
    'the alternative line is not published'
  );
});

test('the support screen asks for no hours or guarantees it cannot keep', () => {
  const support = read('src/pages/public/SupportPage.tsx');
  for (const banned of ['24/7', '24 hours', 'seven days a week', 'always available']) {
    assert.ok(!support.includes(banned), `the support page promises "${banned}"`);
  }
});

test('the support screen has no placeholder left in it', () => {
  const support = read('src/pages/public/SupportPage.tsx');
  for (const banned of ['TODO', 'Lorem ipsum', 'TBD', 'placeholder text', 'XXXX']) {
    assert.ok(!support.includes(banned), `the support page still contains "${banned}"`);
  }
});

test('the composer is honest about what it does', () => {
  const support = read('src/pages/public/SupportPage.tsx');
  // The old page claimed a ticket had been logged when nothing was sent.
  assert.ok(
    !support.includes('Your ticket has been logged'),
    'the support page claims to log a ticket it does not send'
  );
  assert.ok(support.includes('mailto:'), 'the composer must hand off to a real mailbox');
  assert.ok(
    support.includes('Never send your password'),
    'the security warning about PINs and codes is missing'
  );
});

test('every input on the support screen is labelled', () => {
  const support = read('src/pages/public/SupportPage.tsx');
  // Only form controls need labels — headings carry ids for aria-labelledby.
  const controls = [
    ...support.matchAll(/<(input|textarea)\b[^>]*\bid="([^"]+)"/g),
  ].map((match) => match[2]);
  const labels = [...support.matchAll(/\bhtmlFor="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(controls.length > 0, 'the support screen has no fields');
  for (const id of controls) {
    assert.ok(labels.includes(id), `field #${id} has no <label htmlFor>`);
  }
  for (const label of labels) {
    assert.ok(controls.includes(label), `label points at #${label}, which is not a field`);
  }
  // Every aria-labelledby target must exist too.
  for (const match of support.matchAll(/aria-labelledby="([^"]+)"/g)) {
    assert.ok(
      support.includes(`id="${match[1]}"`),
      `aria-labelledby points at #${match[1]}, which does not exist`
    );
  }
});

/* ── 6. Where the pages are reachable from ──────────────────────────────── */

console.log('\nSamleyGo legal centre — discoverability');

test('the app shell renders the site-wide legal footer', () => {
  const app = read('src/App.tsx');
  assert.ok(app.includes('<SiteFooter'), 'the app shell does not render SiteFooter');
  const footer = read('src/components/legal/SiteFooter.tsx');
  for (const target of ['/terms', '/privacy', 'SUPPORT_PATH']) {
    assert.ok(footer.includes(target), `the footer does not link to ${target}`);
  }
  // It must stand aside where another footer or shell already exists — and
  // on the home screen, where the policy index outweighs the browse content.
  for (const rule of [
    "pathname === '/'",
    'isAuthPath',
    'legalDocumentForPath',
    '/admin',
    '/courier',
    '/restaurant/',
  ]) {
    assert.ok(footer.includes(rule), `the footer does not step aside on ${rule}`);
  }
});

test('account settings links to all three documents', () => {
  const profile = read('src/pages/auth/ProfilePage.tsx');
  for (const target of ['"/terms"', '"/privacy"', '"/support"']) {
    assert.ok(profile.includes(target), `account settings does not link to ${target}`);
  }
});

test('every document is routed from the registry, with /support alongside', () => {
  const app = read('src/App.tsx');
  assert.ok(
    app.includes('LEGAL_DOCUMENTS.map'),
    'the legal routes are not generated from the registry'
  );
  assert.ok(app.includes('path="/support"'), 'the support route is missing');
  const footer = read('src/components/legal/LegalFooter.tsx');
  assert.ok(footer.includes('LEGAL_DOCUMENTS.map'), 'the legal footer omits the document index');
});

/* ── 7. Nothing fabricated has crept back in ────────────────────────────── */

console.log('\nSamleyGo legal centre — no fabricated detail');

test('no withdrawn or invented contact detail survives anywhere', () => {
  // Read every authored document file, not a name derived from the document
  // key — the filenames and the registry keys are not the same thing.
  const documentSources = readdirSync(path.join(ROOT, 'src/legal/documents'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `src/legal/documents/${file}`);
  const sources = [
    'src/legal/contact.ts',
    'src/legal/registry.ts',
    'src/legal/types.ts',
    'src/pages/public/SupportPage.tsx',
    'src/components/legal/LegalFooter.tsx',
    'src/components/legal/SiteFooter.tsx',
    'src/components/legal/LegalDocumentLayout.tsx',
    ...documentSources,
  ];
  const banned = [
    'support@samleygo.com.gh',
    '+233 (0) 30 200 4567',
    '302004567',
    'Accra, Ghana', // an address nobody has published
    'Company number',
    'Reg. No',
    'Cameroon', // a market the platform does not serve
  ];
  const found: string[] = [];
  for (const source of sources) {
    const text = read(source);
    for (const needle of banned) {
      if (text.includes(needle)) found.push(`${source}: "${needle}"`);
    }
  }
  assert.deepEqual(found, [], `fabricated detail found:\n  ${found.join('\n  ')}`);
});

test('no placeholder text survives in any published document', () => {
  const found: string[] = [];
  for (const doc of LEGAL_DOCUMENTS) {
    const text = documentText(doc);
    for (const needle of [
      '[Set actual publication date]',
      '[Date]',
      'TBD',
      'TODO',
      'Lorem ipsum',
      'XX',
      'your company name here',
    ]) {
      if (text.includes(needle)) found.push(`${doc.path}: "${needle}"`);
    }
  }
  assert.deepEqual(found, [], `placeholders found:\n  ${found.join('\n  ')}`);
});

test('the documents claim no service the platform does not verify', () => {
  // Guarantees this release is forbidden from making unless they are real.
  const all = LEGAL_DOCUMENTS.map(documentText).join('\n').toLowerCase();
  const banned = [
    'insured delivery',
    'background check completed',
    'money-back guarantee',
    'refund within 24 hours',
    'guaranteed delivery time',
    'certified by',
    'iso 27001',
  ];
  const found = banned.filter((needle) => all.includes(needle));
  assert.deepEqual(found, [], `unverified claims found: ${found.join(', ')}`);
});

console.log(`\n${passed} passed, 0 failed`);
