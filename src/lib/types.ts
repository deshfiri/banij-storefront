/**
 * Storefront API v1 shapes, as the ERP sends them. Every type is open to unknown fields and every
 * enum to unknown values (contract §8.1–8.2): nothing here may crash on an addition.
 */
export type Money = { amount: string; currency: string; formatted: string };

export type SiteStatus = "open" | "maintenance" | "preparing" | "unavailable" | (string & {});
export type ThemePreset = "classic" | "modern" | "minimal";

export type Site = {
  id: string;
  name: string;
  status: SiteStatus;
  accepting_orders: boolean;
  maintenance_message: string | null;
  hosts: { primary: string; subdomain: string; aliases: string[] };
  branding: {
    theme: ThemePreset | (string & {});
    primary_color: string | null;
    secondary_color: string | null;
    logo_url: string | null;
    banner_url: string | null;
    tagline: string | null;
    about: string | null;
  };
  contact: { email: string | null; phone: string | null; address: string | null };
  locale: { default: string; available: string[] };
  currency: string;
  checkout: {
    payment_methods: string[];
    cod: { enabled: boolean; maximum: Money | null };
    guest_checkout: boolean;
  };
};

export type Variant = {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  price: Money | null;
  compare_at_price: Money | null;
  availability: { in_stock: boolean; quantity: number; backorderable: boolean };
};

export type Product = {
  id: string;
  slug: string;
  sku: string;
  name: string;
  short_description: string | null;
  description: string | null;
  promo_title: string | null;
  promotion: { starts_at: string | null; ends_at: string | null } | null;
  brand: { id: string; name: string; slug: string } | null;
  categories: { id: string; slug: string; name: string }[];
  media: { url: string; alt: string | null; position: number; type: string }[];
  variants: Variant[];
  min_order_quantity: number;
  max_order_quantity: number | null;
  is_featured: boolean;
  seo: { title: string | null; description: string | null; canonical: string | null };
  published_at: string | null;
  updated_at: string;
};

export type Category = { id: string; slug: string; name: string; position: number; updated_at: string };

export type Page<T> = { data: T[]; meta: { next_cursor: string | null; has_more: boolean } };

export type Facets = {
  brands: { id: string; slug: string; name: string; products: number }[];
  attributes: { slug: string; name: string; values: { value: string; products: number }[] }[];
  price_range: { minimum: Money; maximum: Money } | null;
};

export type DeliveryArea = {
  id: string;
  type: "division" | "district" | "upazila" | "union" | (string & {});
  name: { en: string; bn: string };
  has_children: boolean;
};

export type QuoteLine = {
  sku: string;
  quantity: number;
  unit_price: Money;
  line_total: Money;
  availability: { in_stock: boolean; quantity: number; reservable: boolean };
};

export type Quote = {
  currency: string;
  items: QuoteLine[];
  subtotal: Money;
  discount: Money;
  shipping: Money;
  tax: Money;
  tax_included: Money;
  grand_total: Money;
  delivery: { basis: string; area_id: string | null };
  payment: { methods: string[]; cod: { enabled: boolean; eligible: boolean; maximum: Money | null } };
  quoted_at: string;
  valid_until: string;
};

export type Order = {
  id: string;
  reference: string;
  storefront_order_reference: string;
  status: string;
  fulfillment_status: string | null;
  courier_status: string | null;
  delivery_status: string | null;
  tracking_number: string | null;
  placed_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  totals: { subtotal: Money; discount: Money; shipping: Money; tax: Money; tax_included: Money; grand_total: Money };
  items: { sku: string; name: string; variant: string | null; quantity: number; unit_price: Money; line_total: Money }[];
  payment: { method: string; state: string | null; gateway: string | null; expires_at: string | null; redirect_url: string | null };
  stock_reservation: { expires_at: string } | null;
  confirmation: { state: string; expires_at: string | null; resend_available_in: number } | null;
  timeline: { status: string; at: string; note: string | null }[];
};
