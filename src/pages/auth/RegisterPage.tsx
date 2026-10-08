import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail,
  Lock,
  User,
  Bike,
  ChefHat,
  ShoppingBag,
  Eye,
  EyeOff,
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
  AuthAlert,
  FieldLabel,
  INPUT_CLASS,
  INPUT_ACTION_CLASS,
  INPUT_PLAIN_CLASS,
  AUTH_SUBMIT_CLASS,
} from '../../components/auth/AuthShell';

const LABEL_CLASS = 'block text-xs font-bold text-slate-700 mb-1.5';

interface RoleOption {
  role: UserRole;
  label: string;
  icon: LucideIcon;
}

/**
 * The three account types the sign-up flow supports. Selection styling is
 * identical for every role (SamleyGo green): the icon and label carry the
 * difference, so the chosen role reads as *selected* rather than *colour-coded*.
 */
const ROLE_OPTIONS: RoleOption[] = [
  { role: 'CUSTOMER', label: 'Customer', icon: ShoppingBag },
  { role: 'COURIER', label: 'Courier', icon: Bike },
  { role: 'RESTAURANT_OWNER', label: 'Kitchen', icon: ChefHat },
];

const ROLE_SELECTED_CLASS = 'border-brand bg-brand/5 text-slate-900 ring-2 ring-brand/25';
const ROLE_ICON_ON_CLASS = 'bg-brand text-white';
const ROLE_IDLE_CLASS = 'border-slate-200 bg-white text-slate-600 hover:border-slate-300';

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
      className={`relative overflow-hidden rounded-xl border border-dashed transition ${
        file
          ? 'border-brand bg-brand/5'
          : 'border-slate-300 bg-slate-50 hover:border-brand/60 hover:bg-brand/5'
      }`}
    >
      {preview ? (
        <div className="relative">
          <img src={preview} alt={label} className="h-36 w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-slate-950/85 px-2.5 py-2">
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-300">
              <CheckCircle className="h-3.5 w-3.5" />
              Attached
            </span>
            <div className="flex gap-1.5">
              <label className="inline-flex min-h-8 cursor-pointer items-center rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-800 transition active:scale-95">
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
                className="inline-flex min-h-8 items-center rounded-lg bg-rose-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition active:scale-95"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 px-3 py-6 text-center transition active:scale-[0.99]">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-accent shadow-sm ring-1 ring-slate-200">
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
      mode="register"
      title="Create your account"
      subtitle="Order food, deliver packages, or partner your kitchen."
    >
      {errorMsg && <AuthAlert>{errorMsg}</AuthAlert>}

      {/* Account type selector — the same three roles the signup API accepts */}
      <div className="mb-5">
        <span id="role-label" className="mb-2 block text-xs font-bold text-slate-700">
          I'm joining SamleyGo as a…
        </span>
        <div role="radiogroup" aria-labelledby="role-label" className="grid grid-cols-3 gap-2">
          {ROLE_OPTIONS.map((option) => {
            const isActive = role === option.role;
            return (
              <button
                key={option.role}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => selectRole(option.role)}
                className={`flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center transition active:scale-[0.98] ${
                  isActive ? ROLE_SELECTED_CLASS : ROLE_IDLE_CLASS
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
                    isActive ? ROLE_ICON_ON_CLASS : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  <option.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-xs font-bold">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Two-step stepper (courier onboarding only) */}
      {isCourier && (
        <div className="mb-5 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <ol className="flex items-center gap-2">
            {[
              { id: 1 as const, label: 'Account' },
              { id: 2 as const, label: 'Verification' },
            ].map((item) => {
              const isActive = step === item.id;
              const isDone = step > item.id;
              return (
                <li
                  key={item.id}
                  aria-current={isActive ? 'step' : undefined}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-bold transition ${
                    isActive
                      ? 'border-brand bg-brand text-white'
                      : isDone
                        ? 'border-brand/30 bg-brand/10 text-brand-dark'
                        : 'border-slate-200 bg-white text-slate-400'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <span aria-hidden="true">{item.id}</span>
                  )}
                  <span>{item.label}</span>
                </li>
              );
            })}
          </ol>

          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={totalSteps}
            aria-valuenow={step}
            aria-label="Registration progress"
          >
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>

          <p className="text-[11px] font-medium text-slate-500">
            Step {step} of {totalSteps} ·{' '}
            {step === 1
              ? 'Your login credentials'
              : 'Ghana Card, licence & vehicle verification'}
          </p>
        </div>
      )}
      <form onSubmit={isCourier && step === 1 ? handleContinue : handleSubmit} className="space-y-4">
        {/* ============================ SECTION 1 ============================ */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold text-brand-dark"
            >
              1
            </span>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Account details
            </h2>
          </div>

          <div>
            <FieldLabel htmlFor="register-name">Full name</FieldLabel>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="register-name"
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
            <FieldLabel htmlFor="register-email">Email address</FieldLabel>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="register-email"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="register-phone">Ghana phone number (MoMo / calls)</FieldLabel>
            <div className="flex">
              <span className="inline-flex h-12 shrink-0 items-center whitespace-nowrap rounded-l-xl border border-r-0 border-slate-300 bg-slate-100 px-3 text-xs font-bold text-slate-600">
                +233
              </span>
              <input
                id="register-phone"
                type="tel"
                name="phone"
                autoComplete="tel"
                inputMode="tel"
                required
                placeholder="24 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`${INPUT_PLAIN_CLASS} rounded-r-xl border-l-0`}
              />
            </div>
          </div>

          <div>
            <FieldLabel
              htmlFor="register-password"
              hint={
                <span className="text-[11px] font-medium text-slate-400">
                  At least 6 characters
                </span>
              }
            >
              Password
            </FieldLabel>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="register-password"
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
                aria-pressed={showPassword}
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ==================== SECTION 2 (COURIER ONLY) ==================== */}
        {isCourier && step === 2 && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold text-brand-dark"
              >
                2
              </span>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Identity &amp; vehicle verification
              </h2>
            </div>

            <div className="flex gap-2 rounded-xl border border-brand/20 bg-brand/5 p-3 text-[11px] leading-relaxed text-brand-dark">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand" aria-hidden="true" />
              <span>
                Your Ghana Card, licence and vehicle details are reviewed by the SamleyGo team.
                You go online for deliveries once verification is approved.
              </span>
            </div>

            <div>
              <FieldLabel htmlFor="register-vehicle-type">Vehicle type</FieldLabel>
              <select
                id="register-vehicle-type"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
                className={INPUT_PLAIN_CLASS}
              >
                <option value="Motorcycle">Motorcycle / Okada</option>
                <option value="Bicycle">Bicycle</option>
                <option value="Car">Sedan / Hatchback</option>
                <option value="Van">Delivery Van</option>
              </select>
            </div>

            <div>
              <FieldLabel htmlFor="register-plate">Vehicle number plate</FieldLabel>
              <div className="relative">
                <Hash
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="register-plate"
                  type="text"
                  required
                  placeholder="e.g. GR-1234-24"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                  className={INPUT_CLASS}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Exactly as printed on your DVLA plate (letters, numbers and dashes).
              </p>
            </div>

            <div>
              <FieldLabel htmlFor="register-ghana-card">Ghana Card ID number (PIN)</FieldLabel>
              <div className="relative">
                <CreditCard
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="register-ghana-card"
                  type="text"
                  required
                  placeholder="GHA-123456789-2"
                  value={ghanaCardNumber}
                  onChange={(e) => setGhanaCardNumber(e.target.value.toUpperCase())}
                  maxLength={20}
                  className={INPUT_CLASS}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
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
              <FieldLabel htmlFor="register-licence">Driving licence ID number</FieldLabel>
              <div className="relative">
                <ClipboardCheck
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="register-licence"
                  type="text"
                  required
                  placeholder="e.g. GHA-DL-998877665"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value.toUpperCase())}
                  maxLength={24}
                  className={INPUT_CLASS}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Licence number printed on your Ghanaian driving licence.
              </p>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <ImagePlus className="h-3.5 w-3.5 flex-shrink-0 text-brand" aria-hidden="true" />
              <span>
                JPG, PNG or HEIC up to 10 MB · Photos are compressed before upload to save data.
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3 pt-1">
          <button type="submit" disabled={isSubmitting} className={AUTH_SUBMIT_CLASS}>
            {isSubmitting ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden="true"
                />
                <span>
                  {isCourier && step === 2
                    ? 'Creating your account & uploading documents…'
                    : 'Creating your account…'}
                </span>
              </>
            ) : (
              <>
                <span>{submitLabel}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>

          {isCourier && step === 2 && (
            <button
              type="button"
              onClick={handleBack}
              disabled={isSubmitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back to account details</span>
            </button>
          )}
        </div>
      </form>

      <SupabaseConnectModal isOpen={showDbModal} onClose={() => setShowDbModal(false)} />
    </AuthShell>
  );
};
