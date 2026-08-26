/**
 * Domain types for Quote A Coin.
 *
 * These mirror the three Firestore collections described in
 * `firebase-blueprint.json`. Note the documented schema drift: the blueprint
 * and the security rules call the logo field `logoUrl`, while the application
 * exclusively reads and writes `logoData` (an inline base64 data URL).
 */

export type DocumentType = 'quotation' | 'invoice';

export type DocumentStatus = 'pending' | 'paid' | 'sent';

export interface Branding {
  /** Hex colour, e.g. `#0f766e`. */
  primaryColor: string;
  /** One of the four Tailwind font utility classes. */
  fontFamily: string;
  /** Base64 data URL of the uploaded logo. Empty string when unset. */
  logoData: string;
}

/** `users/{uid}` */
export interface UserProfile {
  uid: string;
  email: string;
  /** 1 = Basic, 2 = Pro. */
  tier: number;
  businessName?: string;
  businessEmail?: string;
  businessAddress?: string;
  branding?: Partial<Branding>;
  termsAndConditions?: string;
  /** Only meaningful to the rules layer (`'admin'`). Never written by the app. */
  role?: string;
}

/** `clients/{clientId}` */
export interface Client {
  id: string;
  ownerId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface DocumentItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/** `documents/{documentId}` */
export interface InvoiceDocument {
  id: string;
  ownerId: string;
  type: DocumentType;
  number: string;
  /** `yyyy-MM-dd` */
  date: string;
  items: DocumentItem[];
  /** Sum of row totals. There is no tax, discount or shipping. */
  total: number;
  status: DocumentStatus;
  clientId?: string;
  clientName?: string;
  clientEmail?: string;
  clientAddress?: string;
  businessName?: string;
  businessEmail?: string;
  businessAddress?: string;
  /** Set on invoices created from a quotation. */
  relatedQuotationId?: string;
  termsAndConditions?: string;
  branding?: Partial<Branding>;
}
