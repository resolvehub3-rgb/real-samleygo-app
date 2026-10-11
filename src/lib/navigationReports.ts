/**
 * Road / navigation issue reports raised from the navigation screen.
 *
 * A report is a real, auditable write: it lands in `public.audit_logs`, the
 * platform's existing append-only activity table (RLS already lets every
 * authenticated user insert their own events and lets a super admin read them,
 * so the Admin dashboard's activity feed picks them up without a new table,
 * a new policy or a new migration).
 *
 * Nothing here ever writes a location to the console, and the report carries a
 * single coordinate for the spot the courier is standing on when they tap
 * "Send" — not a trail of fixes. The Supabase client used here is the anon
 * one; the service-role key never leaves the server.
 */

import { supabase } from './supabase';

/** The kinds of report the navigation screen offers (short, closed list). */
export const NAVIGATION_REPORT_CATEGORIES = [
  { id: 'HAZARD', label: 'Road hazard' },
  { id: 'ROAD_CLOSED', label: 'Road closed' },
  { id: 'POLICE', label: 'Police / checkpoint' },
  { id: 'WRONG_WAY', label: 'Wrong way' },
  { id: 'TRAFFIC', label: 'Bad traffic' },
  { id: 'OTHER', label: 'Something else' },
] as const;

export type NavigationReportCategory = (typeof NAVIGATION_REPORT_CATEGORIES)[number]['id'];

export interface NavigationReportInput {
  category: NavigationReportCategory;
  /** Optional free text the courier typed. Trimmed, capped at 240 chars. */
  note?: string;
  /** Where the report was raised. Rounded to 4 dp (~11 m) before it is stored. */
  point?: { lat: number; lng: number } | null;
  /** Order the courier is navigating for, when there is one. */
  orderId?: string | null;
  /** Navigation phase the report belongs to. */
  phase?: string | null;
}

export interface NavigationReportResult {
  ok: boolean;
  /** Human-readable failure copy; `null` on success. */
  error: string | null;
}

/** Two taps closer together than this are the same report. */
const DUPLICATE_WINDOW_MS = 5_000;
const NOTE_MAX_LENGTH = 240;

let lastSubmittedAt = 0;

/** ~11 m of precision — enough to place the report, not a tracking trail. */
const round4 = (value: number): number => Number(value.toFixed(4));

/**
 * Record one report. Resolves (never throws) with `{ ok, error }` so the
 * screen can show a real confirmation or a real failure — a silent no-op would
 * make the control decorative.
 */
export async function submitNavigationReport(
  input: NavigationReportInput
): Promise<NavigationReportResult> {
  const now = Date.now();
  if (now - lastSubmittedAt < DUPLICATE_WINDOW_MS) {
    return { ok: true, error: null };
  }

  const category = NAVIGATION_REPORT_CATEGORIES.some((entry) => entry.id === input.category)
    ? input.category
    : 'OTHER';
  const note = (input.note ?? '').trim().slice(0, NOTE_MAX_LENGTH);

  const metadata: Record<string, unknown> = { category };
  if (note) metadata.note = note;
  if (input.point && Number.isFinite(input.point.lat) && Number.isFinite(input.point.lng)) {
    metadata.lat = round4(input.point.lat);
    metadata.lng = round4(input.point.lng);
  }
  if (input.phase) metadata.phase = input.phase;

  try {
    const { error } = await supabase.from('audit_logs').insert({
      action: 'NAVIGATION_ISSUE_REPORTED',
      target_type: 'navigation',
      target_id: input.orderId ?? null,
      metadata,
    });

    if (error) {
      return {
        ok: false,
        error: 'Could not send the report. Check your connection and try again.',
      };
    }

    lastSubmittedAt = now;
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'Could not send the report. Check your connection and try again.' };
  }
}

/** Test seam: forget the duplicate-tap window (never used by the UI). */
export function resetNavigationReportThrottle(): void {
  lastSubmittedAt = 0;
}
