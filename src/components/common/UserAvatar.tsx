import React, { useState } from 'react';

/**
 * Shared avatar renderer used everywhere a person's photo is shown —
 * most importantly the assigned courier on the customer's order screen and
 * on the restaurant's dispatch board.
 *
 * Falls back to a monogram (or a custom icon) when there is no photo yet, and
 * also when a remote photo 404s/blocks, so a broken image never shows as a
 * torn page icon in front of a customer.
 */
export interface UserAvatarProps {
  src?: string | null;
  /** Used for the monogram fallback and the img alt text */
  name?: string | null;
  /** Wrapper size, e.g. "w-10 h-10" (default) */
  sizeClassName?: string;
  /** Wrapper shape, e.g. "rounded-full" (default) or "rounded-2xl" */
  shapeClassName?: string;
  /** Extra classes for the wrapper (rings, shadows, gradients …) */
  className?: string;
  /** Rendered inside the wrapper when there is no usable photo */
  fallback?: React.ReactNode;
}

const monogram = (name?: string | null): string => {
  const trimmed = (name || '').trim();
  if (!trimmed) return '👤';
  return trimmed.charAt(0).toUpperCase();
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  src,
  name,
  sizeClassName = 'w-10 h-10',
  shapeClassName = 'rounded-full',
  className = '',
  fallback,
}) => {
  // Track the FAILED url (not a boolean) so a newly uploaded photo is retried
  // even if the previous one was broken.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = Boolean(src) && failedSrc !== src;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-500 to-teal-700 text-white font-black ${sizeClassName} ${shapeClassName} ${className}`}
    >
      {showPhoto ? (
        <img
          src={src as string}
          alt={name ? `${name}` : 'Profile photo'}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src || null)}
        />
      ) : (
        <span className="leading-none">{fallback ?? monogram(name)}</span>
      )}
    </span>
  );
};
