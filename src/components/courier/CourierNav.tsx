import React from 'react';
import { NavLink } from 'react-router-dom';
import { Bike, Package, DollarSign, User, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface CourierNavProps {
  isOnline?: boolean;
  gpsActive?: boolean;
}

export const CourierNav: React.FC<CourierNavProps> = ({ isOnline, gpsActive }) => {
  const { role } = useAuth();

  if (role !== 'COURIER' && role !== 'SUPER_ADMIN') {
    return null;
  }

  const navLinks = [
    { to: '/courier/dashboard', label: 'Active Dispatch', icon: Bike, end: true },
    { to: '/courier/deliveries', label: 'Trip History', icon: Package, end: false },
    { to: '/courier/earnings', label: 'Earnings & Payouts', icon: DollarSign, end: false },
    { to: '/profile', label: 'Courier Profile', icon: User, end: false },
  ];

  return (
    <div className="bg-white border-b border-slate-200/80 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 h-12 overflow-x-auto no-scrollbar">
          {/* Navigation Links */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {navLinks.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap active:scale-95 ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>

          {/* Status indicators (desktop & tablet) */}
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            {gpsActive !== undefined && (
              <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    gpsActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                  }`}
                />
                <span>GPS {gpsActive ? 'Active' : 'Standby'}</span>
              </span>
            )}
            {isOnline !== undefined && (
              <span
                className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg ${
                  isOnline
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isOnline ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'
                  }`}
                />
                <span>{isOnline ? 'Online for Trips' : 'Offline'}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
