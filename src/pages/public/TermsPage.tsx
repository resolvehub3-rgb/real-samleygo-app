import React from 'react';

export const TermsPage: React.FC = () => {
  return (
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6 bg-white my-8 rounded-3xl p-8 border border-slate-200">
        <h1 className="text-2xl font-black text-slate-900">Terms of Service — SamleyGo Ghana</h1>
        <p className="text-xs text-slate-500">Effective Date: September 2026</p>

        <section className="space-y-2 text-xs text-slate-700 leading-relaxed">
          <h2 className="text-sm font-bold text-slate-900">1. Overview</h2>
          <p>
            SamleyGo operates a digital food marketplace connecting Ghanaian customers with certified local food restaurants and independent delivery couriers.
          </p>
        </section>

        <section className="space-y-2 text-xs text-slate-700 leading-relaxed">
          <h2 className="text-sm font-bold text-slate-900">2. Realtime Orders &amp; Delivery</h2>
          <p>
            Orders are confirmed once transmitted to kitchen partners. Delivery distance fees are calculated based on actual GPS distance between the restaurant and customer coordinates.
          </p>
        </section>

        <section className="space-y-2 text-xs text-slate-700 leading-relaxed">
          <h2 className="text-sm font-bold text-slate-900">3. Mobile Money Payments</h2>
          <p>
            All financial transactions in Ghana Cedis (GH₵) via MTN Mobile Money, Telecel Cash, and bank cards are processed through verified gateways.
          </p>
        </section>
      </div>
    </div>
  );
};

export const PrivacyPage: React.FC = () => {
  return (
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6 bg-white my-8 rounded-3xl p-8 border border-slate-200">
        <h1 className="text-2xl font-black text-slate-900">Privacy Policy — SamleyGo Ghana</h1>
        <p className="text-xs text-slate-500">Effective Date: September 2026</p>

        <section className="space-y-2 text-xs text-slate-700 leading-relaxed">
          <h2 className="text-sm font-bold text-slate-900">1. Location Data Collection</h2>
          <p>
            We collect real GPS coordinates through your browser Geolocation API solely for calculating delivery distances, providing delivery directions, and live courier tracking during an active order.
          </p>
        </section>

        <section className="space-y-2 text-xs text-slate-700 leading-relaxed">
          <h2 className="text-sm font-bold text-slate-900">2. Security &amp; Row Level Security (RLS)</h2>
          <p>
            Customer, courier, and restaurant data are protected via Supabase PostgreSQL Row Level Security (RLS) policies ensuring users access only their authorized orders and profiles.
          </p>
        </section>
      </div>
    </div>
  );
};
