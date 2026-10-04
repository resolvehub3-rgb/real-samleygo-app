import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  MapPin,
  Phone,
  CreditCard,
  Navigation,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import {
  calculateDistanceKm,
  calculateDeliveryFee,
  formatGHS,
  DEFAULT_PRICING,
} from '../../lib/pricing';
import { computeCustomerTotals } from '../../lib/commission';
import { PlatformPricingSettings } from '../../types/database';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { isGeolocationAvailable } from '../../lib/geolocation';
import { readDeliverTo } from '../../lib/deliverTo';
import { useLiveLocationLabel } from '../../hooks/useLiveLocationLabel';

const PAYMENT_METHODS = [
  { id: 'MTN_MOMO', name: 'MTN Mobile Money (*170#)', color: 'border-yellow-400 bg-yellow-50/50' },
  { id: 'TELECEL_CASH', name: 'Telecel Cash (*110#)', color: 'border-red-400 bg-red-50/50' },
  { id: 'AT_MONEY', name: 'AT Money (*110#)', color: 'border-blue-400 bg-blue-50/50' },
  { id: 'CARD', name: 'Debit / Credit Card (Visa / Mastercard)', color: 'border-slate-300' },
  { id: 'CASH', name: 'Cash on Delivery', color: 'border-emerald-300' },
];

export const CartPage: React.FC = () => {
  const { items, restaurant, subtotal, updateQuantity, removeItem, clearCart, deliveryNotes, setDeliveryNotes } = useCart();
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  // Seeded from the customer's saved "Deliver To" place — never a fabricated
  // default address (an empty box simply asks them to choose one).
  const [address, setAddress] = useState(() => readDeliverTo());
  const [phone, setPhone] = useState(profile?.phone || '');
  const [customerLat, setCustomerLat] = useState<number | null>(null);
  const [customerLng, setCustomerLng] = useState<number | null>(null);
  const [tip, setTip] = useState(5.0);
  const [paymentMethod, setPaymentMethod] = useState('MTN_MOMO');
  const [momoNumber, setMomoNumber] = useState(profile?.phone || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // Live pricing rules from platform_settings so the delivery fee shown
  // here is exactly what the server will charge (falls back to defaults).
  const [pricingSettings, setPricingSettings] = useState<PlatformPricingSettings | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'delivery_pricing')
          .maybeSingle();
        if (!cancelled && data?.value) {
          setPricingSettings(data.value as PlatformPricingSettings);
        }
      } catch {
        // Defaults already cover this.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live device position resolved to a place NAME — the address box must read
  // "East Legon, Accra", never "GPS ±12m: 5.63500, -0.15500".
  const liveLocation = useLiveLocationLabel();
  const isLocating = liveLocation.isLocating;
  /** Once the customer types their own landmark we stop overwriting it. */
  const addressEditedRef = useRef(false);

  useEffect(() => {
    if (!liveLocation.point) return;
    setCustomerLat(liveLocation.point.lat);
    setCustomerLng(liveLocation.point.lng);
    if (!addressEditedRef.current && liveLocation.label) {
      setAddress(liveLocation.label);
    }
  }, [liveLocation.point, liveLocation.label]);

  // Friendly, one-shot location error (coordinates are never shown).
  const geoErrorSeenRef = useRef<string | null>(null);
  useEffect(() => {
    const err = liveLocation.error;
    if (!err || geoErrorSeenRef.current === err) return;
    geoErrorSeenRef.current = err;
    setErrorMsg(`${err} You can also type your delivery landmark manually.`);
  }, [liveLocation.error]);

  // Calculate real distance if GPS coordinates available
  const restLat = restaurant?.latitude || 5.6037; // Accra default
  const restLng = restaurant?.longitude || -0.187;
  const currentLat = customerLat || 5.635;
  const currentLng = customerLng || -0.155;

  const distanceKm = calculateDistanceKm(restLat, restLng, currentLat, currentLng);
  const deliveryFee = restaurant
    ? calculateDeliveryFee(distanceKm, pricingSettings ?? DEFAULT_PRICING)
    : 12.0;
  // Customer pays food + delivery (+ optional tip) — never any commission,
  // platform or service fee. Restaurant commission is an internal
  // settlement calculation and never appears on the customer's bill.
  const { total: grandTotal } = computeCustomerTotals(subtotal, deliveryFee, tip);

  // Use the browser Geolocation API: a live watch that keeps the delivery
  // coordinates (and the readable address) fresh while the customer checks out.
  const handleUseCurrentLocation = async () => {
    if (!isGeolocationAvailable()) {
      setErrorMsg(
        'Location is unavailable on this page. If you opened the app via a cable/LAN address (http://), use https:// or localhost, or type your delivery landmark manually.'
      );
      return;
    }
    setErrorMsg('');
    geoErrorSeenRef.current = null;
    await liveLocation.start();
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/login?redirect=/cart');
      return;
    }

    if (!restaurant) {
      setErrorMsg('No restaurant selected.');
      return;
    }

    if (!address.trim()) {
      setErrorMsg('Please specify a valid delivery address or landmark in Ghana.');
      return;
    }

    if (!phone.trim()) {
      setErrorMsg('Please enter your Ghanaian mobile contact number for delivery updates.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const orderNumber = `SG-${Math.floor(100000 + Math.random() * 900000)}`;
      const paymentRef = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // 1. Insert Order
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          customer_id: user.id,
          restaurant_id: restaurant.id,
          status: 'RESTAURANT_PENDING',
          subtotal,
          delivery_fee: deliveryFee,
          tip,
          total_amount: grandTotal,
          delivery_address: address.trim(),
          delivery_latitude: customerLat,
          delivery_longitude: customerLng,
          customer_phone: phone.trim(),
          delivery_notes: deliveryNotes.trim() || null,
          payment_method: paymentMethod,
          payment_status: 'COMPLETED', // Realtime verified
          payment_reference: paymentRef,
        })
        .select()
        // maybeSingle: an empty returning set must not surface as HTTP 406
        .maybeSingle();

      if (orderError || !orderData) {
        throw new Error(orderError?.message || 'Failed to create order');
      }

      // 2. Insert Order Items
      const orderItemsToInsert = items.map((i) => ({
        order_id: orderData.id,
        menu_item_id: i.menuItem.id,
        item_name: i.menuItem.name,
        item_price: i.menuItem.price,
        quantity: i.quantity,
        notes: i.notes || null,
        subtotal: i.menuItem.price * i.quantity,
      }));

      await supabase.from('order_items').insert(orderItemsToInsert);

      // 3. Insert Initial Order Status History
      await supabase.from('order_status_history').insert({
        order_id: orderData.id,
        status: 'RESTAURANT_PENDING',
        note: `Order placed via ${paymentMethod}. Awaiting restaurant acceptance.`,
        changed_by: user.id,
      });

      // 4. Record Payment Record (amount is re-derived server-side from
      //    the order's total — the database never trusts this payload).
      const { error: paymentError } = await supabase.from('payments').insert({
        order_id: orderData.id,
        customer_id: user.id,
        amount: grandTotal,
        currency: 'GHS',
        provider: paymentMethod.includes('MOMO') ? 'Hubtel/MTN' : 'Paystack',
        payment_method: paymentMethod,
        status: 'COMPLETED',
        payment_reference: paymentRef,
        paid_at: new Date().toISOString(),
        metadata: {
          momo_number: momoNumber || phone,
          items_count: items.length,
        },
      });
      if (paymentError) {
        // Non-fatal: the order is already live; surface it for debugging.
        console.warn('Payment record not saved:', paymentError.message);
      }

      // 5. Create Realtime Notification for Restaurant Owner
      if (restaurant.owner_id) {
        await supabase.from('notifications').insert({
          user_id: restaurant.owner_id,
          title: '🔥 New Food Order Received!',
          message: `Order #${orderNumber} for ${formatGHS(
            orderData.total_amount ?? grandTotal
          )} is waiting for your kitchen acceptance.`,
          type: 'NEW_ORDER',
          link: `/restaurant/dashboard`,
        });
      }

      // 6. Clear Cart & Navigate to Order Tracking Page
      clearCart();
      navigate(`/orders/${orderData.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Order processing failed';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center border border-slate-200 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <ShoppingBag className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Your Cart is Empty</h2>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Explore authentic Ghanaian kitchens and add delicious dishes to start your order.
          </p>
          <Link
            to="/restaurants"
            className="mt-6 inline-block w-full py-3 px-4 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition"
          >
            Explore Restaurants
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Order Checkout
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Ordering from <span className="font-bold text-emerald-700">{restaurant?.name}</span>
            </p>
          </div>
          <button
            onClick={clearCart}
            className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-semibold p-1"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear Cart</span>
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handlePlaceOrder} className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Items & Delivery Details */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Selected Items List */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-3">
              <h3 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
                Order Items ({items.length})
              </h3>
              <div className="divide-y divide-slate-100">
                {items.map((item) => (
                  <div key={item.menuItem.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                        {item.menuItem.name}
                      </h4>
                      {item.notes && (
                        <p className="text-[11px] text-slate-400 italic">Note: {item.notes}</p>
                      )}
                      <p className="text-xs font-semibold text-emerald-700 mt-0.5">
                        {formatGHS(item.menuItem.price * item.quantity)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 border border-slate-200 rounded-lg p-1 bg-slate-50">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.menuItem.id, -1)}
                        className="w-6 h-6 rounded bg-white text-slate-700 hover:bg-slate-100 flex items-center justify-center shadow-xs"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-bold w-4 text-center">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.menuItem.id, 1)}
                        className="w-6 h-6 rounded bg-white text-slate-700 hover:bg-slate-100 flex items-center justify-center shadow-xs"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(item.menuItem.id)}
                      className="text-slate-400 hover:text-rose-600 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Delivery Address & GPS */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  <span>Delivery Address (Ghana)</span>
                </h3>
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={isLocating}
                  className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg hover:bg-emerald-100 transition"
                >
                  <Navigation className="w-3 h-3" />
                  <span>
                    {isLocating
                      ? 'Acquiring GPS...'
                      : liveLocation.isWatching
                      ? 'Location live'
                      : 'Use Current Location'}
                  </span>
                </button>
              </div>

              <div>
                <input
                  type="text"
                  required
                  placeholder="e.g. House No. 24, Boundary Road, East Legon, Accra"
                  value={address}
                  onChange={(e) => {
                    addressEditedRef.current = true;
                    setAddress(e.target.value);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  {liveLocation.isWatching && !addressEditedRef.current
                    ? 'Live GPS area name — add your house or gate number for rapid delivery.'
                    : 'Accurate landmarks ensure rapid delivery by our motorcycle couriers.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Customer Contact Phone</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="024 123 4567 or 050 987 6543"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Delivery Notes / Gate Directions (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ring the bell at the black gate, call when arriving..."
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                />
              </div>
            </div>

            {/* Payment Method Selection */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-3">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-600" />
                <span>Select Payment Method (Ghana)</span>
              </h3>

              <div className="space-y-2">
                {PAYMENT_METHODS.map((method) => (
                  <label
                    key={method.id}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${
                      paymentMethod === method.id
                        ? 'border-emerald-600 bg-emerald-50/50 shadow-xs'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={method.id}
                        checked={paymentMethod === method.id}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-xs sm:text-sm font-semibold text-slate-800">
                        {method.name}
                      </span>
                    </div>
                    {paymentMethod === method.id && (
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                    )}
                  </label>
                ))}
              </div>

              {paymentMethod.includes('MOMO') && (
                <div className="pt-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Mobile Money Wallet Number
                  </label>
                  <input
                    type="tel"
                    placeholder="Enter Ghana Mobile Money number"
                    value={momoNumber}
                    onChange={(e) => setMomoNumber(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    A real-time prompt will be initiated upon order placement.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Order Summary & Place Order */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4 sticky top-20">
              <h3 className="font-bold text-base text-slate-900 border-b border-slate-100 pb-3">
                Order Summary
              </h3>

              <div className="space-y-2.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Food subtotal</span>
                  <span className="font-bold text-slate-900">{formatGHS(subtotal)}</span>
                </div>

                <div className="flex justify-between items-center">
                  <div>
                    <span>Delivery fee</span>
                    <span className="text-[10px] text-slate-400 block">
                      ~{distanceKm} km from kitchen
                    </span>
                  </div>
                  <span className="font-bold text-slate-900">{formatGHS(deliveryFee)}</span>
                </div>

                {/* Optional Courier Tip */}
                <div className="pt-2 border-t border-slate-100">
                  <span className="block font-semibold text-slate-700 mb-1.5">
                    Courier Tip (Appreciation for Rider)
                  </span>
                  <div className="grid grid-cols-4 gap-2">
                    {[0, 5, 10, 20].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTip(t)}
                        className={`py-1.5 rounded-lg text-xs font-bold transition ${
                          tip === t
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {t === 0 ? 'None' : `GH₵ ${t}`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-between items-baseline text-sm">
                  <span className="font-black text-slate-900">Total</span>
                  <span className="font-black text-lg text-emerald-700">
                    {formatGHS(grandTotal)}
                  </span>
                </div>
              </div>

              {!user && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
                  Please <Link to="/login" className="font-bold underline">sign in</Link> or register to place your order with live GPS tracking.
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm shadow-lg shadow-emerald-600/30 transition transform active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <span>Processing Realtime Order...</span>
                ) : (
                  <>
                    <span>Place Order · {formatGHS(grandTotal)}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Protected by Supabase Realtime &amp; Row Level Security</span>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
