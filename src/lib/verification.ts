import { CourierVerificationStatus } from '../types/database';

/**
 * Ghana Card PIN shape: GHA-123456789-2 (GHA + 9 digits + 1 check character).
 * Users may type it with or without dashes and in lower case.
 */
export const normalizeGhanaCardNumber = (value: string): string => {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^GHA\d{9}[0-9A-Z]$/.test(compact)) {
    return `GHA-${compact.slice(3, 12)}-${compact.slice(12)}`;
  }
  return value.trim().toUpperCase();
};

export const isValidGhanaCardNumber = (value: string): boolean =>
  /^GHA-?[0-9]{9}-?[0-9A-Z]$/i.test(value.trim());

/** Ghana plates look like `GR-1234-24`, `GT 5678-21` or motorbike `M-123-24`. */
export const isValidVehiclePlate = (value: string): boolean => {
  const compact = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9 -]{3,14}$/.test(compact) && /\d/.test(compact) && /[A-Z]/.test(compact);
};

export const normalizeVehiclePlate = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, ' ');

export const isValidLicenseNumber = (value: string): boolean => /^[A-Z0-9-]{4,24}$/i.test(value.trim());

export const normalizeLicenseNumber = (value: string): string => value.trim().toUpperCase();

/** Keeps the first and last block visible: GHA-•••••••89-2 */
export const maskGhanaCardNumber = (value?: string): string => {
  if (!value) return '—';
  const parts = value.split('-');
  if (parts.length < 3) {
    return value.length > 6 ? `${value.slice(0, 3)}•••${value.slice(-2)}` : value;
  }
  const [prefix, middle, suffix] = parts;
  const visible = middle.slice(-2);
  return `${prefix}-${'•'.repeat(Math.max(3, middle.length - 2))}${visible}-${suffix}`;
};

export const maskLicenseNumber = (value?: string): string => {
  if (!value) return '—';
  if (value.length <= 5) return value;
  return `${value.slice(0, 3)}${'•'.repeat(Math.max(3, value.length - 6))}${value.slice(-3)}`;
};

interface VerificationMeta {
  label: string;
  hint: string;
  chipClass: string;
}

export const VERIFICATION_META: Record<CourierVerificationStatus, VerificationMeta> = {
  UNSUBMITTED: {
    label: 'Not Submitted',
    hint: 'Complete the identity verification section to start delivering.',
    chipClass: 'bg-slate-100 text-slate-700',
  },
  PENDING: {
    label: 'In Review',
    hint: 'Your Ghana Card and licence details were received. The SamleyGo team is reviewing them now.',
    chipClass: 'bg-amber-100 text-amber-800',
  },
  APPROVED: {
    label: 'Verified',
    hint: 'Identity verified. You are cleared to go online and accept deliveries.',
    chipClass: 'bg-emerald-100 text-emerald-800',
  },
  REJECTED: {
    label: 'Rejected',
    hint: 'Your documents were rejected. Please contact support to resubmit clear photos.',
    chipClass: 'bg-rose-100 text-rose-800',
  },
};
