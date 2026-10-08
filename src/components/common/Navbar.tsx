import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ShoppingBag,
  Bell,
  User,
  LogOut,
  ChefHat,
  Bike,
  ShieldCheck,
  Check,
  ChevronDown,
  Search,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { PWAInstallButton } from './PWAInstallButton';
import { UserAvatar } from './UserAvatar';

export const Navbar: React.FC = () => {
  const { user, profile, role, signOut, unreadCount, notifications, markNotificationAsRead } = useAuth();
  const { totalCount } = useCart();
  const navigate = useNavigate();
  const location = useLocation();

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');

  // The super-admin console is a full-page workspace with its own sidebar nav,
  // so the public site header is suppressed there (AdminDashboard provides its
  // own section switcher, brand block and sign-out control).
  if (location.pathname.startsWith('/admin')) {
    return null;
  }

  // Restaurant owner pages render inside RestaurantShell which provides its
  // own sidebar navigation, so the public header is suppressed there too.
  // NOTE: /restaurant/:id is the public customer detail page and keeps the header.
  if (
    location.pathname.startsWith('/restaurant/dashboard') ||
    location.pathname.startsWith('/restaurant/menu') ||
    location.pathname.startsWith('/restaurant/settings')
  ) {
    return null;
  }

  const handleHeaderSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (headerSearch.trim()) {
      navigate(`/?q=${encodeURIComponent(headerSearch.trim())}`);
      setHeaderSearch('');
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/95 pt-safe backdrop-blur-md transition">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-2 sm:h-16 sm:gap-4 sm:px-6 lg:px-8">
          {/* Brand — the real SamleyGo logo mark plus the brand wordmark */}
          <Link to="/" className="group flex h-11 min-w-0 flex-shrink-0 items-center gap-2" aria-label="SamleyGo home">
            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 shadow-sm transition group-hover:shadow-md sm:h-10 sm:w-10">
              <img src="/logo-mark.png" alt="" className="h-full w-full object-cover" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] font-extrabold leading-none tracking-tight text-brand-deep sm:text-xl">
                Samley<span className="text-accent">Go</span>
              </span>
              <span className="mt-1.5 hidden items-center gap-1.5 text-[9px] font-bold uppercase leading-none tracking-[0.16em] text-slate-500 sm:flex">
                <span className="h-px w-3 bg-slate-300" aria-hidden="true"></span>
                Fast. Reliable. Always There.
              </span>
            </span>
          </Link>

          {/* Desktop Navigation Links & Quick Search */}
          <nav className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-semibold text-slate-600">
            <Link to="/restaurants" className="flex h-11 items-center whitespace-nowrap transition hover:text-emerald-600">
              Explore
            </Link>

            {/* Quick Live Search Bar */}
            <form onSubmit={handleHeaderSearch} className="hidden lg:flex items-center relative w-48 xl:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                placeholder="Search food, dishes or kitchens"
                value={headerSearch}
                onChange={(e) => setHeaderSearch(e.target.value)}
                aria-label="Search food, dishes or kitchens"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-100 pl-8 pr-2.5 py-0 text-xs font-medium transition hover:bg-slate-200/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </form>

            {user && role === 'CUSTOMER' && (
              <Link to="/orders" className="flex h-11 items-center transition hover:text-emerald-600">
                Track Orders
              </Link>
            )}
            {user && role === 'RESTAURANT_OWNER' && (
              <Link to="/restaurant/dashboard" className="text-emerald-700 hover:text-emerald-800 flex items-center gap-1 font-bold">
                <ChefHat className="w-4 h-4" />
                <span>Restaurant Dashboard</span>
              </Link>
            )}
            {user && role === 'COURIER' && (
              <Link to="/courier/dashboard" className="text-emerald-700 hover:text-emerald-800 flex items-center gap-1 font-bold">
                <Bike className="w-4 h-4" />
                <span>Courier Portal</span>
              </Link>
            )}
            {user && role === 'SUPER_ADMIN' && (
              <Link to="/admin/dashboard" className="text-slate-900 bg-slate-100 px-3 py-1.5 rounded-lg hover:bg-slate-200 flex items-center gap-1.5 font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Super Admin</span>
              </Link>
            )}
          </nav>

          {/* Right Header Actions */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            
            {/* PWA Install Button (desktop/tablet header) */}
            <div className="hidden sm:block">
              <PWAInstallButton compact />
            </div>

            {/* Notifications (When Logged In) */}
            {user && (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowNotifications(!showNotifications);
                    setShowUserMenu(false);
                  }}
                  className="relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label={
                    unreadCount > 0
                      ? `Notifications, ${unreadCount} unread`
                      : 'Notifications'
                  }
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold leading-none text-white">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {/* Notifications Dropdown —
                    Mobile (PWA/Play Store): fixed full-width sheet under the header with
                    tap-outside-to-close and a dvh-capped, independently scrolling list.
                    Desktop: anchored popover as before. */}
                {showNotifications && (
                  <>
                    {/* Mobile backdrop: tap anywhere outside to dismiss */}
                    <div
                      className="fixed inset-0 z-40 sm:hidden"
                      onClick={() => setShowNotifications(false)}
                      aria-hidden="true"
                    />
                    <div className="fixed inset-x-2 top-[4.75rem] z-50 flex max-h-[70dvh] flex-col rounded-2xl bg-white shadow-2xl border border-slate-100 p-4 animate-in fade-in zoom-in-95 sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-96 sm:max-h-none">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <h4 className="font-bold text-slate-900 text-sm">Notifications</h4>
                        <span className="text-xs text-slate-500 font-medium">{unreadCount} new</span>
                      </div>

                      <div className="flex-1 min-h-0 mt-2 overflow-y-auto overscroll-contain divide-y divide-slate-50 sm:flex-none sm:max-h-72">
                      {notifications.length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-400">
                          No notifications yet.
                        </div>
                      ) : (
                        notifications.map((item) => (
                          <div
                            key={item.id}
                            className={`py-3 px-2.5 sm:py-2.5 sm:px-2 rounded-xl transition cursor-pointer ${
                              !item.is_read ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                            }`}
                            onClick={() => {
                              markNotificationAsRead(item.id);
                              if (item.link) navigate(item.link);
                              setShowNotifications(false);
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-xs text-slate-900">{item.title}</p>
                              {!item.is_read && (
                                <span className="w-2 h-2 rounded-full bg-emerald-600 flex-shrink-0 mt-1" />
                              )}
                            </div>
                            <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{item.message}</p>
                            <span className="text-[9px] text-slate-400 mt-1 block">
                              {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))
                      )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Cart Button (For Customers / Guests) — a small count chip, never a heavy badge */}
            {role !== 'COURIER' && (
              <Link
                to="/cart"
                className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition ${
                  totalCount > 0
                    ? 'text-brand-dark hover:bg-emerald-50'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
                aria-label={
                  totalCount > 0
                    ? `View cart, ${totalCount} item${totalCount === 1 ? '' : 's'}`
                    : 'View cart'
                }
              >
                <ShoppingBag className="h-5 w-5" />
                {totalCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9.5px] font-bold leading-none text-white">
                    {totalCount}
                  </span>
                )}
              </Link>
            )}

            {/* User Account / Auth Buttons */}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowUserMenu(!showUserMenu);
                    setShowNotifications(false);
                  }}
                  className="flex items-center gap-2 p-1.5 sm:px-3 sm:py-2 rounded-xl hover:bg-slate-100 border border-slate-200/60 transition"
                >
                  {/* The signed-in person's actual photo (uploaded on the profile
                      page) — falls back to their initial, or the generic icon,
                      when they have not added one yet. */}
                  <UserAvatar
                    src={profile?.avatar_url}
                    name={profile?.full_name}
                    sizeClassName="w-8 h-8"
                    shapeClassName="rounded-lg"
                    className="text-xs shadow-xs"
                    fallback={profile?.full_name ? undefined : <User className="w-4 h-4" />}
                  />
                  <span className="hidden lg:block text-xs font-bold text-slate-800 max-w-[100px] truncate">
                    {profile?.full_name || user.email?.split('@')[0]}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
                </button>

                {/* Dropdown Menu */}
                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white shadow-2xl border border-slate-100 p-2 z-50">
                    <div className="px-3 py-2 border-b border-slate-100">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar
                          src={profile?.avatar_url}
                          name={profile?.full_name}
                          sizeClassName="w-9 h-9"
                          shapeClassName="rounded-xl"
                          className="shadow-sm"
                          fallback={profile?.full_name ? undefined : <User className="w-4 h-4" />}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {profile?.full_name || 'My Account'}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                        </div>
                      </div>
                      <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                        {role.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="py-1">
                      {role === 'CUSTOMER' && (
                        <>
                          <Link
                            to="/orders"
                            onClick={() => setShowUserMenu(false)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg block"
                          >
                            My Orders
                          </Link>
                          <Link
                            to="/profile"
                            onClick={() => setShowUserMenu(false)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg block"
                          >
                            Account Settings
                          </Link>
                        </>
                      )}

                      {role === 'RESTAURANT_OWNER' && (
                        <>
                          <Link
                            to="/restaurant/dashboard"
                            onClick={() => setShowUserMenu(false)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg block"
                          >
                            Kitchen Orders
                          </Link>
                          <Link
                            to="/restaurant/menu"
                            onClick={() => setShowUserMenu(false)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg block"
                          >
                            Manage Menu Items
                          </Link>
                          <Link
                            to="/restaurant/settings"
                            onClick={() => setShowUserMenu(false)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg block"
                          >
                            Restaurant Settings
                          </Link>
                        </>
                      )}

                      {role === 'COURIER' && (
                        <>
                          <Link
                            to="/courier/dashboard"
                            onClick={() => setShowUserMenu(false)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg block"
                          >
                            Delivery Board
                          </Link>
                          <Link
                            to="/courier/earnings"
                            onClick={() => setShowUserMenu(false)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg block"
                          >
                            Payouts &amp; Earnings
                          </Link>
                          <Link
                            to="/profile"
                            onClick={() => setShowUserMenu(false)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg block"
                          >
                            Courier Profile
                          </Link>
                        </>
                      )}

                      {role === 'SUPER_ADMIN' && (
                        <Link
                          to="/admin/dashboard"
                          onClick={() => setShowUserMenu(false)}
                          className="w-full text-left px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg block"
                        >
                          Super Admin Console
                        </Link>
                      )}
                    </div>

                    <div className="pt-1 border-t border-slate-100">
                      <button
                        onClick={async () => {
                          setShowUserMenu(false);
                          await signOut();
                          navigate('/');
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1.5 transition"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
                <Link
                  to="/login"
                  className="flex h-11 items-center whitespace-nowrap rounded-xl px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 sm:px-3.5"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="flex h-11 items-center whitespace-nowrap rounded-xl bg-brand px-3 text-xs font-bold text-white shadow-xs transition hover:bg-brand-dark active:scale-95 sm:px-4"
                >
                  <span className="hidden sm:inline">Join SamleyGo</span>
                  <span className="sm:hidden">Join</span>
                </Link>
              </div>
            )}

          </div>
        </div>
      </header>
    </>
  );
};
