import React, { useEffect, useState } from 'react';
import { DollarSign, Award, Calendar, CheckCircle2, Star, Bike } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Order, Review } from '../../types/database';
import { formatGHS } from '../../lib/pricing';
import { getOrderFinancials, round2 } from '../../lib/commission';

export const CourierEarningsPage: React.FC = () => {
  const { user } = useAuth();
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadCourierData() {
      if (!user || !isSupabaseConfigured) {
        setIsLoading(false);
        return;
      }

      try {
        // Query completed orders
        const { data: ordersData } = await supabase
          .from('orders')
          .select('*, restaurant:restaurants(*)')
          .eq('courier_id', user.id)
          .in('status', ['DELIVERED', 'COMPLETED'])
          .order('updated_at', { ascending: false });

        if (ordersData) setCompletedOrders(ordersData as Order[]);

        // Query reviews
        const { data: revData } = await supabase
          .from('reviews')
          .select('*')
          .eq('courier_id', user.id);

        if (revData) setReviews(revData as Review[]);
      } catch {
        // Handled
      } finally {
        setIsLoading(false);
      }
    }

    loadCourierData();
  }, [user]);

  // Real calculations — courier_earning is computed by the database and is
  // always 100% of the delivery fee in Phase 1 (0% courier commission).
  // The tip is separate and always belongs to the courier.
  const totalEarnings = round2(
    completedOrders.reduce((sum, order) => {
      const f = getOrderFinancials(order);
      return sum + f.courierEarning + f.tip;
    }, 0)
  );

  const totalTips = round2(
    completedOrders.reduce((sum, order) => sum + (order.tip || 0), 0)
  );

  const avgRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (r.courier_rating || 0), 0) / reviews.length
      : 5.0;

  return (
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Courier Earnings &amp; History
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Calculated from real completed SamleyGo deliveries in Ghana
          </p>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
            <span className="text-xs font-bold text-slate-400 block mb-1">Total Payout</span>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-black text-emerald-700">
                {formatGHS(totalEarnings)}
              </span>
              <DollarSign className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-[10px] text-slate-400 mt-2 block">
              Full delivery fee (0% courier commission) + customer tips
            </span>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
            <span className="text-xs font-bold text-slate-400 block mb-1">Completed Trips</span>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-black text-slate-900">
                {completedOrders.length}
              </span>
              <Bike className="w-5 h-5 text-slate-600" />
            </div>
            <span className="text-[10px] text-slate-400 mt-2 block">
              Tips collected: {formatGHS(totalTips)}
            </span>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
            <span className="text-xs font-bold text-slate-400 block mb-1">Courier Rating</span>
            <div className="flex items-baseline justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-black text-slate-900">
                  {avgRating.toFixed(1)}
                </span>
                <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
              </div>
              <Award className="w-5 h-5 text-amber-500" />
            </div>
            <span className="text-[10px] text-slate-400 mt-2 block">
              From {reviews.length} customer ratings
            </span>
          </div>
        </div>

        {/* History List */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            Delivery Trip History
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : completedOrders.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No completed deliveries yet. Go online on your dashboard to accept your first order!
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {completedOrders.map((order) => {
                const f = getOrderFinancials(order);
                return (
                  <div key={order.id} className="py-3.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">#{order.order_number}</span>
                        <span className="text-slate-500 font-semibold">{order.restaurant?.name}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{order.delivery_address}</p>
                      <span className="text-[10px] text-slate-400">
                        {new Date(order.updated_at).toLocaleString([], {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="font-black text-sm text-emerald-700 block">
                        {formatGHS(f.courierEarning)}
                      </span>
                      {f.tip > 0 && (
                        <span className="text-[10px] text-amber-600 font-bold block">
                          +{formatGHS(f.tip)} Tip
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 block">
                        {formatGHS(round2(f.courierEarning + f.tip))} total
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
