/**
 * Content model for the SamleyGo legal document centre.
 *
 * Documents are authored as data (not JSX) so every policy shares one layout,
 * one table-of-contents implementation and one set of accessibility rules.
 * Rendering lives in `components/legal/LegalDocumentLayout`.
 */

/**
 * Body copy. Links use a markdown-lite form — `[Support](/support)` or
 * `[support@samleygo.com.gh](mailto:support@samleygo.com.gh)` — rendered as
 * real anchors with the site's focus styles. No other markup is interpreted.
 */
export type LegalText = string;

export type LegalBlock =
  /** Body paragraph. */
  | { kind: 'p'; text: LegalText }
  /** Bulleted list, or a numbered list when `ordered` is true. */
  | { kind: 'list'; items: LegalText[]; ordered?: boolean }
  /** Sub-heading (h3) with its own body blocks. */
  | { kind: 'sub'; title: string; blocks: LegalBlock[] }
  /** Definition list — used for defined terms such as "delivery fee". */
  | { kind: 'terms'; items: Array<{ term: LegalText; definition: LegalText }> }
  /** A quiet call-out. `important` renders with the accent colour. */
  | { kind: 'note'; tone?: 'info' | 'important'; title?: string; text: LegalText };

/** One numbered chapter of a document. `id` becomes the anchor (`#orders`). */
export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  /** Stable key, e.g. `terms`. */
  key: string;
  /** Route, e.g. `/terms`. */
  path: string;
  /** Page heading, e.g. `Terms of Service — SamleyGo Ghana`. */
  title: string;
  /** `<h1>` display title (may equal `title`). */
  heading: string;
  /** Short label used in the footer and related-document lists. */
  navTitle: string;
  /** Browser tab title, e.g. `Terms of Service | SamleyGo Ghana`. */
  metaTitle: string;
  metaDescription: string;
  /** Standfirst paragraph shown under the document heading. */
  summary: string;
  /** Chapter list; also drives the table of contents. */
  sections: LegalSection[];
}
