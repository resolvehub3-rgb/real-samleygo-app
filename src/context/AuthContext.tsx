import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Profile, UserRole, NotificationItem, CourierDocument } from '../types/database';
import { PreparedDocument, UploadedDocument, uploadCourierDocument } from '../lib/documents';

export interface CourierSignUpDetails {
  vehicleType: string;
  vehiclePlate: string;
  ghanaCardNumber: string;
  licenseNumber: string;
  ghanaCardFront?: PreparedDocument | null;
  ghanaCardBack?: PreparedDocument | null;
}

interface SignUpParams {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  role: UserRole;
  courier?: CourierSignUpDetails;
}

interface SignUpResult {
  error: Error | null;
  /** Non-fatal problems, e.g. documents could not be persisted after the account was created */
  warning?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: UserRole;
  isLoading: boolean;
  unreadCount: number;
  notifications: NotificationItem[];
  markNotificationAsRead: (id: string) => Promise<void>;
  /**
   * `role` is the authoritative role resolved during sign-in, so callers can
   * route without depending on a (stale) render closure.
   */
  signIn: (email: string, password: string) => Promise<{ error: Error | null; role?: UserRole }>;
  signUp: (params: SignUpParams) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<Profile>) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  /** Resolves and stores the profile. Returns it so callers (sign-in routing)
   * can act on the authoritative role instead of a stale render closure. */
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        // The profiles row can lag behind account creation (trigger delay) or be
        // hidden by RLS, so build a placeholder from the auth record. Crucially
        // this must NEVER overwrite a profile we already loaded: doing so
        // silently downgraded a SUPER_ADMIN to the default 'CUSTOMER' role
        // every time this call failed.
        const authUser = (await supabase.auth.getUser()).data.user;
        const meta = (authUser?.user_metadata || {}) as {
          full_name?: string;
          phone?: string;
          role?: string;
        };
        const appMetaRole = (authUser?.app_metadata as { role?: string } | undefined)?.role;

        const synthetic: Profile = {
          id: userId,
          email: authUser?.email || user?.email || '',
          full_name: meta.full_name || 'User',
          phone: meta.phone,
          role: (appMetaRole || meta.role || 'CUSTOMER') as UserRole,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setProfile((current) => (current && current.id === userId ? current : synthetic));
        // What the state becomes for a fresh session (an already-loaded
        // profile is intentionally left untouched).
        return synthetic;
      }

      const resolved = data as Profile;
      setProfile(resolved);
      return resolved;
    } catch {
      // Handle gracefully
      return null;
    }
  }, [user]);

  const fetchNotifications = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (data) {
        setNotifications(data as NotificationItem[]);
      }
    } catch {
      // Quiet fail if not yet configured
    }
  }, []);

  // The auth listener below must be registered exactly ONCE. supabase auth-js
  // emits `INITIAL_SESSION` to every newly registered subscription, and it
  // builds that session with a fresh JSON.parse of storage — so the `session`
  // and `session.user` objects it hands us are NEW references on every event.
  // Depending the listener on `fetchProfile` (which is re-created whenever
  // `user` changes identity) therefore made it unsubscribe -> resubscribe ->
  // receive INITIAL_SESSION -> change `user` -> forever: an endless loop that
  // re-rendered the whole tree and re-fired the profile queries on every pass,
  // freezing the app right after sign-in. Route the latest callbacks through
  // refs so the listener's effect can safely depend on nothing.
  const fetchProfileRef = useRef(fetchProfile);
  const fetchNotificationsRef = useRef(fetchNotifications);
  useEffect(() => {
    fetchProfileRef.current = fetchProfile;
    fetchNotificationsRef.current = fetchNotifications;
  }, [fetchProfile, fetchNotifications]);

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      await fetchProfile(user.id);
      await fetchNotifications(user.id);
    }
  }, [user, fetchProfile, fetchNotifications]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    // auth-js re-parses the stored session for every event, so compare auth
    // state by VALUE. Committing an identical-but-rehashed user would churn
    // every consumer of this context (and, before, re-run this effect).
    const sameUser = (a: User | null, b: User | null) =>
      a === b || (!!a && !!b && a.id === b.id && a.updated_at === b.updated_at);

    const commitAuth = (next: Session | null): User | null => {
      const nextUser = next?.user ?? null;
      setSession((prev) => (prev?.access_token === next?.access_token ? prev : next));
      setUser((prev) => (sameUser(prev, nextUser) ? prev : nextUser));
      return nextUser;
    };

    const loadIdentity = async (userId: string) => {
      await Promise.all([
        fetchProfileRef.current(userId),
        fetchNotificationsRef.current(userId),
      ]);
    };

    // Initialize session. The profile must be resolved BEFORE the auth gate is
    // lifted, otherwise role-sensitive screens render with the default
    // 'CUSTOMER' role (and admin screens flicker to "Access Restricted")
    // while the real profile row is still in flight.
    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        const nextUser = commitAuth(session);
        if (nextUser) {
          await loadIdentity(nextUser.id);
        }
        setIsLoading(false);
      })
      .catch(() => {
        // A rejected session lookup (blocked storage, corrupt cache, offline)
        // would otherwise leave every protected route spinning forever.
        setIsLoading(false);
      });

    // Auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const nextUser = commitAuth(session);
      if (nextUser) {
        await loadIdentity(nextUser.id);
      } else {
        setProfile(null);
        setNotifications((prev) => (prev.length === 0 ? prev : []));
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime subscription for user notifications
  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) return;

    const channel = supabase
      .channel(`user-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = payload.new as NotificationItem;
          setNotifications((prev) => [newNotif, ...prev]);

          // Browser Web Notification if permitted
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(newNotif.title, {
              body: newNotif.message,
              icon: '/pwa-192x192.png',
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) return { error };

      // Resolve the profile BEFORE returning: this commits profile/role to
      // context state (so protected routes don't flash "Access Restricted")
      // and hands the caller an authoritative role for role-based routing —
      // the closure value it holds is still the pre-login default.
      const resolved = data?.user ? await fetchProfile(data.user.id) : null;
      return { error: null, role: resolved?.role ?? 'CUSTOMER' };
    } catch (err) {
      // Rejections (network failure, blocked request) must surface as an
      // error result instead of escaping the handler and stranding the
      // global loading gate.
      return {
        error: err instanceof Error ? err : new Error('Sign in failed. Please try again.'),
      };
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async ({
    email,
    password,
    fullName,
    phone,
    role,
    courier,
  }: SignUpParams): Promise<SignUpResult> => {
    setIsLoading(true);

    // A rejected call would otherwise escape this handler and leave
    // isLoading=true, which spins every protected route forever.
    let signUpResponse: Awaited<ReturnType<typeof supabase.auth.signUp>>;
    try {
      signUpResponse = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: phone.trim(),
            role,
            vehicle_type: courier?.vehicleType || 'Motorcycle',
            vehicle_plate: courier?.vehiclePlate || '',
            ghana_card_number: courier?.ghanaCardNumber || '',
            license_number: courier?.licenseNumber || '',
          },
        },
      });
    } catch (err) {
      setIsLoading(false);
      return {
        error:
          err instanceof Error ? err : new Error('Account creation failed. Please try again.'),
      };
    }

    const { data, error } = signUpResponse;

    if (error) {
      setIsLoading(false);
      return { error };
    }

    if (!data.user) {
      setIsLoading(false);
      return { error: new Error('Your account could not be created. Please try again.') };
    }

    const userId = data.user.id;
    let warning: string | undefined;

    try {
      // Ensure profile record is inserted if triggers are disabled
      await supabase.from('profiles').upsert({
        id: userId,
        email: email.trim(),
        full_name: fullName.trim(),
        phone: phone.trim(),
        role,
      });

      if (role === 'COURIER') {
        const details = courier;

        // Section 2 · Identity verification: Ghana Card photos (front & back) go to
        // the PRIVATE courier-documents bucket. We persist the private path and mint
        // short-lived signed URLs later, only for the owner or a super admin.
        let frontUpload: UploadedDocument | null = null;
        let backUpload: UploadedDocument | null = null;

        if (details?.ghanaCardFront) {
          frontUpload = await uploadCourierDocument(userId, 'ghana-card-front', details.ghanaCardFront);
        }

        if (details?.ghanaCardBack) {
          backUpload = await uploadCourierDocument(userId, 'ghana-card-back', details.ghanaCardBack);
        }

        const nowIso = new Date().toISOString();
        const submitted = Boolean(details?.ghanaCardNumber);

        const { error: courierError } = await supabase.from('couriers').upsert(
          {
            id: userId,
            vehicle_type: details?.vehicleType || 'Motorcycle',
            vehicle_plate: details?.vehiclePlate || null,
            verification_status: submitted ? 'PENDING' : 'UNSUBMITTED',
            verification_submitted_at: submitted ? nowIso : null,
            verification_note: null,
            is_approved: false,
            is_online: false,
            availability_status: 'OFFLINE',
          },
          { onConflict: 'id' }
        );

        if (courierError) {
          warning =
            'Your account was created, but the verification documents could not be saved yet. Please contact support to complete verification.';
        } else {
          // courier_documents is the RLS-protected home for Ghana Card & licence data
          const documents: Partial<CourierDocument>[] = [
            {
              courier_id: userId,
              document_type: 'DRIVING_LICENCE',
              document_number: details?.licenseNumber,
              document_url: null,
              status: 'PENDING',
            },
          ];

          if (submitted || frontUpload) {
            documents.push({
              courier_id: userId,
              document_type: 'GHANA_CARD_FRONT',
              document_side: 'FRONT',
              document_number: details?.ghanaCardNumber,
              document_url: frontUpload?.inlineUrl ?? null,
              storage_path: frontUpload?.storagePath,
              status: 'PENDING',
            });
          }

          if (submitted || backUpload) {
            documents.push({
              courier_id: userId,
              document_type: 'GHANA_CARD_BACK',
              document_side: 'BACK',
              document_number: details?.ghanaCardNumber,
              document_url: backUpload?.inlineUrl ?? null,
              storage_path: backUpload?.storagePath,
              status: 'PENDING',
            });
          }

          const { error: docsError } = await supabase
            .from('courier_documents')
            .upsert(documents, { onConflict: 'courier_id,document_type' });

          if (docsError) {
            warning =
              'Your account was created, but the Ghana Card photos could not be indexed for review. Please contact support.';
          } else if (frontUpload?.fallback || backUpload?.fallback) {
            warning =
              'Photos were saved in compressed mode because cloud storage was unavailable. They remain visible to the review team.';
          }
        }
      }
    } catch {
      warning =
        warning || 'Your account was created, but some details could not be saved. Please contact support.';
    }

    setIsLoading(false);
    return { error: null, warning };
  };

  const signOut = async () => {
    setIsLoading(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // A failed network sign-out must not block the user: local auth state is
      // cleared below regardless, and the server session is revoked on expiry.
    } finally {
      setUser(null);
      setSession(null);
      setProfile(null);
      setNotifications([]);
      setIsLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error };
  };

  const updateProfile = async (data: Partial<Profile>) => {
    if (!user?.id) return { error: new Error('Not logged in') };
    const { error } = await supabase
      .from('profiles')
      .update(data)
      .eq('id', user.id);
    if (!error) {
      await refreshProfile();
    }
    return { error };
  };

  const markNotificationAsRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        role: profile?.role || 'CUSTOMER',
        isLoading,
        unreadCount,
        notifications,
        markNotificationAsRead,
        signIn,
        signUp,
        signOut,
        resetPassword,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
