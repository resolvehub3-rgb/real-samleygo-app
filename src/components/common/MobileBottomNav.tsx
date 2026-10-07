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

  // Default customer & guest mobile bottom nav: Home, Search, Orders, Cart, Profile
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200/80 pb-safe">
      <div className="flex items-center justify-around h-16 px-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
              isActive ? 'text-emerald-600 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`
          }
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">Home</span>
        </NavLink>

        <NavLink
          to="/restaurants"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
              isActive ? 'text-emerald-600 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`
          }
        >
          <Compass className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">Search</span>
        </NavLink>

        <NavLink
          to="/orders"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
              isActive ? 'text-emerald-600 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`
          }
        >
          <Receipt className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">Orders</span>
        </NavLink>

        <NavLink
          to="/cart"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 py-1 relative transition-colors ${
              isActive ? 'text-emerald-600 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`
          }
        >
          <div className="relative">
            <ShoppingBag className="w-5 h-5 mb-0.5" />
            {totalCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-emerald-600 text-white text-[9px] font-black rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center">
                {totalCount}
              </span>
            )}
          </div>
          <span className="text-[10px] tracking-tight">Cart</span>
        </NavLink>

        <NavLink
          to={user ? '/profile' : '/login'}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
              isActive ? 'text-emerald-600 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`
          }
        >
          <User className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">{user ? 'Account' : 'Sign In'}</span>
        </NavLink>
      </div>
    </nav>
  );
};
