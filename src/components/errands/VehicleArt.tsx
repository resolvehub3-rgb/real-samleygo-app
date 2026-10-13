import React from 'react';

import type { ErrandsServiceCategory } from '../../lib/errands/types';

/**
 * Vehicle illustrations for the ride-selection list.
 *
 * Hand-authored inline SVG: transparent backgrounds, one canvas (128×72) and
 * one stroke weight across every option, so the rows line up at the same
 * visual scale. No emoji, no remote image URLs, no third-party artwork — and
 * nothing that touches SamleyGo's own logo or palette (brand green accents
 * only).
 */

interface ArtProps {
  className?: string;
  /** Accessible name; when omitted the SVG is decorative (`aria-hidden`). */
  title?: string;
}

const svgProps = (className: string | undefined, title?: string) => ({
  viewBox: '0 0 128 72',
  className: className ?? 'h-14 w-[84px]',
  fill: 'none' as const,
  xmlns: 'http://www.w3.org/2000/svg',
  role: title ? ('img' as const) : undefined,
  'aria-hidden': title ? undefined : true,
});

/** Shared car silhouette: cabin, body, glass, wheels and lights. */
const CarBody: React.FC<{ roof?: React.ReactNode }> = ({ roof }) => (
  <>
    {roof}
    {/* Cabin — drawn first so the body's beltline covers its base. */}
    <path
      d="M34 37 L46 18.5 Q47.6 15.6 51 15.6 H80 Q83.4 15.6 85 18.5 L97 37 Z"
      fill="#ffffff"
      stroke="#0f172a"
      strokeWidth="3"
      strokeLinejoin="round"
    />
    {/* Body */}
    <rect x="8" y="34" width="112" height="21" rx="10.5" fill="#ffffff" stroke="#0f172a" strokeWidth="3" />
    {/* Glass */}
    <path d="M42.5 33 L50.5 21.5 H61 V33 Z" fill="#1e293b" />
    <path d="M66 21.5 H79 L88.5 33 H66 Z" fill="#1e293b" />
    {/* Brand accent along the sill */}
    <path d="M16 50 H112" stroke="#059669" strokeWidth="4" strokeLinecap="round" />
    {/* Lights */}
    <rect x="110.5" y="38" width="8" height="6" rx="3" fill="#facc15" stroke="#0f172a" strokeWidth="2" />
    <rect x="9.5" y="38" width="8" height="6" rx="3" fill="#f87171" stroke="#0f172a" strokeWidth="2" />
    {/* Door handle */}
    <rect x="60" y="38.5" width="11" height="3.5" rx="1.75" fill="#94a3b8" />
    {/* Wheels */}
    <circle cx="36" cy="55" r="12" fill="#0f172a" />
    <circle cx="36" cy="55" r="5" fill="#cbd5e1" />
    <circle cx="36" cy="55" r="1.8" fill="#64748b" />
    <circle cx="96" cy="55" r="12" fill="#0f172a" />
    <circle cx="96" cy="55" r="5" fill="#cbd5e1" />
    <circle cx="96" cy="55" r="1.8" fill="#64748b" />
  </>
);

/** Passenger car — used for `RIDE_CAR`. */
export const RideCarArt: React.FC<ArtProps> = ({ className, title }) => (
  <svg {...svgProps(className, title)}>
    {title ? <title>{title}</title> : null}
    <ellipse cx="64" cy="68" rx="52" ry="3.4" fill="#0f172a" opacity="0.1" />
    <CarBody />
  </svg>
);

/** Car courier — used for `CAR_ERRAND`: the same car with a roof parcel. */
export const CarDeliveryArt: React.FC<ArtProps> = ({ className, title }) => (
  <svg {...svgProps(className, title)}>
    {title ? <title>{title}</title> : null}
    <ellipse cx="64" cy="68" rx="52" ry="3.4" fill="#0f172a" opacity="0.1" />
    <CarBody
      roof={
        <g>
          <rect x="44" y="2" width="46" height="15" rx="4" fill="#059669" stroke="#0f172a" strokeWidth="3" />
          <path d="M67 2.5 V16.5" stroke="#ffffff" strokeWidth="2.5" opacity="0.9" />
          <rect x="74" y="7" width="11" height="5" rx="2" fill="#ffffff" opacity="0.9" />
        </g>
      }
    />
  </svg>
);

/** Motorcycle rider — used for `ERRAND_MOTORCYCLE`: bike plus parcel box. */
export const SendMotorbikeArt: React.FC<ArtProps> = ({ className, title }) => (
  <svg {...svgProps(className, title)}>
    {title ? <title>{title}</title> : null}
    <ellipse cx="64" cy="68" rx="52" ry="3.4" fill="#0f172a" opacity="0.1" />

    {/* Parcel on the rear rack */}
    <rect x="6" y="7" width="40" height="28" rx="5" fill="#059669" stroke="#0f172a" strokeWidth="3" />
    <path d="M26 8.5 V34 M7.5 21 H44.5" stroke="#ffffff" strokeWidth="2.5" opacity="0.9" />
    <rect x="31" y="26" width="12" height="6" rx="2" fill="#ffffff" opacity="0.95" />
    <path d="M30 35 v4" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />

    {/* Seat, tank and frame */}
    <rect x="34" y="37" width="38" height="9" rx="4.5" fill="#0f172a" />
    <path d="M64 40 C70 33 78 31 84 34" stroke="#059669" strokeWidth="7" strokeLinecap="round" />
    <rect x="57" y="45" width="23" height="11" rx="4" fill="#334155" stroke="#0f172a" strokeWidth="2.5" />
    <path d="M63 57 H85" stroke="#94a3b8" strokeWidth="6" strokeLinecap="round" />

    {/* Front fork, handlebar and headlight */}
    <path d="M84 34 L100 52" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
    <path d="M85 33 L89 22" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
    <path d="M81 21 H97" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
    <path d="M89 29 L99 25.5 V35.5 L89 32.5 Z" fill="#facc15" stroke="#0f172a" strokeWidth="2" strokeLinejoin="round" />

    {/* Wheels */}
    <circle cx="34" cy="52" r="14" fill="#0f172a" />
    <circle cx="34" cy="52" r="6" fill="#cbd5e1" />
    <circle cx="34" cy="52" r="2" fill="#64748b" />
    <circle cx="100" cy="52" r="14" fill="#0f172a" />
    <circle cx="100" cy="52" r="6" fill="#cbd5e1" />
    <circle cx="100" cy="52" r="2" fill="#64748b" />
  </svg>
);

/** One illustration per service category the backend can actually offer. */
export const RIDE_VEHICLE_ART: Record<
  ErrandsServiceCategory,
  React.FC<ArtProps>
> = {
  ERRAND_MOTORCYCLE: SendMotorbikeArt,
  CAR_ERRAND: CarDeliveryArt,
  RIDE_CAR: RideCarArt,
};

export default RIDE_VEHICLE_ART;
