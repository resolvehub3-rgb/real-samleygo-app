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
        <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
          
          {/* Brand Logo — real SamleyGo logo mark + wordmark */}
          <Link to="/" className="flex items-center gap-2.5 group flex-shrink-0 min-w-0">
            <span className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl overflow-hidden bg-white ring-1 ring-slate-200 shadow-sm group-hover:shadow-md group-hover:-translate-y-0.5 transition flex">
              <img src="/logo-mark.png" alt="" className="w-full h-full object-cover" />
            </span>
            <span className="flex flex-col min-w-0">
              <span className="text-base sm:text-xl font-extrabold tracking-tight text-[#02472d] leading-none">
                Samley<span className="text-[#fd6902]">Go</span>
              </span>
              <span className="hidden sm:flex items-center gap-1.5 text-[9px] font-bold tracking-[0.16em] text-slate-500 uppercase leading-none mt-1.5">
                <span
                  className="w-3 h-px bg-gradient-to-r from-emerald-600 to-orange-500"
                  aria-hidden="true"
                ></span>
                Fast. Reliable. Always There.
              </span>
            </span>
          </Link>

          {/* Desktop Navigation Links & Quick Search */}
          <nav className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-semibold text-slate-600">
            <Link to="/restaurants" className="hover:text-emerald-600 transition whitespace-nowrap">
              Explore
            </Link>

            {/* Quick Live Search Bar */}
            <form onSubmit={handleHeaderSearch} className="hidden lg:flex items-center relative w-48 xl:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                placeholder="Search food in realtime..."
                value={headerSearch}
                onChange={(e) => setHeaderSearch(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/70 focus:bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
            </form>

            {user && role === 'CUSTOMER' && (
              <Link to="/orders" className="hover:text-emerald-600 transition">
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
                  className="rounded-xl p-3 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 relative sm:p-2"
                  aria-label="Notifications"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
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

            {/* Cart Button (For Customers / Guests) */}
            {role !== 'COURIER' && (
              <Link
                to="/cart"
                className="relative p-2 rounded-xl text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition"
                aria-label="View Cart"
              >
                <ShoppingBag className="w-5 h-5" />
                {totalCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 rounded-full bg-emerald-600 text-white text-[11px] font-extrabold flex items-center justify-center px-1 shadow-sm">
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
              <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                <Link
                  to="/login"
                  className="px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition whitespace-nowrap flex-shrink-0"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition whitespace-nowrap active:scale-95 flex-shrink-0"
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
