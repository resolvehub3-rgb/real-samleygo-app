import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  User,
  Mail,
  Phone,
  LogOut,
  ShieldCheck,
  Bike,
  ChefHat,
  Check,
  Smartphone,
  FileText,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PWAInstallButton } from '../../components/common/PWAInstallButton';
import { SubmittedDocsModal } from '../../components/courier/SubmittedDocsModal';
import { UserAvatar } from '../../components/common/UserAvatar';
import { ProfilePhotoUploader } from '../../components/common/ProfilePhotoUploader';

export const ProfilePage: React.FC = () => {
  const { user, profile, role, signOut, updateProfile } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showDocsModal, setShowDocsModal] = useState(false);
  // Committed locally right after an upload so the new photo shows instantly,
  // before refreshProfile() round-trips back with the updated row.
  const [photoOverride, setPhotoOverride] = useState<string | null>(null);
  const photoUrl = photoOverride ?? profile?.avatar_url ?? null;

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center border border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">Sign in required</h2>
          <Link
            to="/login?redirect=/profile"
            className="mt-4 inline-block px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);
    await updateProfile({
      full_name: fullName.trim(),
      phone: phone.trim(),
    });
    setIsUpdating(false);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <div className="min-h-screen pb-28 md:pb-12 bg-slate-50">
      <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* Profile Card */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
          <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
            <UserAvatar
              src={photoUrl}
              name={profile?.full_name}
              sizeClassName="w-16 h-16"
              shapeClassName="rounded-2xl"
              className="shadow-md"
            />
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                {role.replace(/_/g, ' ')}
              </span>
              <h1 className="text-xl font-black text-slate-900 mt-1">
                {profile?.full_name || 'User Profile'}
              </h1>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
          </div>

          {/* Profile picture (courier rider photo is shown live to customers
              and restaurants on every active delivery) */}
          <div className="pb-6 border-b border-slate-100">
            <span className="block text-xs font-bold text-slate-700 mb-3">
              Profile Picture
            </span>
            <ProfilePhotoUploader
              userId={user.id}
              name={profile?.full_name || fullName}
              photoUrl={photoUrl}
              onUploaded={async (url) => {
                setPhotoOverride(url);
                // The uploader shows its own confirmation copy; just persist
                // the new URL so every screen picks it up in realtime.
                await updateProfile({ avatar_url: url });
              }}
              hint={
                role === 'COURIER'
                  ? 'Customers and restaurants see this photo while you are on a delivery.'
                  : 'JPG, PNG or WebP · shown next to your name across the app.'
              }
            />
          </div>

          {savedSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2 font-semibold">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>Profile details updated in Supabase!</span>
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Ghana Contact Phone</label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <input
                  type="tel"
                  placeholder="024 123 4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isUpdating}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition disabled:opacity-50"
            >
              {isUpdating ? 'Saving...' : 'Update Profile'}
            </button>
          </form>
        </div>

        {/* Role Portal Shortcuts */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-3">
          <h3 className="font-bold text-sm text-slate-900">Dedicated Portals</h3>

          {role === 'CUSTOMER' && (
            <Link
              to="/orders"
              className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 transition text-xs font-semibold text-slate-800"
            >
              <span>My Active Food Orders &amp; Delivery Tracking</span>
              <span className="text-emerald-700 font-bold">&rarr;</span>
            </Link>
          )}

          {role === 'COURIER' && (
            <>
              <Link
                to="/courier/dashboard"
                className="flex items-center justify-between p-3.5 rounded-2xl bg-emerald-50 hover:bg-emerald-100 transition text-xs font-bold text-emerald-900"
              >
                <div className="flex items-center gap-2">
                  <Bike className="w-4 h-4 text-emerald-600" />
                  <span>Courier Active Dispatch &amp; GPS Telemetry</span>
                </div>
                <span>&rarr;</span>
              </Link>

              {/* View submitted verification documents */}
              <button
                onClick={() => setShowDocsModal(true)}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 transition text-xs font-bold text-slate-800"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-500" />
                  <span>View Submitted Docs</span>
                </div>
                <span className="text-emerald-700 font-bold">View &rarr;</span>
              </button>
            </>
          )}

          {role === 'RESTAURANT_OWNER' && (
            <Link
              to="/restaurant/dashboard"
              className="flex items-center justify-between p-3.5 rounded-2xl bg-emerald-50 hover:bg-emerald-100 transition text-xs font-bold text-emerald-900"
            >
              <div className="flex items-center gap-2">
                <ChefHat className="w-4 h-4 text-emerald-600" />
                <span>Kitchen Order Queues &amp; Menu Manager</span>
              </div>
              <span>&rarr;</span>
            </Link>
          )}

          {role === 'SUPER_ADMIN' && (
            <Link
              to="/admin/dashboard"
              className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900 text-white hover:bg-slate-800 transition text-xs font-bold"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Super Admin Web Console</span>
              </div>
              <span>&rarr;</span>
            </Link>
          )}
        </div>

        {/* PWA & System Configuration */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-3">
          <h3 className="font-bold text-sm text-slate-900">App &amp; Connection</h3>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-slate-600">Install SamleyGo App</span>
            <PWAInstallButton />
          </div>
        </div>

        {/* Submitted verification documents modal (couriers) */}
        {role === 'COURIER' && (
          <SubmittedDocsModal
            isOpen={showDocsModal}
            onClose={() => setShowDocsModal(false)}
            courierId={user.id}
          />
        )}

        {/* Sign Out Button */}
        <button
          onClick={async () => {
            await signOut();
            navigate('/');
          }}
          className="w-full py-3 px-4 rounded-2xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs flex items-center justify-center gap-2 transition"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out of SamleyGo</span>
        </button>
      </div>
    </div>
  );
};
