import React, { useEffect, useState } from 'react';
import { Sparkles, UtensilsCrossed, ShieldCheck } from 'lucide-react';

interface SplashScreenProps {
  onComplete?: () => void;
  minDisplayTimeMs?: number;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onComplete,
  minDisplayTimeMs = 1400,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);
  const [progress, setProgress] = useState(15);

  useEffect(() => {
    // Check if splash was already shown this session to prevent annoying repeated delays,
    // but still animate smoothly
    const hasSeenSplash = sessionStorage.getItem('samleygo_splash_seen');
    const delay = hasSeenSplash ? 600 : minDisplayTimeMs;

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return prev + 25;
      });
    }, delay / 4);

    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, delay);

    const hideTimer = setTimeout(() => {
      setIsVisible(false);
      sessionStorage.setItem('samleygo_splash_seen', 'true');
      if (onComplete) onComplete();
    }, delay + 350);

    return () => {
      clearInterval(progressInterval);
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [minDisplayTimeMs, onComplete]);

  if (!isVisible) return null;

  return (
    <div
      onClick={() => {
        setIsFading(true);
        setTimeout(() => {
          setIsVisible(false);
          if (onComplete) onComplete();
        }, 200);
      }}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-between p-8 bg-gradient-to-b from-emerald-950 via-slate-950 to-emerald-950 text-white select-none transition-opacity duration-300 ${
        isFading ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top, 2rem))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))',
      }}
    >
      {/* Top Status Pill */}
      <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-bold tracking-wide backdrop-blur-md animate-pulse">
        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
        <span>Ghana Realtime Network · Accra · Kumasi</span>
      </div>

      {/* Center Hero Logo & Branding */}
      <div className="flex flex-col items-center text-center space-y-5 my-auto">
        <div className="relative group">
          {/* Outer glowing pulsing rings */}
          <div className="absolute -inset-4 rounded-[2rem] bg-emerald-500/25 blur-xl animate-pulse"></div>
          {/* The real SamleyGo logo, presented on a clean white card */}
          <div className="relative rounded-2xl bg-white p-3 shadow-2xl shadow-black/40 ring-1 ring-white/20 overflow-hidden">
            <img
              src="/logo-lockup.png"
              alt="SamleyGo"
              draggable={false}
              className="w-40 sm:w-48 h-auto"
            />
          </div>
        </div>

        <h1 className="sr-only">SamleyGo — Fast. Reliable. Always There.</h1>
        <p className="text-xs font-medium text-emerald-200/80 max-w-xs">
          Authentic Ghanaian food delivered in minutes. Realtime tracking from kitchen to your door.
        </p>

        {/* Progress indicator */}
        <div className="w-48 h-1.5 bg-emerald-950/80 rounded-full overflow-hidden border border-emerald-800/40 mt-4">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-emerald-400 transition-all duration-300 rounded-full"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {/* Bottom Sub-info */}
      <div className="flex flex-col items-center space-y-2 text-center">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Real Supabase Data · Live GPS Logistics</span>
        </div>
        <span className="text-[10px] text-slate-500">Tap anywhere to enter</span>
      </div>
    </div>
  );
};
