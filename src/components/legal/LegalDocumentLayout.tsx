import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LegalBlock, LegalDocument } from '../../legal/types';
import { LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from '../../legal/registry';
import { LegalFooter } from './LegalFooter';

/* ── Inline copy ─────────────────────────────────────────────────────────── */

const LINK_CLASS =
  'font-semibold text-brand-dark underline decoration-slate-300 underline-offset-4 transition hover:decoration-brand-dark';
const BODY_CLASS = 'text-[15px] leading-7 text-slate-700';

/**
 * Renders `LegalText`: plain prose plus markdown-lite links
 * (`[Support](/support)`, `[us](mailto:…)`). Internal paths become router
 * links so moving between documents does not reload the app.
 */
const InlineText: React.FC<{ text: string }> = ({ text }) => {
  const nodes: React.ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const [, label, href] = match;
    nodes.push(
      href.startsWith('/') ? (
        <Link key={key++} to={href} className={LINK_CLASS}>
          {label}
        </Link>
      ) : (
        <a key={key++} href={href} className={LINK_CLASS}>
          {label}
        </a>
      )
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
};

/* ── Blocks ──────────────────────────────────────────────────────────────── */

const LegalBlockView: React.FC<{ block: LegalBlock }> = ({ block }) => {
  switch (block.kind) {
    case 'p':
      return (
        <p className={BODY_CLASS}>
          <InlineText text={block.text} />
        </p>
      );

    case 'list': {
      const List: 'ul' | 'ol' = block.ordered ? 'ol' : 'ul';
      return (
        <List
          className={`${
            block.ordered ? 'list-decimal' : 'list-disc'
          } space-y-2 pl-5 marker:font-semibold marker:text-slate-400 ${BODY_CLASS}`}
        >
          {block.items.map((item, index) => (
            <li key={index} className="pl-1">
              <InlineText text={item} />
            </li>
          ))}
        </List>
      );
    }

    case 'sub':
      return (
        <div className="space-y-3">
          <h3 className="text-base font-bold text-slate-900 sm:text-[17px]">{block.title}</h3>
          {block.blocks.map((child, index) => (
            <LegalBlockView key={index} block={child} />
          ))}
        </div>
      );

    case 'terms':
      return (
        <dl className="space-y-4">
          {block.items.map((item, index) => (
            <div key={index}>
              <dt className="text-[15px] font-bold text-slate-900">
                <InlineText text={item.term} />
              </dt>
              <dd className={`mt-1 ${BODY_CLASS}`}>
                <InlineText text={item.definition} />
              </dd>
            </div>
          ))}
        </dl>
      );

    case 'note': {
      const important = block.tone === 'important';
      return (
        <div
          role="note"
          className={`rounded-xl border p-4 ${
            important ? 'border-orange-200 bg-orange-50' : 'border-emerald-200 bg-emerald-50'
          }`}
        >
          {block.title && (
            <p
              className={`text-sm font-bold ${
                important ? 'text-orange-950' : 'text-emerald-950'
              }`}
            >
              {block.title}
            </p>
          )}
          <p
            className={`mt-1 text-sm leading-6 ${
              important ? 'text-orange-950/90' : 'text-emerald-950/90'
            } ${block.title ? '' : 'mt-0'}`}
          >
            <InlineText text={block.text} />
          </p>
        </div>
      );
    }
  }
};

/* ── Page ────────────────────────────────────────────────────────────────── */

/**
 * One layout for every SamleyGo legal document: masthead (logo, title,
 * dates), a compact "On this page" contents — a sticky sidebar on desktop and
 * a native collapsible on phones — the numbered chapters, and the legal
 * footer. Pages keep the site header and the mobile bottom navigation; the
 * bottom padding here keeps the last paragraph and footer clear of the bar.
 *
 * It also owns the page metadata: document title, meta description and
 * canonical URL, restored when you navigate away.
 */
export const LegalDocumentLayout: React.FC<{ document: LegalDocument }> = ({ document: doc }) => {
  const sectionIds = useMemo(() => doc.sections.map((section) => section.id), [doc]);
  const [activeId, setActiveId] = useState<string>(sectionIds[0]);

  /* Highlight the chapter currently under the sticky site header. */
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observed = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (observed.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const current = sectionIds.find((id) => visible.has(id));
        if (current) setActiveId(current);
      },
      // A band starting below both the sticky header (65px) and the anchor
      // landing position (scroll-mt-24 = 96px), so a chapter becomes "current"
      // once its heading has passed the top — not while it still sits on the
      // boundary and the previous chapter is being left behind.
      { rootMargin: '-120px 0px -55% 0px' }
    );
    observed.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sectionIds]);

  /* Per-document metadata, restored on unmount so the next page is clean. */
  useEffect(() => {
    const previousTitle = document.title;
    document.title = doc.metaTitle;

    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content ?? '';
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.appendChild(description);
    }
    description.content = doc.metaDescription;

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previousCanonical = canonical?.href ?? '';
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    const href = `${window.location.origin}${doc.path}`;
    canonical.href = href;

    return () => {
      document.title = previousTitle;
      if (description) description.content = previousDescription;
      if (canonical) canonical.href = previousCanonical || href;
    };
  }, [doc]);

  const tocItems = doc.sections.map((section) => (
    <li key={section.id}>
      <a
        href={`#${section.id}`}
        aria-current={activeId === section.id ? 'true' : undefined}
        className={`-ml-px block border-l-2 py-2.5 pl-3 text-[13px] leading-snug transition lg:py-1.5 ${
          activeId === section.id
            ? 'border-brand font-semibold text-brand-dark'
            : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
        }`}
      >
        {section.title}
      </a>
    </li>
  ));

  return (
    <div className="pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12">
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* ── Document masthead ───────────────────────────────────────── */}
        <header className="border-b border-slate-200 pb-7">
          <div className="flex items-center gap-3">
            <span className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 shadow-xs">
              <img src="/logo-mark.png" alt="" className="h-full w-full object-cover" />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-dark">
                SamleyGo Ghana
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">Legal &amp; Policies</p>
            </div>
          </div>

          <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            {doc.heading}
          </h1>
          <p className="mt-1.5 text-sm font-semibold text-slate-600">{doc.title}</p>

          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            <span>Last Updated: {LEGAL_LAST_UPDATED}</span>
            <span>Effective Date: {LEGAL_EFFECTIVE_DATE}</span>
          </p>

          <p className="mt-5 max-w-2xl text-[15px] leading-7 text-slate-600">{doc.summary}</p>
        </header>

        {/* ── Contents (phones / small tablets) ───────────────────────── */}
        <details className="group mt-6 rounded-2xl border border-slate-200 bg-white lg:hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-800">
            <span>On this page</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <nav aria-label="On this page" className="border-t border-slate-100 px-3 py-3">
            <ol className="space-y-0.5 border-l border-slate-200">{tocItems}</ol>
          </nav>
        </details>

        {/* ── Sidebar contents + article ──────────────────────────────── */}
        <div className="mt-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12 xl:gap-16">
          <aside className="hidden lg:block">
            <nav
              aria-label="On this page"
              className="sticky top-20 max-h-[calc(100vh-7rem)] overflow-y-auto overscroll-contain pb-6"
            >
              <p className="pl-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                On this page
              </p>
              <ol className="mt-3 space-y-0.5 border-l border-slate-200">{tocItems}</ol>
            </nav>
          </aside>

          <article className="min-w-0 max-w-[42rem] space-y-9">
            {doc.sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-heading`}
                className="scroll-mt-24 space-y-4 border-t border-slate-100 pt-9 first:border-t-0 first:pt-0"
              >
                <h2
                  id={`${section.id}-heading`}
                  className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl"
                >
                  {section.title}
                </h2>
                {section.blocks.map((block, index) => (
                  <LegalBlockView key={index} block={block} />
                ))}
              </section>
            ))}
          </article>
        </div>

        <LegalFooter />
      </main>
    </div>
  );
};
