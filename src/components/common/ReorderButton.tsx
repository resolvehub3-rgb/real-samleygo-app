import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { Order } from '../../types/database';
import { placeReorder } from '../../lib/reorder';

type Phase = 'idle' | 'confirm' | 'placing';

interface ReorderButtonProps {
  /** The finished order being repeated. */
  order: Order;
  /** Extra classes for the resting trigger (matches the host card/footer). */
  className?: string;
}

/**
 * One-tap reorder for a finished order.
 *
 * First tap asks "place this again?", second tap rebuilds the order from
 * today's menu and drops the customer straight onto the new order's page,
 * where the live status stream starts. Failures (kitchen closed, nothing
 * available, RLS rejection) show as a toast instead of a silent no-op, and the
 * in-flight guard makes a double tap impossible to turn into two orders.
 *
 * Renders inside `<Link>` cards, so every control stops event propagation.
 */
export const ReorderButton: React.FC<ReorderButtonProps> = ({ order, className = '' }) => {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const errorTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  const stop = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const flashError = (message: string) => {
    setErrorMsg(message);
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setErrorMsg(null);
    }, 8000);
  };

  const handleTrigger = (event: React.MouseEvent) => {
    stop(event);
    if (phase !== 'idle') return;
    setErrorMsg(null);
    setPhase('confirm');
  };

  const handleCancel = (event: React.MouseEvent) => {
    stop(event);
    if (phase === 'placing') return;
    setPhase('idle');
  };

  const handleConfirm = async (event: React.MouseEvent) => {
    stop(event);
    if (phase === 'placing') return;
    setPhase('placing');

    const outcome = await placeReorder(order);

    if (!mountedRef.current) return;
    if (!outcome.ok) {
      setPhase('confirm');
      flashError(outcome.error);
      return;
    }

    navigate(`/orders/${outcome.order.id}`, {
      state: {
        reorder: {
          from: order.order_number,
          skipped: outcome.skipped,
        },
      },
    });
  };

  const baseButton =
    'inline-flex items-center gap-1 rounded-lg font-bold active:scale-95 shadow-xs transition disabled:opacity-60 disabled:active:scale-100 ' +
    className;

  return (
    <>
      {phase === 'idle' ? (
        <button
          type="button"
          onClick={handleTrigger}
          className={`${baseButton} bg-amber-500 hover:bg-amber-600 text-white`}
          title={`Order ${order.order_number} again`}
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reorder</span>
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-[11px] font-black text-slate-500">Place again?</span>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={phase === 'placing'}
            className={`${baseButton} bg-emerald-600 hover:bg-emerald-700 text-white`}
          >
            {phase === 'placing' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            <span>{phase === 'placing' ? 'Placing…' : 'Yes'}</span>
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={phase === 'placing'}
            className="inline-flex items-center rounded-lg bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 p-1.5 shadow-xs transition disabled:opacity-60"
            title="Cancel"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-8 z-[1200] max-w-[92vw] sm:max-w-md flex items-start gap-2 bg-rose-600 text-white text-xs font-bold px-4 py-3 rounded-2xl shadow-xl"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={(event) => {
              stop(event);
              setErrorMsg(null);
            }}
            className="ml-1 text-white/70 hover:text-white"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};
