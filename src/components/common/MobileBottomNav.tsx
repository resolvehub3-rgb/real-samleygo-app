import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, Compass, ShoppingBag, Receipt, User, Bike, DollarSign } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';

export const MobileBottomNav: React.FC = () => {
  const { user, role } = useAuth();
  const { totalCount } = useCart();
  const location = useLocation();

  // The super-admin console is a self-contained workspace with its own sidebar
  // and mobile top bar, so the customer bottom bar is suppressed there —
  // otherwise the console renders with default-user navigation over it.
  if (location.pathname.startsWith('/admin')) {
    return null;
  }

  // Restaurant owner pages use the RestaurantShell sidebar/drawer for
  // navigation, so the customer bottom bar is suppressed there.
  // NOTE: /restaurant/:id is the public customer detail page and keeps the bottom bar.
  if (
    location.pathname.startsWith('/restaurant/dashboard') ||
    location.pathname.startsWith('/restaurant/menu') ||
    location.pathname.startsWith('/restaurant/settings')
  ) {
    return null;
  }

  // If user is a courier, render the courier-specific mobile navigation
  if (user && role === 'COURIER') {
    return (
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/80 bg-white/95 pb-safe backdrop-blur-lg"
        aria-label="Courier navigation"
      >
        <div className="flex h-16 items-center justify-around px-2">
          <NavLink
            to="/courier/dashboard"
            end
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
                isActive
                  ? 'font-bold text-[#02472d]'
                  : 'text-slate-500 hover:text-slate-800'
              }`
            }
          >
            <Bike className="mb-0.5 h-5 w-5" aria-hidden="true" />
            <span className="text-[10px] tracking-tight">Active</span>
          </NavLink>

          <NavLink
            to="/courier/deliveries"
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
                isActive
                  ? 'font-bold text-[#02472d]'
                  : 'text-slate-500 hover:text-slate-800'
              }`
            }
          >
            <Receipt className="mb-0.5 h-5 w-5" aria-hidden="true" />
            <span className="text-[10px] tracking-tight">Deliveries</span>
          </NavLink>

          <NavLink
            to="/courier/earnings"
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
                isActive
                  ? 'font-bold text-[#02472d]'
                  : 'text-slate-500 hover:text-slate-800'
              }`
            }
          >
            <DollarSign className="mb-0.5 h-5 w-5" aria-hidden="true" />
            <span className="text-[10px] tracking-tight">Earnings</span>
          </NavLink>

          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
                isActive
                  ? 'font-bold text-[#02472d]'
                  : 'text-slate-500 hover:text-slate-800'
              }`
            }
          >
            <User className="mb-0.5 h-5 w-5" aria-hidden="true" />
            <span className="text-[10px] tracking-tight">Profile</span>
          </NavLink>
        </div>
      </nav>
    );
  }

  // If Restaurant Owner, we provide quick kitchen navigation or normal customer view
  if (user && role === 'RESTAURANT_OWNER') {
    return (
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200/80 pb-safe">
        <div className="flex items-center justify-around h-16 px-2">
          <NavLink
            to="/restaurant/dashboard"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
                isActive ? 'text-emerald-600 font-bold' : 'text-slate-500 hover:text-slate-800'
              }`
            }
          >
            <Receipt className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Kitchen Orders</span>
          </NavLink>

          <NavLink
            to="/restaurant/menu"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
                isActive ? 'text-emerald-600 font-bold' : 'text-slate-500 hover:text-slate-800'
              }`
            }
          >
            <Compass className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Menu Items</span>
          </NavLink>

          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
                isActive ? 'text-emerald-600 font-bold' : 'text-slate-500 hover:text-slate-800'
              }`
            }
          >
            <User className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Settings</span>
          </NavLink>
        </div>
      </nav>
    );
  }

  // Default customer & guest mobile bottom nav: Home, Search, Orders, Cart, Account
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/80 bg-white/95 pb-safe backdrop-blur-lg md:hidden"
      aria-label="Primary"
    >
      <div className="flex h-16 items-stretch justify-around px-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
              isActive ? 'font-semibold text-brand-dark' : 'font-medium text-slate-500'
            }`
          }
        >
          <Home className="h-5 w-5" aria-hidden="true" />
          <span className="truncate">Home</span>
        </NavLink>

        <NavLink
          to="/restaurants"
          className={({ isActive }) =>
            `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
              isActive ? 'font-semibold text-brand-dark' : 'font-medium text-slate-500'
            }`
          }
        >
          <Compass className="h-5 w-5" aria-hidden="true" />
          <span className="truncate">Search</span>
        </NavLink>

        <NavLink
          to="/orders"
          className={({ isActive }) =>
            `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
              isActive ? 'font-semibold text-brand-dark' : 'font-medium text-slate-500'
            }`
          }
        >
          <Receipt className="h-5 w-5" aria-hidden="true" />
          <span className="truncate">Orders</span>
        </NavLink>

        <NavLink
          to="/cart"
          className={({ isActive }) =>
            `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
              isActive ? 'font-semibold text-brand-dark' : 'font-medium text-slate-500'
            }`
          }
          aria-label={
            totalCount > 0
              ? `Cart, ${totalCount} item${totalCount === 1 ? '' : 's'}`
              : 'Cart'
          }
        >
          <span className="relative">
            <ShoppingBag className="h-5 w-5" aria-hidden="true" />
            {totalCount > 0 && (
              <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold leading-none text-white">
                {totalCount}
              </span>
            )}
          </span>
          <span className="truncate">Cart</span>
        </NavLink>

        <NavLink
          to={user ? '/profile' : '/login'}
          className={({ isActive }) =>
            `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
              isActive ? 'font-semibold text-brand-dark' : 'font-medium text-slate-500'
            }`
          }
        >
          <User className="h-5 w-5" aria-hidden="true" />
          <span className="truncate">{user ? 'Account' : 'Sign In'}</span>
        </NavLink>
      </div>
    </nav>
  );
};
