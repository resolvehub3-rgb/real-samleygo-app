import React, { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  ChefHat,
  Power,
  LayoutDashboard,
  Utensils,
  Settings,
  Menu as MenuIcon,
  X,
  LogOut,
  MapPin,
  Star,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Restaurant } from '../../types/database';

interface RestaurantShellProps {
  restaurant: Restaurant | null;
  isUpdatingOpenStatus?: boolean;
  onToggleOpen?: () => void;
  children: React.ReactNode;
}

/**
 * Shared layout for all restaurant-owner pages (dashboard, menu, settings).
 * - Desktop: fixed left sidebar with live Open/Closed toggle.
 * - Mobile: sticky top bar + slide-in drawer, safe-area aware.
 * Suppresses the public Navbar / MobileBottomNav via route checks in those
 * components — the shell provides its own navigation instead.
 */
export const RestaurantShell: React.FC<RestaurantShellProps> = ({
  restaurant,
  isUpdatingOpenStatus,
  onToggleOpen,
  children,
}) => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const isOpen = restaurant?.is_open ?? false;

  const navItems = [
    { to: '/restaurant/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/restaurant/menu', label: 'Menu Manager', icon: Utensils },
    { to: '/restaurant/settings', label: 'Settings', icon: Settings },
  ];

  const handleSignOut = async () => {
    setDrawerOpen(false);
    await signOut();
    navigate('/');
  };

  const closeDrawer = () => setDrawerOpen(false);

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <Link to="/" className="flex items-center gap-2.5 px-5 pt-5 pb-4 shrink-0">
        <span className="w-9 h-9 rounded-xl overflow-hidden bg-white ring-1 ring-slate-200 shadow-sm flex">
          <img src="/logo-mark.png" alt="" className="w-full h-full object-cover" />
        </span>
        <span className="text-base font-extrabold tracking-tight text-[#02472d]">
          Samley<span className="text-[#fd6902]">Go</span>
        </span>
      </Link>

      {/* Restaurant identity card */}
      <div className="mx-3 rounded-2xl bg-gradient-to-br from-[#02472d] via-emerald-800 to-emerald-900 p-4 text-white shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center overflow-hidden flex-shrink-0">
            {restaurant?.logo_url && !imageFailed ? (
              <img
                src={restaurant.logo_url}
                alt=""
                className="w-full h-full object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <ChefHat className="w-5 h-5 text-emerald-300" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black truncate">{restaurant?.name || 'My Kitchen'}</p>
            <p className="text-[10px] text-emerald-200/80 truncate">
              {restaurant?.cuisine_type || 'Partner'}
            </p>
          </div>
        </div>

        {/* Live Open/Closed toggle */}
        {onToggleOpen && (
          <button
            onClick={onToggleOpen}
            disabled={isUpdatingOpenStatus}
            className={`mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition active:scale-[0.98] disabled:opacity-60 ${
              isOpen
                ? 'bg-white/15 ring-1 ring-white/25 text-emerald-200 hover:bg-white/25'
                : 'bg-[#fd6902] text-white hover:bg-orange-600'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            {isUpdatingOpenStatus ? 'Updating…' : isOpen ? 'Kitchen Open — tap to close' : 'Kitchen Closed — tap to open'}
          </button>
        )}
      </div>

      {/* Nav links */}
      <nav className="mt-4 px-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/restaurant/dashboard'}
            onClick={closeDrawer}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            <Icon className="w-4.5 h-4.5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto px-3 pb-4 space-y-1">
        {/* Address / rating summary */}
        {restaurant && (
          <div className="px-3.5 py-2.5 mb-2 rounded-xl bg-slate-50 border border-slate-100 text-[10px] text-slate-500 space-y-1">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3 h-3 text-emerald-600 flex-shrink-0" />
              <span className="truncate">{restaurant.address}, {restaurant.city}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Star className="w-3 h-3 text-amber-500 flex-shrink-0" />
              <span>
                {Number(restaurant.rating || 0).toFixed(1)} ★ · {restaurant.total_reviews} reviews
              </span>
            </div>
          </div>
        )}

        {/* Signed-in user + sign out */}
        <div className="px-3.5 py-2 text-[10px] text-slate-400 truncate">
          {profile?.full_name || user?.email}
        </div>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 transition"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 flex-col z-40">
        {sidebarContent}
      </aside>

      {/* ── Mobile top bar ──────────────────────────────── */}
      <div className="lg:hidden sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="flex items-center justify-between h-14 px-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition"
            aria-label="Open menu"
          >
            <MenuIcon className="w-5.5 h-5.5" />
          </button>
          <span className="text-sm font-extrabold text-[#02472d]">
            Samley<span className="text-[#fd6902]">Go</span>
            <span className="ml-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider hidden xs:inline sm:inline">
              Kitchen
            </span>
          </span>
          <span
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
              isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            {isOpen ? 'Open' : 'Closed'}
          </span>
        </div>
      </div>

      {/* ── Mobile drawer ───────────────────────────────── */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs lg:hidden"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white shadow-2xl lg:hidden animate-in fade-in slide-in-from-left-4 duration-200 flex flex-col">
            <button
              onClick={closeDrawer}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </>
      )}

      {/* ── Page content ────────────────────────────────── */}
      <main className="lg:pl-64">{children}</main>
    </div>
  );
};
