import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Mail,
  Lock,
  User,
  Bike,
  ChefHat,
  ShoppingBag,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  CreditCard,
  ClipboardCheck,
  Camera,
  ImagePlus,
  Hash,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types/database';
import { isSupabaseConfigured } from '../../lib/supabase';
import { SupabaseConnectModal } from '../../components/common/SupabaseConnectModal';
import { prepareDocumentImage, PreparedDocument } from '../../lib/documents';
import { homePathForRole } from '../../lib/roleRoutes';
import {
  isValidGhanaCardNumber,
  isValidLicenseNumber,
  isValidVehiclePlate,
  normalizeGhanaCardNumber,
  normalizeLicenseNumber,
  normalizeVehiclePlate,
} from '../../lib/verification';
import {
  AuthShell,
  AuthTabs,
  FieldLabel,
  INPUT_CLASS,
  INPUT_ACTION_CLASS,
} from '../../components/auth/AuthShell';

const LABEL_CLASS = 'block text-xs font-bold text-slate-700 mb-1.5';

interface RoleOption {
  role: UserRole;
  label: string;
  icon: LucideIcon;
  /** Ring/border/background applied when this role is the active selection. */
  selected: string;
  /** Icon tile colours applied when selected. */
  iconOn: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: 'CUSTOMER',
    label: 'Customer',
    icon: ShoppingBag,
    selected: 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/30',
    iconOn: 'bg-emerald-600 text-white',
  },
  {
    role: 'COURIER',
    label: 'Courier',
    icon: Bike,
    selected: 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-500/30',
    iconOn: 'bg-amber-500 text-white',
  },
  {
    role: 'RESTAURANT_OWNER',
    label: 'Kitchen',
    icon: ChefHat,
    selected: 'border-purple-500 bg-purple-50 text-purple-900 ring-2 ring-purple-500/30',
    iconOn: 'bg-purple-600 text-white',
  },
];

const REGISTER_FEATURES = [
  {
    icon: ShoppingBag,
    title: 'For hungry customers',
    detail: 'Order from your favourite kitchens and follow every delivery live.',
  },
  {
    icon: Bike,
    title: 'For couriers',
    detail: 'Set your own hours and earn with verified, supported deliveries.',
  },
  {
    icon: ChefHat,
    title: 'For kitchens',
    detail: 'List your menu, reach new customers and grow your food business.',
  },
];

interface PhotoTileProps {
  label: string;
  hint: string;
  preview: string;
  file: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
}

const PhotoTile: React.FC<PhotoTileProps> = ({ label, hint, preview, file, onPick, onClear }) => (
  <div>
    <span className={LABEL_CLASS}>{label}</span>
    <div
      className={`relative overflow-hidden rounded-2xl border-2 border-dashed transition ${
        file
          ? 'border-emerald-400 bg-emerald-50'
          : 'border-slate-300 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/60'
      }`}
    >
      {preview ? (
        <div className="relative">
          <img src={preview} alt={label} className="h-36 w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-slate-950/95 to-transparent px-2.5 pb-2 pt-8">
            <span className="flex items-center gap-1 text-[10px] font-extrabold text-emerald-300">
              <CheckCircle className="h-3.5 w-3.5" />
              Attached
            </span>
            <div className="flex gap-1.5">
              <label className="cursor-pointer rounded-lg bg-white/95 px-2 py-1 text-[10px] font-bold text-slate-800 transition active:scale-95">
                Replace
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) onPick(picked);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                onClick={onClear}
                className="rounded-lg bg-rose-500 px-2 py-1 text-[10px] font-bold text-white transition active:scale-95"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 px-3 py-6 text-center transition active:scale-[0.99]">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-amber-500 shadow-sm ring-1 ring-slate-200">
            <Camera className="h-5 w-5" />
          </span>
          <span className="text-xs font-bold text-slate-700">{label}</span>
          <span className="text-[10px] leading-tight text-slate-500">{hint}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) onPick(picked);
              e.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  </div>
);

export const RegisterPage: React.FC = () => {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [role, setRole] = useState<UserRole>('CUSTOMER');
  const [step, setStep] = useState<1 | 2>(1);

  // Section 1 · Account credentials
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Section 2 · Courier identity & vehicle verification
  const [vehicleType, setVehicleType] = useState('Motorcycle');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [ghanaCardNumber, setGhanaCardNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [ghanaCardFront, setGhanaCardFront] = useState<File | null>(null);
  const [ghanaCardBack, setGhanaCardBack] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState('');
  const [backPreview, setBackPreview] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showDbModal, setShowDbModal] = useState(false);

  const isCourier = role === 'COURIER';
  const totalSteps = isCourier ? 2 : 1;

  // Release object URLs when previews are replaced or the page unmounts
  useEffect(
    () => () => {
      if (frontPreview) URL.revokeObjectURL(frontPreview);
    },
    [frontPreview]
  );
  useEffect(
    () => () => {
      if (backPreview) URL.revokeObjectURL(backPreview);
    },
    [backPreview]
  );

  const selectRole = (nextRole: UserRole) => {
    setRole(nextRole);
    setStep(1);
    setErrorMsg('');
  };

  const pickPhoto = (side: 'front' | 'back', file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please choose an image file for the Ghana Card photo.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('That photo is larger than 10 MB. Please use a smaller image.');
      return;
    }
    setErrorMsg('');
    const previewUrl = URL.createObjectURL(file);
    if (side === 'front') {
      setGhanaCardFront(file);
      setFrontPreview(previewUrl);
    } else {
      setGhanaCardBack(file);
      setBackPreview(previewUrl);
    }
  };

  const clearPhoto = (side: 'front' | 'back') => {
    if (side === 'front') {
      setGhanaCardFront(null);
      setFrontPreview('');
    } else {
      setGhanaCardBack(null);
      setBackPreview('');
    }
  };

  const validateSectionOne = (): string | null => {
    if (!fullName.trim()) return 'Please enter your full name.';
    if (!email.trim() || !email.includes('@')) return 'Please enter a valid email address.';
    if (!phone.trim()) return 'Please enter your Ghana phone number.';
    if (password.length < 6) return 'Password must be at least 6 characters long.';
    return null;
  };

  const validateSectionTwo = (): string | null => {
    if (!ghanaCardNumber.trim()) return 'Ghana Card ID number is required.';
    if (!isValidGhanaCardNumber(ghanaCardNumber))
      return 'Enter a valid Ghana Card PIN, e.g. GHA-123456789-2.';
    if (!vehiclePlate.trim()) return 'Vehicle number plate is required.';
    if (!isValidVehiclePlate(vehiclePlate)) return 'Enter a valid number plate, e.g. GR-1234-24.';
    if (!licenseNumber.trim()) return 'Driving licence ID number is required.';
    if (!isValidLicenseNumber(licenseNumber)) return 'Enter a valid driving licence ID number.';
    if (!ghanaCardFront) return 'Please upload the front photo of your Ghana Card.';
    if (!ghanaCardBack) return 'Please upload the back photo of your Ghana Card.';
    return null;
  };

  // Section 1 -> Section 2 (courier only)
  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setShowDbModal(true);
      return;
    }
    const validationError = validateSectionOne();
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    setErrorMsg('');
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    setErrorMsg('');
    setStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Final submit (single step for customers / kitchens, section 2 for couriers)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setShowDbModal(true);
      return;
    }

    const accountError = validateSectionOne();
    if (accountError) {
      setStep(1);
      setErrorMsg(accountError);
      return;
    }

    let courierDetails:
      | {
          vehicleType: string;
          vehiclePlate: string;
          ghanaCardNumber: string;
          licenseNumber: string;
          ghanaCardFront: PreparedDocument;
          ghanaCardBack: PreparedDocument;
        }
      | undefined;

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      if (isCourier) {
        const verificationError = validateSectionTwo();
        if (verificationError) {
          setIsSubmitting(false);
          setErrorMsg(verificationError);
          return;
        }

        const [front, back] = await Promise.all([
          prepareDocumentImage(ghanaCardFront as File),
          prepareDocumentImage(ghanaCardBack as File),
        ]);

        courierDetails = {
          vehicleType,
          vehiclePlate: normalizeVehiclePlate(vehiclePlate),
          ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber),
          licenseNumber: normalizeLicenseNumber(licenseNumber),
          ghanaCardFront: front,
          ghanaCardBack: back,
        };
      }

      const { error, warning } = await signUp({
        email,
        password,
        fullName,
        phone,
        role,
        courier: courierDetails,
      });

      setIsSubmitting(false);

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      if (warning) {
        try {
          sessionStorage.setItem('samleygo_signup_warning', warning);
        } catch {
          // Storage unavailable — the warning is non-critical
        }
      }

      navigate(homePathForRole(role));
    } catch (err) {
      setIsSubmitting(false);
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  };

  const submitLabel = isCourier
    ? step === 1
      ? 'Continue to Verification'
      : 'Submit for Verification'
    : 'Complete Registration';

  return (
    <AuthShell
      eyebrow="Join SamleyGo"
      headline={
        <>
          Create your
          <br />
          account in
          <br />
          minutes<span className="text-orange-400">.</span>
        </>
      }
      description="Order food, earn on the road, or grow your kitchen — one free account powers it all."
      features={REGISTER_FEATURES}
      mobileBrand="Sign up"
      cardTitle="Create your account"
      cardSubtitle="Order delicious food, deliver packages, or partner your kitchen"
    >
      <AuthTabs active="register" />

      {errorMsg && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-semibold text-rose-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Account type selector */}
      <div className="mb-5">
        <span className="mb-2 block text-xs font-bold text-slate-700">
          I'm joining SamleyGo as a…
        </span>
        <div className="grid grid-cols-3 gap-2">
          {ROLE_OPTIONS.map((option) => {
            const isActive = role === option.role;
            return (
              <button
                key={option.role}
                type="button"
                onClick={() => selectRole(option.role)}
                aria-pressed={isActive}
                className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition active:scale-95 ${
                  isActive
                    ? option.selected
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                    isActive
                      ? option.iconOn
                      : 'bg-white text-slate-400 ring-1 ring-slate-200'
                  }`}
                >
                  <option.icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Two-step stepper (courier onboarding only) */}
      {isCourier && (
        <div className="mb-5 space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2">
            {[
              { id: 1 as const, label: 'Account' },
              { id: 2 as const, label: 'Verification' },
            ].map((item) => {
              const isActive = step === item.id;
              const isDone = step > item.id;
              return (
                <div
                  key={item.id}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[11px] font-extrabold transition ${
                    isActive
                      ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
                      : isDone
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-400'
                  }`}
                >
                  {isDone ? <CheckCircle className="h-3.5 w-3.5" /> : <span>{item.id}</span>}
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-400 transition-all duration-500"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>

          <p className="text-[11px] font-medium text-slate-500">
            {step === 1
              ? 'Step 1 of 2 · Your login credentials'
              : 'Step 2 of 2 · Ghana Card, licence & vehicle verification'}
          </p>
        </div>
      )}
      <form onSubmit={isCourier && step === 1 ? handleContinue : handleSubmit} className="space-y-4">
        {/* ============================ SECTION 1 ============================ */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-[11px] font-black text-emerald-700">
              1
            </span>
            <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">
              Section 1 · Account details
            </h2>
          </div>

          <div>
            <FieldLabel>Full name</FieldLabel>
            <div className="relative">
              <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                name="name"
                autoComplete="name"
                required
                placeholder="e.g. Kwame Mensah"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Email address</FieldLabel>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder="kwame@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Ghana phone number (MoMo / calls)</FieldLabel>
            <div className="relative flex">
              <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 px-3 text-xs font-bold text-slate-600">
                🇬🇭 +233
              </span>
              <input
                type="tel"
                name="phone"
                autoComplete="tel"
                inputMode="tel"
                required
                placeholder="24 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-r-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>
          </div>

          <div>
            <FieldLabel>Password · at least 6 characters</FieldLabel>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="new-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={INPUT_ACTION_CLASS}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* ==================== SECTION 2 (COURIER ONLY) ==================== */}
        {isCourier && step === 2 && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 text-[11px] font-black text-amber-700">
                2
              </span>
              <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">
                Section 2 · Identity &amp; vehicle verification
              </h2>
            </div>

            <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] leading-relaxed text-emerald-800">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
              <span>
                Your Ghana Card, licence and vehicle details are reviewed by the SamleyGo team.
                You go online for deliveries once verification is approved.
              </span>
            </div>

            <div>
              <FieldLabel>Vehicle type</FieldLabel>
              <select
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
                className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/15"
              >
                <option value="Motorcycle">Motorcycle / Okada</option>
                <option value="Bicycle">Bicycle</option>
                <option value="Car">Sedan / Hatchback</option>
                <option value="Van">Delivery Van</option>
              </select>
            </div>

            <div>
              <FieldLabel>Vehicle number plate</FieldLabel>
              <div className="relative">
                <Hash className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. GR-1234-24"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                  className={INPUT_CLASS}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Exactly as printed on your DVLA plate (letters, numbers and dashes).
              </p>
            </div>

            <div>
              <FieldLabel>Ghana Card ID number (PIN)</FieldLabel>
              <div className="relative">
                <CreditCard className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="GHA-123456789-2"
                  value={ghanaCardNumber}
                  onChange={(e) => setGhanaCardNumber(e.target.value.toUpperCase())}
                  maxLength={20}
                  className={INPUT_CLASS}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                15-character PIN from the front of your Ghana Card.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PhotoTile
                label="Ghana Card · Front photo"
                hint="Flat, clear shot of the front of your card"
                file={ghanaCardFront}
                preview={frontPreview}
                onPick={(file) => pickPhoto('front', file)}
                onClear={() => clearPhoto('front')}
              />
              <PhotoTile
                label="Ghana Card · Back photo"
                hint="Flat, clear shot of the back of your card"
                file={ghanaCardBack}
                preview={backPreview}
                onPick={(file) => pickPhoto('back', file)}
                onClear={() => clearPhoto('back')}
              />
            </div>

            <div>
              <FieldLabel>Driving licence ID number</FieldLabel>
              <div className="relative">
                <ClipboardCheck className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. GHA-DL-998877665"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value.toUpperCase())}
                  maxLength={24}
                  className={INPUT_CLASS}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Licence number printed on your Ghanaian driving licence.
              </p>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <ImagePlus className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
              <span>
                JPG, PNG or HEIC up to 10 MB · Photos are compressed before upload to save data.
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3 pt-1">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-emerald-600/25 transition hover:from-emerald-700 hover:to-emerald-600 active:scale-[0.98] disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                <span>Creating your account &amp; uploading documents…</span>
              </>
            ) : (
              <>
                <span>{submitLabel}</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          {isCourier && step === 2 && (
            <button
              type="button"
              onClick={handleBack}
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to account details</span>
            </button>
          )}
        </div>
      </form>
      <div className="mt-5 border-t border-slate-100 pt-4 text-center">
        <p className="text-xs text-slate-500">
          Already registered?{' '}
          <Link
            to="/login"
            className="font-extrabold text-emerald-600 hover:text-emerald-700 hover:underline"
          >
            Sign in here
          </Link>
        </p>
        <p className="mt-3 text-[11px] text-slate-400">
          SamleyGo Ghana · Safe &amp; realtime food logistics
        </p>
      </div>

      <SupabaseConnectModal isOpen={showDbModal} onClose={() => setShowDbModal(false)} />
    </AuthShell>
  );
};
