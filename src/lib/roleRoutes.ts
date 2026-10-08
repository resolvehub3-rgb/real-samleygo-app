import { UserRole } from '../types/database';

/**
 * Where each role belongs. Used after sign-in, after registration, and whenever
 * a guarded route rejects the signed-in role — so a COURIER can never be parked
 * on the restaurant workspace (and vice versa).
 */
export const HOME_PATH_BY_ROLE: Record<UserRole, string> = {
  CUSTOMER: '/',
  COURIER: '/courier/dashboard',
  RESTAURANT_OWNER: '/restaurant/dashboard',
  SUPER_ADMIN: '/admin/dashboard',
};

/**
 * Workspace routes and the roles allowed to open them. This mirrors the
 * `allowedRoles` props wired into App.tsx so post-login routing and route
 * guarding can never disagree. Paths not listed here (public pages, /orders,
 * /profile, /cart, …) are open to every signed-in role.
 */
const WORKSPACE_ACCESS: Array<{ path: string; roles: UserRole[] }> = [
  { path: '/courier/dashboard', roles: ['COURIER', 'SUPER_ADMIN'] },
  { path: '/courier/deliveries', roles: ['COURIER', 'SUPER_ADMIN'] },
  { path: '/courier/earnings', roles: ['COURIER', 'SUPER_ADMIN'] },
  { path: '/restaurant/dashboard', roles: ['RESTAURANT_OWNER', 'SUPER_ADMIN'] },
  { path: '/restaurant/menu', roles: ['RESTAURANT_OWNER', 'SUPER_ADMIN'] },
  { path: '/restaurant/settings', roles: ['RESTAURANT_OWNER', 'SUPER_ADMIN'] },
  { path: '/admin/dashboard', roles: ['SUPER_ADMIN'] },
];

/** Strips query/hash and any trailing slash so `/restaurant/dashboard/` matches. */
const matchKey = (path: string): string =>
  path.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';

export const homePathForRole = (role?: UserRole | null): string =>
  HOME_PATH_BY_ROLE[role ?? 'CUSTOMER'] ?? '/';

/** The roles a path allows, or `null` when the path is not role-restricted. */
export const allowedRolesForPath = (pathname: string): UserRole[] | null =>
  WORKSPACE_ACCESS.find((route) => route.path === matchKey(pathname))?.roles ?? null;

export const canRoleAccessPath = (role: UserRole | null | undefined, pathname: string): boolean => {
  const allowed = allowedRolesForPath(pathname);
  return !allowed || allowed.includes((role ?? 'CUSTOMER') as UserRole);
};

/**
 * The authentication screens: sign-in, sign-up and password recovery.
 *
 * Each renders its own compact application header (logo + the one alternate
 * action), so the site header and the signed-in bottom tab bar are suppressed
 * on these routes rather than duplicating it. Authentication should feel
 * separate from the customer app shell.
 */
export const isAuthPath = (pathname: string): boolean => {
  const key = matchKey(pathname);
  return key === '/login' || key === '/register' || key === '/forgot-password';
};

/**
 * Where a freshly signed-in user lands. An explicit `?redirect=` target wins
 * ONLY when the signed-in role is actually allowed to open it — a courier sent
 * to /login?redirect=/restaurant/dashboard must fall back to the courier
 * workspace instead of hitting "Access Restricted".
 */
export const landingPathFor = (
  role: UserRole | undefined | null,
  redirect?: string | null
): string => {
  const target = redirect?.trim() || '/';
  if (target !== '/' && canRoleAccessPath(role, target)) return target;
  return homePathForRole(role);
};
