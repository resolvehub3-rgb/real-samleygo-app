export type UserRole = 'CUSTOMER' | 'COURIER' | 'RESTAURANT_OWNER' | 'SUPER_ADMIN';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'RESTAURANT_PENDING'
  | 'RESTAURANT_ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'COURIER_ASSIGNED'
  | 'COURIER_ACCEPTED'
  | 'PICKED_UP'
  | 'ON_THE_WAY'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'FAILED';

/**
 * Payment lifecycle. `COMPLETED` is the app's "paid" state (equivalent to
 * PAID); refunds are recorded on the order and never by rewriting history.
 */
export type PaymentStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

/**
 * Restaurant settlement lifecycle — deliberately separate from payment.
 * Payment success never means "the restaurant has been paid out":
 * PENDING (not earned yet) -> ELIGIBLE (delivered & paid) ->
 * PROCESSING -> PAID, or CANCELLED/REVERSED when the order is cancelled
 * or refunded.
 */
export type SettlementStatus =
  | 'PENDING'
  | 'ELIGIBLE'
  | 'PROCESSING'
  | 'PAID'
  | 'REVERSED'
  | 'CANCELLED';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: UserRole;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  default_address?: string;
  latitude?: number;
  longitude?: number;
  created_at: string;
}

export interface Restaurant {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  cuisine_type: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  latitude?: number;
  longitude?: number;
  logo_url?: string;
  cover_url?: string;
  is_open: boolean;
  is_approved: boolean;
  opening_time?: string;
  closing_time?: string;
  min_order_amount: number;
  /**
   * Optional per-restaurant commission override. NULL = "use the
   * platform-wide rate from platform_settings.commission" (15% in
   * Phase 1). The effective rate is snapshotted onto each order.
   */
  commission_rate: number | null;
  rating: number;
  total_reviews: number;
  created_at: string;
  updated_at: string;
}

export interface RestaurantCategory {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id?: string;
  name: string;
  description?: string;
  price: number;
  image_url?: string;
  is_available: boolean;
  preparation_time_minutes: number;
  created_at: string;
  updated_at: string;
}

export type CourierVerificationStatus =
  | 'UNSUBMITTED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED';

export interface Courier {
  id: string;
  vehicle_type: string;
  vehicle_plate?: string;
  verification_status: CourierVerificationStatus;
  verification_submitted_at?: string;
  verification_reviewed_at?: string;
  verification_note?: string;
  is_approved: boolean;
  is_online: boolean;
  availability_status: 'OFFLINE' | 'AVAILABLE' | 'ON_DELIVERY';
  current_latitude?: number;
  current_longitude?: number;
  current_location_updated_at?: string;
  last_seen_at?: string;
  total_deliveries: number;
  rating: number;
  created_at: string;
  updated_at: string;
  profile?: Profile;
}

export interface CourierDocument {
  id: string;
  courier_id: string;
  document_type: string; // GHANA_CARD_FRONT, GHANA_CARD_BACK, DRIVING_LICENCE, VEHICLE_INSURANCE, ROAD_WORTHY
  document_side?: 'FRONT' | 'BACK' | string;
  document_number?: string;
  /** Null for text-only records (licence ID) or while a photo is being resolved */
  document_url?: string | null;
  storage_path?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejection_reason?: string;
  uploaded_at: string;
  reviewed_at?: string;
  updated_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  restaurant_id: string;
  courier_id?: string;
  status: OrderStatus;
  /** Food subtotal only — never includes the delivery fee. */
  subtotal: number;
  delivery_fee: number;
  tip: number;
  total_amount: number;
  // ---- Immutable order-level financial record (server-computed) ----
  /** Commission rate snapshotted when the order was created (versioning). */
  commission_rate?: number | null;
  /** Food subtotal × commission_rate — the restaurant commission. */
  commission_amount?: number | null;
  /** Equals the food subtotal. */
  restaurant_gross_amount?: number | null;
  /** Food subtotal minus commission — what the restaurant is owed. */
  restaurant_net_amount?: number | null;
  /** Courier's share of the delivery fee (0% commission in Phase 1). */
  courier_earning?: number | null;
  /** SamleyGo revenue: restaurant commission (+ delivery share, if any). */
  platform_revenue?: number | null;
  currency?: string;
  settlement_status?: SettlementStatus;
  commission_calculated_at?: string;
  settlement_updated_at?: string;
  delivery_address: string;
  delivery_latitude?: number;
  delivery_longitude?: number;
  customer_phone: string;
  delivery_notes?: string;
  payment_method: string;
  payment_status: PaymentStatus;
  payment_reference?: string;
  estimated_delivery_time?: string;
  created_at: string;
  updated_at: string;
  // Joins
  restaurant?: Restaurant;
  customer?: Profile;
  courier?: Profile;
  order_items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id?: string;
  item_name: string;
  item_price: number;
  quantity: number;
  notes?: string;
  subtotal: number;
}

export interface OrderStatusHistory {
  id: string;
  order_id: string;
  status: OrderStatus;
  note?: string;
  changed_by?: string;
  created_at: string;
}

export interface DeliveryLocation {
  id: string;
  order_id: string;
  courier_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
}

export interface Payment {
  id: string;
  order_id: string;
  customer_id: string;
  amount: number;
  currency: string;
  provider: string;
  payment_method: string;
  status: PaymentStatus;
  payment_reference: string;
  transaction_reference?: string;
  paid_at?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/**
 * Append-only refund/reversal record. Never rewrites an order's original
 * financial record — dashboards net these adjustments against it.
 * All *_adjustment fields are SIGNED: negative = money moving back out.
 */
export interface OrderSettlementAdjustment {
  id: string;
  order_id: string;
  adjustment_type: 'REFUND' | 'PARTIAL_REFUND' | 'CANCELLATION' | 'CORRECTION';
  refund_amount: number;
  food_amount_refunded: number;
  delivery_amount_refunded: number;
  commission_adjustment: number;
  restaurant_net_adjustment: number;
  courier_earning_adjustment: number;
  platform_revenue_adjustment: number;
  reason?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface Review {
  id: string;
  order_id: string;
  customer_id: string;
  restaurant_id: string;
  courier_id?: string;
  restaurant_rating?: number;
  restaurant_comment?: string;
  courier_rating?: number;
  courier_comment?: string;
  created_at: string;
  customer?: Profile;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

export interface PlatformPricingSettings {
  base_fee: number;
  per_km_rate: number;
  min_fee: number;
  max_fee: number;
  currency: string;
  surge_multiplier: number;
  /** @deprecated Legacy delivery split — courier earnings now derive from
   * CommissionSettings.courier_commission_percentage (0% in Phase 1). */
  courier_payout_percentage?: number;
  /** @deprecated Legacy delivery split — not used by the Phase 1 model. */
  platform_commission_percentage?: number;
}

/**
 * Marketplace commission rules (platform_settings key `commission`).
 * Phase 1: restaurant commission is charged per order on the food
 * subtotal; the courier commission is 0 (courier receives the delivery
 * earning). Configurable from the Super Admin dashboard.
 */
export interface CommissionSettings {
  restaurant_commission_percentage: number;
  courier_commission_percentage: number;
  max_restaurant_commission_percentage?: number;
  max_courier_commission_percentage?: number;
  currency?: string;
  updated_at?: string;
}

export interface AuditLog {
  id: string;
  actor_id?: string;
  action: string;
  target_type?: string;
  target_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  actor?: Profile;
}
