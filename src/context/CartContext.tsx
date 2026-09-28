import React, { createContext, useContext, useState, useEffect } from 'react';
import { MenuItem, Restaurant } from '../types/database';

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
}

interface CartContextType {
  items: CartItem[];
  restaurant: Restaurant | null;
  subtotal: number;
  totalCount: number;
  addItem: (item: MenuItem, restaurant: Restaurant, notes?: string) => boolean;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, delta: number) => void;
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
      return saved ? JSON.parse(saved).items || [] : [];
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

  const addItem = (item: MenuItem, rest: Restaurant, notes?: string): boolean => {
    // If cart has items from another restaurant, confirm switch
    if (restaurant && restaurant.id !== rest.id && items.length > 0) {
      const confirmed = window.confirm(
        `Your cart already contains delicious items from "${restaurant.name}". Would you like to clear your cart and start a new order from "${rest.name}"?`
      );
      if (!confirmed) return false;
      setItems([{ menuItem: item, quantity: 1, notes }]);
      setRestaurant(rest);
      return true;
    }

    setRestaurant(rest);
    setItems((prev) => {
      const index = prev.findIndex((i) => i.menuItem.id === item.id);
      if (index > -1) {
        const next = [...prev];
        next[index] = {
          ...next[index],
          quantity: next[index].quantity + 1,
          notes: notes || next[index].notes,
        };
        return next;
      }
      return [...prev, { menuItem: item, quantity: 1, notes }];
    });
    return true;
  };

  const removeItem = (itemId: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.menuItem.id !== itemId);
      if (next.length === 0) {
        setRestaurant(null);
      }
      return next;
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setItems((prev) => {
      const next = prev
        .map((i) => {
          if (i.menuItem.id === itemId) {
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

  const clearCart = () => {
    setItems([]);
    setRestaurant(null);
    setDeliveryNotes('');
    localStorage.removeItem(STORAGE_KEY);
  };

  const subtotal = items.reduce(
    (sum, item) => sum + item.menuItem.price * item.quantity,
    0
  );

  const totalCount = items.reduce((sum, item) => sum + item.quantity, 0);

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
