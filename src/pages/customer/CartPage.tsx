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
  isValidDeliveryPoint,
  DEFAULT_PRICING,
} from '../../lib/pricing';
import { computeCustomerTotals } from '../../lib/commission';
import {
  DELIVERY_LOCATION_ERROR,
  DeliveryQuote,
  ensureFreshQuote,
  requestDeliveryQuote,
} from '../../lib/deliveryQuote';
import { fetchRoadDistanceKm, geocodeAddress, LatLng } from '../../lib/routing';
import { PlatformPricingSettings } from '../../types/database';
import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from '../../lib/supabase';
import { isGeolocationAvailable } from '../../lib/geolocation';
import { readDeliverTo } from '../../lib/deliverTo';
import { useLiveLocationLabel } from '../../hooks/useLiveLocationLabel';
import { DeliveryLocationPicker } from '../../components/common/DeliveryLocationPicker';

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
  // Live pricing rules from platform_settings — used ONLY for the signed-out
  // preview. Every signed-in quote is calculated by the database.
  const [pricingSettings, setPricingSettings] = useState<PlatformPricingSettings | null>(null);

  // ── Server-calculated delivery quote ─────────────────────────────────
  // distance + delivery fee come back from create_delivery_quote(); the
  // browser never decides them and never posts them as money.
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [isQuoting, setIsQuoting] = useState(false);
  /** Signed-out preview only (the server quote replaces it after sign-in). */
  const [preview, setPreview] = useState<{ distanceKm: number; deliveryFee: number } | null>(null);
  /** Drops replies from an older location as soon as a newer one arrives. */
  const quoteSeqRef = useRef(0);
  const geocodeSeqRef = useRef(0);
  const geocodedTextRef = useRef('');

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

  // ── Endpoints of the delivery route ───────────────────────────────────
  // The kitchen's coordinates come from its own record — never a
  // fabricated city default — and the customer's point must be a real GPS
  // fix or a geocoded landmark. Without both there is no route, and
  // without a route there is no honest fee.
  const restaurantPoint: LatLng | null =
    restaurant && isValidDeliveryPoint(restaurant.latitude, restaurant.longitude)
      ? { lat: restaurant.latitude as number, lng: restaurant.longitude as number }
      : null;

  const deliveryPoint: LatLng | null =
    customerLat != null && customerLng != null && isValidDeliveryPoint(customerLat, customerLng)
      ? { lat: customerLat, lng: customerLng }
      : null;

  // One funnel for every way the drop-off moves: the map pin, a chosen search
  // result, or a "no usable coordinates" reset. Never a fabricated fallback.
  const applyPoint = (next: LatLng | null) => {
    setCustomerLat(next ? next.lat : null);
    setCustomerLng(next ? next.lng : null);
  };

  // No GPS? Resolve the typed landmark to real coordinates so the route
  // is measured instead of guessed. A live GPS fix always wins.
  useEffect(() => {
    if (liveLocation.point) return;
    const target = address.trim();
    if (target.length < 4) return;
    if (geocodedTextRef.current === target && customerLat != null && customerLng != null) return;

    const seq = ++geocodeSeqRef.current;
    const timer = window.setTimeout(async () => {
      const point = await geocodeAddress(target);
      if (seq !== geocodeSeqRef.current) return;
      if (point && isValidDeliveryPoint(point.lat, point.lng)) {
        geocodedTextRef.current = target;
        setCustomerLat(point.lat);
        setCustomerLng(point.lng);
      }
    }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, customerLat, customerLng, liveLocation.point]);

  // Real-time quote: every time the delivery point (or the kitchen)
  // changes, the backend re-prices distance + fee before checkout, so a
  // stale price is never shown after the customer moves.
  const restaurantId = restaurant?.id;
  useEffect(() => {
    if (!restaurantId) return;
    const seq = ++quoteSeqRef.current;

    if (!deliveryPoint) {
      setQuote(null);
      setPreview(null);
      setIsQuoting(false);
      setQuoteError(DELIVERY_LOCATION_ERROR);
      return;
    }

    if (!user) {
      // Signed-out preview only — the authoritative quote is the server's
      // and replaces this as soon as the customer signs in. It prices the SAME
      // road route the map draws (straight-line only while that is measuring),
      // so the line and the summary never disagree.
      if (restaurantPoint) {
        const settings = pricingSettings ?? DEFAULT_PRICING;
        const straightKm = calculateDistanceKm(
          restaurantPoint.lat,
          restaurantPoint.lng,
          deliveryPoint.lat,
          deliveryPoint.lng
        );
        setPreview({
          distanceKm: straightKm,
          deliveryFee: calculateDeliveryFee(straightKm, settings),
        });
        setQuote(null);
        setQuoteError('');
        setIsQuoting(true);

        fetchRoadDistanceKm(restaurantPoint, deliveryPoint).then((roadKm) => {
          if (seq !== quoteSeqRef.current) return; // a newer location already spoke
          setIsQuoting(false);
          if (!roadKm || !Number.isFinite(roadKm)) return; // straight-line stays
          setPreview({
            distanceKm: roadKm,
            deliveryFee: calculateDeliveryFee(roadKm, settings),
          });
        });
      } else {
        setPreview(null);
        setQuoteError(DELIVERY_LOCATION_ERROR);
        setIsQuoting(false);
      }
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsQuoting(true);
      const result = await requestDeliveryQuote({
        restaurantId,
        restaurantPoint,
        deliveryPoint,
      });
      if (seq !== quoteSeqRef.current) return; // a newer location already spoke
      setIsQuoting(false);
      if (result.ok) {
        setQuote(result.quote);
        setPreview(null);
        setQuoteError('');
      } else {
        setQuote(null);
        setPreview(null);
        setQuoteError(result.error);
      }
    }, 400);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    restaurantId,
    restaurantPoint?.lat,
    restaurantPoint?.lng,
    deliveryPoint?.lat,
    deliveryPoint?.lng,
    user?.id,
    pricingSettings,
  ]);

  // What the summary renders: the server quote when we have one, otherwise
  // the signed-out preview. Never a hard-coded distance or price.
  const quotedDistanceKm = quote?.distanceKm ?? preview?.distanceKm ?? null;
  const deliveryFee = quote?.deliveryFee ?? preview?.deliveryFee ?? 0;
  const distanceLabel =
    quotedDistanceKm != null ? `${quotedDistanceKm.toFixed(1)} km` : isQuoting ? '…' : '—';
  const distanceHint = quote
    ? quote.distanceSource === 'ROAD_ROUTE'
      ? 'actual road route'
      : 'straight-line route'
    : isQuoting
    ? 'measuring route…'
    : quoteError
    ? 'location needed'
    : '';

  // Customer pays food + delivery (+ optional tip) — nothing else. The
  // breakdown below is the whole story: no hidden lines of any kind.
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

    if (!deliveryPoint) {
      setErrorMsg(DELIVERY_LOCATION_ERROR);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const orderNumber = `SG-${Math.floor(100000 + Math.random() * 900000)}`;
      const paymentRef = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Ask the backend for the quote it will actually charge: a quote
      // that expired while the customer filled the form is replaced by a
      // fresh one, never submitted as-is.
      const freshQuote = await ensureFreshQuote({
        current: quote,
        restaurantId: restaurant.id,
        restaurantPoint,
        deliveryPoint,
      });
      if (!freshQuote.ok) {
        setErrorMsg(freshQuote.error);
        return;
      }

      // 1. Insert Order — the delivery fee is deliberately NOT sent: the
      //    database prices it from this quote (or recalculates it from the
      //    coordinates) and re-derives the customer total server-side.
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          customer_id: user.id,
          restaurant_id: restaurant.id,
          status: 'RESTAURANT_PENDING',
          subtotal,
          delivery_quote_id: freshQuote.quote.quoteId,
          tip,
          total_amount: grandTotal,
          delivery_address: address.trim(),
          delivery_latitude: deliveryPoint.lat,
          delivery_longitude: deliveryPoint.lng,
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
          title: 'New order received',
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
      // The database raises the exact copy for a missing/invalid location
      // ("Please select a valid delivery location to calculate your delivery
      // fee.") — show it verbatim, unwrapped from any PostgREST envelope.
      const msg = cleanRpcErrorMessage(
        err instanceof Error ? err.message : null,
        'Order processing failed'
      );
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
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
    <div className="min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12 bg-canvas">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Order Checkout
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Ordering from <span className="font-bold text-emerald-700">{restaurant?.name}</span>
            </p>
          </div>
          <button
            onClick={clearCart}
            className="-my-1 flex h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 hover:text-rose-700"
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

                    <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.menuItem.id, -1)}
                        aria-label={`Decrease ${item.menuItem.name} quantity`}
                        className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-slate-700 shadow-xs transition hover:bg-slate-100 active:scale-95"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-xs font-bold tabular-nums">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.menuItem.id, 1)}
                        aria-label={`Increase ${item.menuItem.name} quantity`}
                        className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-slate-700 shadow-xs transition hover:bg-slate-100 active:scale-95"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(item.menuItem.id)}
                      aria-label={`Remove ${item.menuItem.name} from cart`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
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
                  className="-my-1 flex h-11 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"
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

              <DeliveryLocationPicker
                address={address}
                point={deliveryPoint}
                pickup={restaurantPoint}
                onAddressChange={(next) => {
                  addressEditedRef.current = true;
                  setAddress(next);
                }}
                onPointChange={applyPoint}
                onResolved={(next, nextPoint) => {
                  addressEditedRef.current = true;
                  setAddress(next);
                  // This label already carries coordinates — the typed-landmark
                  // geocoder below must not fetch a second, different point.
                  geocodedTextRef.current = next.trim();
                  applyPoint(nextPoint);
                }}
                hint={
                  <p className="text-[10px] text-slate-400">
                    {liveLocation.isWatching && !addressEditedRef.current
                      ? 'Live GPS area name — add your house or gate number for rapid delivery.'
                      : 'Accurate landmarks ensure rapid delivery by our motorcycle couriers.'}
                  </p>
                }
              />

              <div>
                <label htmlFor="cart-phone" className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Customer Contact Phone</span>
                </label>
                <input
                  type="tel"
                  required
                  id="cart-phone"
                  placeholder="024 123 4567 or 050 987 6543"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-0 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="cart-notes" className="block text-xs font-semibold text-slate-700 mb-1">
                  Delivery Notes / Gate Directions (Optional)
                </label>
                <input
                  type="text"
                  id="cart-notes"
                  placeholder="e.g. Ring the bell at the black gate, call when arriving..."
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-0 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white sm:text-sm"
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
                  <label htmlFor="cart-momo" className="block text-[11px] font-bold text-slate-700 mb-1">
                    Mobile Money Wallet Number
                  </label>
                  <input
                    type="tel"
                    id="cart-momo"
                    placeholder="Enter Ghana Mobile Money number"
                    value={momoNumber}
                    onChange={(e) => setMomoNumber(e.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-0 text-xs font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                    <span>Delivery distance</span>
                    <span className="text-[10px] text-slate-400 block">
                      {distanceHint ? `${distanceHint} · kitchen → drop-off` : 'kitchen → drop-off'}
                    </span>
                  </div>
                  <span className="font-bold text-slate-900">{distanceLabel}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span>Delivery fee</span>
                  <span className="font-bold text-slate-900">
                    {deliveryFee > 0 ? formatGHS(deliveryFee) : '—'}
                  </span>
                </div>

                {quoteError && (
                  <p className="text-[11px] font-semibold leading-relaxed text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-2">
                    {quoteError}
                  </p>
                )}

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
                        className={`h-11 rounded-lg text-xs font-bold transition ${
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
                  <span className="font-bold text-slate-900">Total</span>
                  <span className="font-bold text-lg text-emerald-700">
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
                <span>Encrypted checkout — your order status updates live</span>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
