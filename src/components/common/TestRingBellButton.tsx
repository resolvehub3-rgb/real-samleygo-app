import React from 'react';
import { Bell } from 'lucide-react';
import {
  playCourierAssignedAlert,
  playCustomerStatusAlert,
  playRestaurantOrderAlert,
} from '../../lib/soundAlerts';

/** Which side of the platform the button sits on — decides which sound rings. */
export type RingBellTone = 'restaurant' | 'courier' | 'customer';

const TONES: Record<RingBellTone, { play: () => void; hint: string }> = {
  /** Incoming-order brass bell the kitchen hears. */
  restaurant: { play: () => playRestaurantOrderAlert(), hint: 'kitchen order bell' },
  /** Bolt/Yango-style assignment chime the rider hears. */
  courier: { play: () => playCourierAssignedAlert(), hint: 'courier assignment chime' },
  /** Customer milestone sound — trip started, so it rings three times. */
  customer: {
    play: () => {
      playCustomerStatusAlert('PICKED_UP');
    },
    hint: 'customer milestone chime (rings three times)',
  },
};

export interface TestRingBellButtonProps {
  tone: RingBellTone;
  /**
   * Full look of the button. Colour and sizing are left to the caller so the
   * button can sit on a dark kitchen header, a white card or a page toolbar
   * without the shared component having to know about any of them.
   */
  className?: string;
  /** Bell colour — defaults to the button's own text colour. */
  iconClassName?: string;
}

/**
 * The one "Test Ring Bell" control, shared by the courier, restaurant and
 * customer screens so the label, the icon and the tooltip read identically
 * everywhere while each side rings the alert its users actually receive.
 */
export const TestRingBellButton: React.FC<TestRingBellButtonProps> = ({
  tone,
  className = '',
  iconClassName = 'text-current',
}) => {
  const { play, hint } = TONES[tone];

  return (
    <button
      type="button"
      onClick={play}
      className={`inline-flex items-center gap-1.5 active:scale-95 transition ${className}`}
      title={`Test Ring Bell — plays the ${hint} you hear on this screen`}
      aria-label={`Test Ring Bell (${tone})`}
    >
      <Bell className={`w-3.5 h-3.5 ${iconClassName}`} />
      <span>Test Ring Bell</span>
    </button>
  );
};
