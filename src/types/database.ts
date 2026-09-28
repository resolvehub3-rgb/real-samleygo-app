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
  commission_rate: number;
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
  subtotal: number;
  delivery_fee: number;
  tip: number;
  total_amount: number;
  delivery_address: string;
  delivery_latitude?: number;
  delivery_longitude?: number;
  customer_phone: string;
  delivery_notes?: string;
  payment_method: string;
  payment_status: 'PENDING' | 'COMPLETED' | 'FAILED';
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
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  payment_reference: string;
  transaction_reference?: string;
  paid_at?: string;
  metadata?: Record<string, unknown>;
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
  courier_payout_percentage: number;
  platform_commission_percentage: number;
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
