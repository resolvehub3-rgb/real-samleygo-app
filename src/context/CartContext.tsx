import React, { createContext, useContext, useState, useEffect } from 'react';
import { MenuItem, Restaurant } from '../types/database';
import {
  CartExtra,
  CartItem,
  cartFoodSubtotal,
  cartItemCount,
  cartLineKey,
  normalizeCartItem,
} from '../lib/addons';

export type { CartExtra, CartItem };

interface CartContextType {
  items: CartItem[];
  restaurant: Restaurant | null;
  /** Food subtotal: every line's meal total plus that line's extras total. */
  subtotal: number;
  totalCount: number;
  addItem: (
    item: MenuItem,
    restaurant: Restaurant,
    notes?: string,
    extras?: CartExtra[]
  ) => boolean;
  /**
   * Identity is the LINE, not the dish: the same meal with a different set of
   * extras is a different line and can be edited (or removed) on its own.
   */
  removeItem: (lineKey: string) => void;
  updateQuantity: (lineKey: string, delta: number) => void;
  /** Replaces a line's quantity / extras / notes — used when editing from the cart. */
  updateLine: (
    lineKey: string,
    patch: { quantity?: number; notes?: string; extras?: CartExtra[] }
  ) => void;
  clearCart: () => void;
  deliveryNotes: string;
  setDeliveryNotes: (notes: string) => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const STORAGE_KEY = 'samleygo_cart_v1';

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const raw = saved ? JSON.parse(saved).items || [] : [];
      if (!Array.isArray(raw)) return [];
      // Carts written before add-ons existed simply have no `extras`.
      return raw.map(normalizeCartItem).filter((item): item is CartItem => item !== null);
    } catch {
      return [];
    }
  });

  const [restaurant, setRestaurant] = useState<Restaurant | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved).restaurant || null : null;
    } catch {
      return null;
    }
  });

  const [deliveryNotes, setDeliveryNotes] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, restaurant }));
    } catch {
      // Storage quota or private browsing
    }
  }, [items, restaurant]);

  const addItem = (
    item: MenuItem,
    rest: Restaurant,
    notes?: string,
    extras?: CartExtra[]
  ): boolean => {
    const incoming: CartItem = {
      menuItem: item,
      quantity: 1,
      notes,
      extras: extras && extras.length ? extras : undefined,
    };
    const incomingKey = cartLineKey(incoming);

    // If cart has items from another restaurant, confirm switch
    if (restaurant && restaurant.id !== rest.id && items.length > 0) {
      const confirmed = window.confirm(
        `Your cart already contains delicious items from "${restaurant.name}". Would you like to clear your cart and start a new order from "${rest.name}"?`
      );
      if (!confirmed) return false;
      setItems([incoming]);
      setRestaurant(rest);
      return true;
    }

    setRestaurant(rest);
    setItems((prev) => {
      // Identical meal + identical extras = the same line (quantity grows).
      // Anything else is a new line, so two combos stay separately editable.
      const index = prev.findIndex((i) => cartLineKey(i) === incomingKey);
      if (index > -1) {
        const next = [...prev];
        next[index] = {
          ...next[index],
          quantity: next[index].quantity + 1,
          notes: notes || next[index].notes,
        };
        return next;
      }
      return [...prev, incoming];
    });
    return true;
  };

  const removeItem = (lineKey: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => cartLineKey(i) !== lineKey);
      if (next.length === 0) {
        setRestaurant(null);
      }
      return next;
    });
  };

  const updateQuantity = (lineKey: string, delta: number) => {
    setItems((prev) => {
      const next = prev
        .map((i) => {
          if (cartLineKey(i) === lineKey) {
            const newQty = i.quantity + delta;
            return newQty > 0 ? { ...i, quantity: newQty } : null;
          }
          return i;
        })
        .filter(Boolean) as CartItem[];

      if (next.length === 0) {
        setRestaurant(null);
      }
      return next;
    });
  };

  const updateLine = (
    lineKey: string,
    patch: { quantity?: number; notes?: string; extras?: CartExtra[] }
  ) => {
    setItems((prev) => {
      const index = prev.findIndex((i) => cartLineKey(i) === lineKey);
      if (index < 0) return prev;

      const updated: CartItem = { ...prev[index], ...patch };
      if (!updated.extras || updated.extras.length === 0) updated.extras = undefined;
      if (updated.quantity < 1) updated.quantity = 1;

      const next = [...prev];
      next[index] = updated;

      // The edit may have produced a combination another line already holds
      // (e.g. "Fried rice + chicken" twice) — keep them as one line.
      const newKey = cartLineKey(updated);
      if (newKey !== lineKey) {
        const other = next.findIndex((i, idx) => idx !== index && cartLineKey(i) === newKey);
        if (other > -1) {
          const survivor = next[other];
          const merged: CartItem = { ...survivor, quantity: survivor.quantity + updated.quantity };
          return next.filter((_, idx) => idx !== index && idx !== other).concat([merged]);
        }
      }

      return next;
    });
  };

  const clearCart = () => {
    setItems([]);
    setRestaurant(null);
    setDeliveryNotes('');
    localStorage.removeItem(STORAGE_KEY);
  };

  // The server recalculates this from the stored lines; this copy exists so the
  // summary and the Place Order button agree with what will be confirmed.
  const subtotal = cartFoodSubtotal(items);

  const totalCount = cartItemCount(items);

  return (
    <CartContext.Provider
      value={{
        items,
        restaurant,
        subtotal,
        totalCount,
        addItem,
        removeItem,
        updateQuantity,
        updateLine,
        clearCart,
        deliveryNotes,
        setDeliveryNotes,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
