import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { ErrorBoundary } from 'react-error-boundary';
import type { FallbackProps } from 'react-error-boundary';
import { AnimatePresence, motion } from 'motion/react';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  ArrowRight,
  Building2,
  Check,
  Coins,
  Download,
  FileText,
  LayoutDashboard,
  LogIn,
  LogOut,
  Mail,
  Palette,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Save,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  where,
} from 'firebase/firestore';

import { auth, db, googleProvider } from './firebase';
import type {
  Branding,
  Client,
  DocumentItem,
  DocumentType,
  InvoiceDocument,
  UserProfile,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Utilities & constants                                                     */
/* -------------------------------------------------------------------------- */

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Amounts are Namibian dollars throughout. The symbol is not configurable. */
function formatCurrency(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `N$ ${safe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

/** Client-generated document ID: base-36, 9 characters. Not cryptographic. */
function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

/** `QT-`/`INV-` plus the last six digits of the current timestamp. */
function generateDocumentNumber(type: DocumentType): string {
  const prefix = type === 'invoice' ? 'INV' : 'QT';
  return `${prefix}-${String(Date.now()).slice(-6)}`;
}

const AUTO_NUMBER_PATTERN = /^(QT|INV)-\d{6}$/;

const FONT_OPTIONS = [
  { id: 'font-sans', label: 'Inter', stack: "'Inter', ui-sans-serif, system-ui, sans-serif" },
  { id: 'font-serif', label: 'Serif', stack: "'Playfair Display', ui-serif, Georgia, serif" },
  { id: 'font-mono', label: 'Mono', stack: "'JetBrains Mono', ui-monospace, monospace" },
  { id: 'font-display', label: 'Display', stack: "'Outfit', 'Inter', ui-sans-serif, sans-serif" },
] as const;

const PRESET_COLORS = [
  { name: 'Teal', value: '#0d9488' },
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Slate', value: '#334155' },
  { name: 'Amber', value: '#d97706' },
  { name: 'Rose', value: '#e11d48' },
  { name: 'Emerald', value: '#059669' },
] as const;

const DEFAULT_BRANDING: Branding = {
  primaryColor: PRESET_COLORS[0].value,
  fontFamily: FONT_OPTIONS[0].id,
  logoData: '',
};

function fontStackFor(fontFamily: string | undefined): string {
  return (
    FONT_OPTIONS.find((f) => f.id === fontFamily)?.stack ?? FONT_OPTIONS[0].stack
  );
}

/** In-memory Tier 1 profile used for the guest path. Never persisted. */
const GUEST_PROFILE: UserProfile = {
  uid: 'guest',
  email: 'guest@quoteacoin.app',
  tier: 1,
  businessName: '',
  businessEmail: '',
  businessAddress: '',
  branding: { ...DEFAULT_BRANDING },
  termsAndConditions: '',
};

type View = 'dashboard' | 'editor' | 'clients' | 'settings' | 'tiers';

/* -------------------------------------------------------------------------- */
/*  Shared UI primitives                                                      */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200';

function SectionCard({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          {icon}
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Error boundary fallback (FR-E1)                                           */
/* -------------------------------------------------------------------------- */

function friendlyErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  // Firestore surfaces some failures as raw JSON blobs. Those are meaningless
  // to a user, so swap them for something actionable.
  if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
    return 'A database error occurred. Please check your permissions and try again.';
  }
  return raw || 'Something went wrong.';
}

function AppErrorFallback({ error }: FallbackProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 p-6 text-center">
      <div className="rounded-full bg-rose-100 p-4">
        <X className="h-7 w-7 text-rose-600" />
      </div>
      <h1 className="text-xl font-semibold text-slate-900">
        Quote A Coin hit a snag
      </h1>
      <p className="max-w-md text-sm text-slate-600">
        {friendlyErrorMessage(error)}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        Reload the app
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Auth screen (FR-A1)                                                       */
/* -------------------------------------------------------------------------- */

function AuthScreen({
  onGoogle,
  onGuest,
  busy,
}: {
  onGoogle: () => void;
  onGuest: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 rounded-2xl bg-teal-600 p-3">
            <Coins className="h-7 w-7 text-white" />
          </div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">
            Quote A Coin
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Professionally branded quotations and invoices, in minutes.
          </p>
        </div>

        <button
          type="button"
          onClick={onGoogle}
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
        >
          <GoogleMark />
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          or
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <button
          type="button"
          onClick={onGuest}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          <LogIn className="h-4 w-4" />
          Try as Guest (Tier 1)
        </button>

        <p className="mt-4 text-center text-xs text-slate-400">
          Guest documents are never saved — they exist until you download them.
        </p>
      </motion.div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5C17.9 1.2 15.2 0 12 0A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tier selection (FR-T1)                                                    */
/* -------------------------------------------------------------------------- */

const TIERS = [
  {
    tier: 1,
    name: 'Basic',
    price: 'Free',
    recommended: false,
    features: [
      'Unlimited quotations and invoices',
      'Full branding: logo, colour, fonts',
      'Live preview while you type',
      'Download as PDF',
    ],
  },
  {
    tier: 2,
    name: 'Pro',
    price: '$3 / month',
    recommended: true,
    features: [
      'Everything in Basic',
      'Documents saved to your account',
      'Client database with autofill',
      'Edit saved documents any time',
      'Turn a quotation into an invoice in one click',
    ],
  },
] as const;

function TierScreen({
  currentTier,
  onSelect,
}: {
  currentTier: number;
  onSelect: (tier: number) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-10 text-center">
        <h1 className="font-display text-3xl font-semibold text-slate-900">
          Choose your plan
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          You can switch at any time from the sidebar.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {TIERS.map((tier) => {
          const isCurrent = currentTier === tier.tier;
          return (
            <motion.div
              key={tier.tier}
              whileHover={{ y: -4 }}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm',
                tier.recommended
                  ? 'border-teal-500 ring-2 ring-teal-100'
                  : 'border-slate-200',
              )}
            >
              {tier.recommended && (
                <span className="absolute -top-3 left-6 rounded-full bg-teal-600 px-3 py-1 text-xs font-medium text-white">
                  Recommended
                </span>
              )}

              <h2 className="font-display text-xl font-semibold text-slate-900">
                {tier.name}
              </h2>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {tier.price}
              </p>

              <ul className="mt-5 flex-1 space-y-2.5">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-sm text-slate-600">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => onSelect(tier.tier)}
                className={cn(
                  'mt-6 w-full rounded-xl px-4 py-2.5 text-sm font-medium transition',
                  tier.recommended
                    ? 'bg-teal-600 text-white hover:bg-teal-700'
                    : 'bg-slate-900 text-white hover:bg-slate-700',
                )}
              >
                {isCurrent ? 'Keep ' : 'Choose '}
                {tier.name}
              </button>
            </motion.div>
          );
        })}
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        No payment is collected. Plan selection is applied to your profile
        immediately.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Document preview (rendered to PDF by html2canvas)                         */
/* -------------------------------------------------------------------------- */

/**
 * The preview is styled almost entirely with inline styles rather than Tailwind
 * utilities. html2canvas cannot parse the `oklch()` colour values Tailwind v4
 * emits, so any Tailwind colour class inside the capture node breaks PDF
 * generation. Layout classes are safe; colour ones are not.
 */
const PREVIEW_WIDTH = 720;

interface PreviewData {
  type: DocumentType;
  number: string;
  date: string;
  businessName: string;
  businessEmail: string;
  businessAddress: string;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
  termsAndConditions: string;
  branding: Branding;
}

function DocumentPreview({
  data,
  nodeRef,
}: {
  data: PreviewData;
  nodeRef: React.RefObject<HTMLDivElement | null>;
}) {
  const accent = data.branding.primaryColor || DEFAULT_BRANDING.primaryColor;
  const fontStack = fontStackFor(data.branding.fontFamily);
  const total = data.items.reduce(
    (sum, item) => sum + toNumber(item.quantity) * toNumber(item.unitPrice),
    0,
  );

  const formattedDate = (() => {
    try {
      return format(new Date(`${data.date}T00:00:00`), 'd MMMM yyyy');
    } catch {
      return data.date;
    }
  })();

  return (
    <div
      ref={nodeRef}
      className="preview-capture"
      style={{
        width: PREVIEW_WIDTH,
        minHeight: PREVIEW_WIDTH * 1.4142,
        aspectRatio: '1 / 1.4142',
        backgroundColor: '#ffffff',
        color: '#0f172a',
        fontFamily: fontStack,
        display: 'flex',
        flexDirection: 'column',
        padding: 48,
        boxSizing: 'border-box',
      }}
    >
      {/* Header ------------------------------------------------------------ */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 24,
          borderBottom: `3px solid ${accent}`,
          paddingBottom: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {data.branding.logoData ? (
            <img
              src={data.branding.logoData}
              alt=""
              style={{ maxHeight: 64, maxWidth: 220, objectFit: 'contain', marginBottom: 10 }}
            />
          ) : null}
          <div style={{ fontSize: 19, fontWeight: 700, color: '#0f172a' }}>
            {data.businessName || 'Your business name'}
          </div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
            {data.businessEmail ? <div>{data.businessEmail}</div> : null}
            {data.businessAddress
              ? data.businessAddress
                  .split('\n')
                  .map((line, i) => <div key={i}>{line}</div>)
              : null}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: accent,
            }}
          >
            {data.type === 'invoice' ? 'Invoice' : 'Quotation'}
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
            <div>
              <span style={{ color: '#94a3b8' }}>No. </span>
              {data.number}
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Date </span>
              {formattedDate}
            </div>
          </div>
        </div>
      </div>

      {/* Bill to ----------------------------------------------------------- */}
      <div style={{ marginTop: 26 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#94a3b8',
            marginBottom: 6,
          }}
        >
          {data.type === 'invoice' ? 'Billed to' : 'Prepared for'}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
          {data.clientName || 'Client name'}
        </div>
        <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3, lineHeight: 1.5 }}>
          {data.clientEmail ? <div>{data.clientEmail}</div> : null}
          {data.clientAddress
            ? data.clientAddress.split('\n').map((line, i) => <div key={i}>{line}</div>)
            : null}
        </div>
      </div>

      {/* Line items -------------------------------------------------------- */}
      <div style={{ marginTop: 26, flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: accent }}>
              <th
                style={{
                  textAlign: 'left',
                  padding: '9px 12px',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 10.5,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                Description
              </th>
              <th
                style={{
                  textAlign: 'right',
                  padding: '9px 12px',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 10.5,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  width: 70,
                }}
              >
                Qty
              </th>
              <th
                style={{
                  textAlign: 'right',
                  padding: '9px 12px',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 10.5,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  width: 110,
                }}
              >
                Unit price
              </th>
              <th
                style={{
                  textAlign: 'right',
                  padding: '9px 12px',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 10.5,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  width: 120,
                }}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: '18px 12px',
                    color: '#94a3b8',
                    textAlign: 'center',
                    borderBottom: '1px solid #e2e8f0',
                  }}
                >
                  No line items yet.
                </td>
              </tr>
            ) : (
              data.items.map((item, index) => {
                const qty = toNumber(item.quantity);
                const price = toNumber(item.unitPrice);
                return (
                  <tr key={index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '10px 12px', color: '#334155' }}>
                      {item.description || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#334155' }}>
                      {qty}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#334155' }}>
                      {formatCurrency(price)}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        color: '#0f172a',
                        fontWeight: 600,
                      }}
                    >
                      {formatCurrency(qty * price)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Total ----------------------------------------------------------- */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <div style={{ minWidth: 260 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                padding: '12px 14px',
                backgroundColor: '#f8fafc',
                border: `1px solid ${accent}`,
                borderRadius: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#64748b',
                }}
              >
                Total due
              </span>
              <span style={{ fontSize: 19, fontWeight: 700, color: accent }}>
                {formatCurrency(total)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Terms ------------------------------------------------------------- */}
      {data.termsAndConditions ? (
        <div style={{ marginTop: 26, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#94a3b8',
              marginBottom: 6,
            }}
          >
            Terms &amp; conditions
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: '#64748b',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {data.termsAndConditions}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Document editor (FR-D*)                                                   */
/* -------------------------------------------------------------------------- */

interface EditorFormValues {
  type: DocumentType;
  number: string;
  date: string;
  businessName: string;
  businessEmail: string;
  businessAddress: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  items: Array<{ id: string; description: string; quantity: number; unitPrice: number }>;
  termsAndConditions: string;
  primaryColor: string;
  fontFamily: string;
  logoData: string;
}

function buildDefaults(
  profile: UserProfile,
  existing: InvoiceDocument | null,
): EditorFormValues {
  const branding = { ...DEFAULT_BRANDING, ...(profile.branding ?? {}) };

  if (existing) {
    const docBranding = { ...branding, ...(existing.branding ?? {}) };
    return {
      type: existing.type,
      number: existing.number,
      date: existing.date,
      businessName: existing.businessName ?? profile.businessName ?? '',
      businessEmail: existing.businessEmail ?? profile.businessEmail ?? '',
      businessAddress: existing.businessAddress ?? profile.businessAddress ?? '',
      clientId: existing.clientId ?? '',
      clientName: existing.clientName ?? '',
      clientEmail: existing.clientEmail ?? '',
      clientAddress: existing.clientAddress ?? '',
      items:
        existing.items?.length > 0
          ? existing.items.map((item) => ({
              id: item.id || generateId(),
              description: item.description ?? '',
              quantity: toNumber(item.quantity),
              unitPrice: toNumber(item.unitPrice),
            }))
          : [{ id: generateId(), description: '', quantity: 1, unitPrice: 0 }],
      termsAndConditions:
        existing.termsAndConditions ?? profile.termsAndConditions ?? '',
      primaryColor: docBranding.primaryColor,
      fontFamily: docBranding.fontFamily,
      logoData: docBranding.logoData,
    };
  }

  return {
    type: 'quotation',
    number: generateDocumentNumber('quotation'),
    date: format(new Date(), 'yyyy-MM-dd'),
    businessName: profile.businessName ?? '',
    businessEmail: profile.businessEmail ?? '',
    businessAddress: profile.businessAddress ?? '',
    clientId: '',
    clientName: '',
    clientEmail: '',
    clientAddress: '',
    items: [{ id: generateId(), description: '', quantity: 1, unitPrice: 0 }],
    termsAndConditions: profile.termsAndConditions ?? '',
    primaryColor: branding.primaryColor,
    fontFamily: branding.fontFamily,
    logoData: branding.logoData,
  };
}

function DocumentEditor({
  profile,
  clients,
  existing,
  onSave,
  onDownload,
  onCancel,
}: {
  profile: UserProfile;
  clients: Client[];
  existing: InvoiceDocument | null;
  onSave: (values: EditorFormValues, existing: InvoiceDocument | null) => Promise<void>;
  onDownload: (node: HTMLElement, type: DocumentType, number: string) => Promise<void>;
  onCancel: () => void;
}) {
  const isTier2 = profile.tier === 2 && profile.uid !== 'guest';
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);

  const { register, control, handleSubmit, watch, setValue, getValues } =
    useForm<EditorFormValues>({
      defaultValues: buildDefaults(profile, existing),
    });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const values = watch();

  // Computed on every render, deliberately. react-hook-form mutates its values
  // object in place, so `values.items` keeps the same array reference between
  // keystrokes - memoising on it would leave the total stale.
  const total = (values.items ?? []).reduce(
    (sum, item) => sum + toNumber(item.quantity) * toNumber(item.unitPrice),
    0,
  );

  /**
   * Invoices are meant to be generated from an existing quotation, so the
   * invoice -> quotation direction is locked once the type is set to invoice.
   */
  const quotationLocked = values.type === 'invoice';

  const setType = (type: DocumentType) => {
    if (type === 'quotation' && quotationLocked) return;
    setValue('type', type);
    // Swap the prefix only while the number is still the generated one.
    const current = getValues('number');
    if (AUTO_NUMBER_PATTERN.test(current)) {
      setValue('number', generateDocumentNumber(type));
    }
  };

  const handleClientSelect = (clientId: string) => {
    setValue('clientId', clientId);
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    setValue('clientName', client.name ?? '');
    setValue('clientEmail', client.email ?? '');
    setValue('clientAddress', client.address ?? '');
  };

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setValue('logoData', String(reader.result ?? ''));
    reader.readAsDataURL(file);
  };

  const onSubmit = async (formValues: EditorFormValues) => {
    setBusy(true);
    try {
      if (isTier2) {
        await onSave(formValues, existing);
      } else if (previewRef.current) {
        await onDownload(previewRef.current, formValues.type, formValues.number);
      }
    } finally {
      setBusy(false);
    }
  };

  const previewData: PreviewData = {
    type: values.type,
    number: values.number,
    date: values.date,
    businessName: values.businessName,
    businessEmail: values.businessEmail,
    businessAddress: values.businessAddress,
    clientName: values.clientName,
    clientEmail: values.clientEmail,
    clientAddress: values.clientAddress,
    items: values.items ?? [],
    termsAndConditions: values.termsAndConditions,
    branding: {
      primaryColor: values.primaryColor,
      fontFamily: values.fontFamily,
      logoData: values.logoData,
    },
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(400px,1fr)_auto]"
    >
      {/* ---------------------------------------------------------------- */}
      {/* Controls                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-5">
        <SectionCard title="Document" icon={<FileText className="h-4 w-4 text-slate-400" />}>
          <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setType('quotation')}
              disabled={quotationLocked}
              className={cn(
                'rounded-lg px-4 py-1.5 text-sm font-medium transition',
                values.type === 'quotation'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
                quotationLocked && 'cursor-not-allowed opacity-40 hover:text-slate-500',
              )}
            >
              Quotation
            </button>
            <button
              type="button"
              onClick={() => setType('invoice')}
              className={cn(
                'rounded-lg px-4 py-1.5 text-sm font-medium transition',
                values.type === 'invoice'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              Invoice
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Number">
              <input className={inputClass} {...register('number')} />
            </Field>
            <Field label="Date">
              <input type="date" className={inputClass} {...register('date')} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Your business" icon={<Building2 className="h-4 w-4 text-slate-400" />}>
          <div className="space-y-3">
            <Field label="Business name">
              <input className={inputClass} placeholder="Acme Trading CC" {...register('businessName')} />
            </Field>
            <Field label="Email">
              <input className={inputClass} placeholder="hello@acme.na" {...register('businessEmail')} />
            </Field>
            <Field label="Address">
              <textarea rows={2} className={inputClass} {...register('businessAddress')} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Client" icon={<Users className="h-4 w-4 text-slate-400" />}>
          <div className="space-y-3">
            {isTier2 && (
              <Field label="Saved clients">
                <select
                  className={inputClass}
                  value={values.clientId}
                  onChange={(e) => handleClientSelect(e.target.value)}
                >
                  <option value="">Enter details manually…</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Client name">
              <input className={inputClass} {...register('clientName')} />
            </Field>
            <Field label="Email">
              <input className={inputClass} {...register('clientEmail')} />
            </Field>
            <Field label="Address">
              <textarea rows={2} className={inputClass} {...register('clientAddress')} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          title="Line items"
          icon={<Receipt className="h-4 w-4 text-slate-400" />}
          action={
            <button
              type="button"
              onClick={() =>
                append({ id: generateId(), description: '', quantity: 1, unitPrice: 0 })
              }
              className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add row
            </button>
          }
        >
          <div className="space-y-2">
            {fields.map((field, index) => {
              const rowTotal =
                toNumber(values.items?.[index]?.quantity) *
                toNumber(values.items?.[index]?.unitPrice);
              return (
                <div
                  key={field.id}
                  className="grid grid-cols-[1fr_70px_100px_auto] items-center gap-2"
                >
                  <input
                    className={inputClass}
                    placeholder="Description"
                    {...register(`items.${index}.description` as const)}
                  />
                  <input
                    type="number"
                    step="any"
                    className={cn(inputClass, 'text-right')}
                    {...register(`items.${index}.quantity` as const, { valueAsNumber: true })}
                  />
                  <input
                    type="number"
                    step="any"
                    className={cn(inputClass, 'text-right')}
                    {...register(`items.${index}.unitPrice` as const, { valueAsNumber: true })}
                  />
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={fields.length === 1}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div className="col-span-4 -mt-1 text-right text-xs text-slate-400">
                    {formatCurrency(rowTotal)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
            <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Total
            </span>
            <span className="text-lg font-semibold" style={{ color: values.primaryColor }}>
              {formatCurrency(total)}
            </span>
          </div>
        </SectionCard>

        <SectionCard title="Branding" icon={<Palette className="h-4 w-4 text-slate-400" />}>
          <div className="space-y-4">
            <Field label="Primary colour">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  className="h-9 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                  {...register('primaryColor')}
                />
                <div className="flex gap-1.5">
                  {PRESET_COLORS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      title={preset.name}
                      onClick={() => setValue('primaryColor', preset.value)}
                      className="h-7 w-7 rounded-full border-2 border-white ring-1 ring-slate-200 transition hover:scale-110"
                      style={{ backgroundColor: preset.value }}
                    />
                  ))}
                </div>
              </div>
            </Field>

            <Field label="Font">
              <select className={inputClass} {...register('fontFamily')}>
                {FONT_OPTIONS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Logo">
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700"
                />
                {values.logoData && (
                  <button
                    type="button"
                    onClick={() => setValue('logoData', '')}
                    className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Remove logo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Terms &amp; conditions" icon={<FileText className="h-4 w-4 text-slate-400" />}>
          <textarea
            rows={4}
            className={inputClass}
            placeholder="Payment due within 30 days…"
            {...register('termsAndConditions')}
          />
        </SectionCard>

        <div className="flex gap-3 pb-6">
          <button
            type="submit"
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {isTier2 ? <Save className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {busy ? 'Working…' : isTier2 ? 'Save Document' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Live preview (FR-D1)                                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="xl:sticky xl:top-20 xl:self-start">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-slate-400 uppercase">
          <Sparkles className="h-3.5 w-3.5" />
          Live preview
        </div>
        <div className="overflow-auto rounded-2xl border border-slate-200 bg-slate-200 p-3 shadow-sm xl:max-h-[calc(100vh-7rem)]">
          <DocumentPreview data={previewData} nodeRef={previewRef} />
        </div>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Dashboard (FR-M*)                                                         */
/* -------------------------------------------------------------------------- */

function Dashboard({
  profile,
  documents,
  onNew,
  onEdit,
  onDelete,
  onConvert,
}: {
  profile: UserProfile;
  documents: InvoiceDocument[];
  onNew: () => void;
  onEdit: (document: InvoiceDocument) => void;
  onDelete: (document: InvoiceDocument) => void;
  onConvert: (document: InvoiceDocument) => void;
}) {
  // Tier 1 has no cloud storage, so there is nothing to list (FR-M5).
  if (profile.tier !== 2 || profile.uid === 'guest') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <div className="mb-5 rounded-2xl bg-teal-50 p-4">
          <FileText className="h-8 w-8 text-teal-600" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-slate-900">
          Ready when you are
        </h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Design a quotation or invoice in the live editor and download it as a
          PDF. Upgrade to Pro to save documents to your account.
        </p>
        <button
          type="button"
          onClick={onNew}
          className="mt-6 flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" />
          Start New Quotation
        </button>
      </div>
    );
  }

  const sorted = [...documents].sort((a, b) => (a.date < b.date ? 1 : -1));
  const quotationCount = documents.filter((d) => d.type === 'quotation').length;
  const invoiceCount = documents.filter((d) => d.type === 'invoice').length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {quotationCount} quotation{quotationCount === 1 ? '' : 's'} ·{' '}
            {invoiceCount} invoice{invoiceCount === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" />
          New Document
        </button>
      </header>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-500">
            Nothing saved yet. Create your first document to see it here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {sorted.map((document) => {
              const accent =
                document.branding?.primaryColor ?? DEFAULT_BRANDING.primaryColor;
              return (
                <motion.article
                  key={document.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
                >
                  <span
                    className="absolute inset-x-0 top-0 h-1"
                    style={{ backgroundColor: accent }}
                  />

                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs font-medium',
                        document.type === 'invoice'
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'bg-teal-50 text-teal-700',
                      )}
                    >
                      {document.type === 'invoice' ? 'Invoice' : 'Quotation'}
                    </span>
                    <span className="text-xs text-slate-400">{document.date}</span>
                  </div>

                  <h3 className="mt-3 text-sm font-semibold text-slate-900">
                    {document.number}
                  </h3>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {document.clientName || 'No client'}
                  </p>

                  <p
                    className="mt-4 text-xl font-semibold"
                    style={{ color: accent }}
                  >
                    {formatCurrency(document.total)}
                  </p>

                  {/* Actions revealed on hover (FR-M3, FR-M4) */}
                  <div className="mt-4 flex gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => onEdit(document)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>

                    {document.type === 'quotation' && (
                      <button
                        type="button"
                        onClick={() => onConvert(document)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        Invoice
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onDelete(document)}
                      className="ml-auto rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      aria-label={`Delete ${document.number}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Clients (FR-C*)                                                           */
/* -------------------------------------------------------------------------- */

function ClientsScreen({
  clients,
  onAdd,
  onDelete,
}: {
  clients: Client[];
  onAdd: (client: Omit<Client, 'id' | 'ownerId'>) => Promise<void>;
  onDelete: (client: Client) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, reset } = useForm<Omit<Client, 'id' | 'ownerId'>>({
    defaultValues: { name: '', email: '', phone: '', address: '' },
  });

  const submit = handleSubmit(async (values) => {
    setBusy(true);
    try {
      await onAdd(values);
      reset();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Clients</h1>
          <p className="mt-1 text-sm text-slate-500">
            {clients.length} saved client{clients.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" />
          Add Client
        </button>
      </header>

      {clients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-500">
            No clients yet. Add one to autofill it in the editor.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {clients.map((client) => (
              <motion.article
                key={client.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">{client.name}</h3>
                  <button
                    type="button"
                    onClick={() => onDelete(client)}
                    className="rounded-lg p-1.5 text-slate-400 opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Delete ${client.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-3 space-y-1.5 text-sm text-slate-500">
                  {client.email && (
                    <p className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{client.email}</span>
                    </p>
                  )}
                  {client.phone && (
                    <p className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      {client.phone}
                    </p>
                  )}
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={() => setOpen(false)}
          >
            <motion.form
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={submit}
              className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Add client
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                <Field label="Name">
                  <input className={inputClass} required {...register('name')} />
                </Field>
                <Field label="Email">
                  <input className={inputClass} {...register('email')} />
                </Field>
                <Field label="Phone">
                  <input className={inputClass} {...register('phone')} />
                </Field>
                <Field label="Address">
                  <textarea rows={2} className={inputClass} {...register('address')} />
                </Field>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="mt-6 w-full rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save client'}
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Settings (FR-S*)                                                          */
/* -------------------------------------------------------------------------- */

interface SettingsFormValues {
  businessName: string;
  businessEmail: string;
  businessAddress: string;
  primaryColor: string;
  fontFamily: string;
  logoData: string;
  termsAndConditions: string;
}

function SettingsScreen({
  profile,
  onSave,
}: {
  profile: UserProfile;
  onSave: (values: SettingsFormValues) => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  const branding = { ...DEFAULT_BRANDING, ...(profile.branding ?? {}) };

  const { register, handleSubmit, watch, setValue } = useForm<SettingsFormValues>({
    defaultValues: {
      businessName: profile.businessName ?? '',
      businessEmail: profile.businessEmail ?? '',
      businessAddress: profile.businessAddress ?? '',
      primaryColor: branding.primaryColor,
      fontFamily: branding.fontFamily,
      logoData: branding.logoData,
      termsAndConditions: profile.termsAndConditions ?? '',
    },
  });

  const logoData = watch('logoData');

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setValue('logoData', String(reader.result ?? ''));
    reader.readAsDataURL(file);
  };

  const submit = handleSubmit(async (values) => {
    await onSave(values);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  });

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          These values prefill every new document.
        </p>
      </header>

      <SectionCard title="Business details" icon={<Building2 className="h-4 w-4 text-slate-400" />}>
        <div className="space-y-3">
          <Field label="Business name">
            <input className={inputClass} {...register('businessName')} />
          </Field>
          <Field label="Email">
            <input className={inputClass} {...register('businessEmail')} />
          </Field>
          <Field label="Address">
            <textarea rows={3} className={inputClass} {...register('businessAddress')} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Default branding" icon={<Palette className="h-4 w-4 text-slate-400" />}>
        <div className="space-y-4">
          <Field label="Primary colour">
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="h-9 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                {...register('primaryColor')}
              />
              <div className="flex gap-1.5">
                {PRESET_COLORS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    title={preset.name}
                    onClick={() => setValue('primaryColor', preset.value)}
                    className="h-7 w-7 rounded-full border-2 border-white ring-1 ring-slate-200 transition hover:scale-110"
                    style={{ backgroundColor: preset.value }}
                  />
                ))}
              </div>
            </div>
          </Field>

          <Field label="Font">
            <select className={inputClass} {...register('fontFamily')}>
              {FONT_OPTIONS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Default logo">
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700"
              />
              {logoData && (
                <>
                  <img
                    src={logoData}
                    alt="Current logo"
                    className="h-9 w-9 shrink-0 rounded border border-slate-200 object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => setValue('logoData', '')}
                    className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Remove logo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
            <span className="mt-1.5 block text-xs text-slate-400">
              Logos are stored inline in your profile, so keep them well under 1 MB.
            </span>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Default terms &amp; conditions" icon={<FileText className="h-4 w-4 text-slate-400" />}>
        <textarea rows={5} className={inputClass} {...register('termsAndConditions')} />
      </SectionCard>

      <button
        type="submit"
        className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-teal-700"
      >
        {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {saved ? 'Saved' : 'Save settings'}
      </button>

      {profile.uid === 'guest' && (
        <p className="text-xs text-amber-600">
          You are in guest mode — settings apply to this session only and are
          never stored.
        </p>
      )}
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  App shell (FR-N*)                                                         */
/* -------------------------------------------------------------------------- */

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Root                                                                      */
/* -------------------------------------------------------------------------- */

function QuoteACoin() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [view, setView] = useState<View>('dashboard');
  const [editingDocument, setEditingDocument] = useState<InvoiceDocument | null>(null);

  const [documents, setDocuments] = useState<InvoiceDocument[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const isTier2 = profile?.tier === 2 && !isGuest;

  /* --- Auth (FR-A2, FR-A3) --------------------------------------------- */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);

      if (!user) {
        setProfile(null);
        setDocuments([]);
        setClients([]);
        setLoading(false);
        return;
      }

      setIsGuest(false);
      try {
        const ref = doc(db, 'users', user.uid);
        const snapshot = await getDoc(ref);

        if (snapshot.exists()) {
          setProfile(snapshot.data() as UserProfile);
          setView('dashboard');
        } else {
          // First sign-in: create the profile at Tier 1 and offer the tiers.
          const created: UserProfile = {
            uid: user.uid,
            email: user.email ?? '',
            tier: 1,
            businessName: user.displayName ?? '',
            businessEmail: user.email ?? '',
            businessAddress: '',
            branding: { ...DEFAULT_BRANDING },
            termsAndConditions: '',
          };
          await setDoc(ref, created);
          setProfile(created);
          setView('tiers');
        }
      } catch (error) {
        console.error('Failed to load user profile', error);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  /* --- Live data (FR-M1, FR-C1) ---------------------------------------- */
  useEffect(() => {
    if (!authUser || !isTier2) {
      setDocuments([]);
      return;
    }
    const q = query(collection(db, 'documents'), where('ownerId', '==', authUser.uid));
    return onSnapshot(
      q,
      (snapshot) =>
        setDocuments(snapshot.docs.map((d) => d.data() as InvoiceDocument)),
      (error) => console.error('Document sync failed', error),
    );
  }, [authUser, isTier2]);

  useEffect(() => {
    if (!authUser || !isTier2) {
      setClients([]);
      return;
    }
    const q = query(collection(db, 'clients'), where('ownerId', '==', authUser.uid));
    return onSnapshot(
      q,
      (snapshot) =>
        setClients(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Client)),
      (error) => console.error('Client sync failed', error),
    );
  }, [authUser, isTier2]);

  /* --- Auth actions ----------------------------------------------------- */
  const signInWithGoogle = useCallback(async () => {
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      // Errors are logged only; there is no user-facing message (FR-A3).
      console.error('Google sign-in failed', error);
    } finally {
      setBusy(false);
    }
  }, []);

  const enterGuestMode = useCallback(() => {
    setIsGuest(true);
    setProfile({ ...GUEST_PROFILE, branding: { ...DEFAULT_BRANDING } });
    setView('dashboard');
    setLoading(false);
  }, []);

  const exitGuestMode = useCallback(() => {
    setIsGuest(false);
    setProfile(null);
    setView('dashboard');
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Sign-out failed', error);
    }
    setProfile(null);
    setView('dashboard');
  }, []);

  /* --- Tier selection (FR-T1) ------------------------------------------ */
  const selectTier = useCallback(
    async (tier: number) => {
      if (!profile) return;
      const next = { ...profile, tier };
      setProfile(next);
      setView('dashboard');
      if (isGuest || !authUser) return;
      try {
        await setDoc(doc(db, 'users', authUser.uid), next);
      } catch (error) {
        console.error('Failed to update tier', error);
      }
    },
    [profile, isGuest, authUser],
  );

  /* --- Settings (FR-S2) ------------------------------------------------- */
  const saveSettings = useCallback(
    async (values: SettingsFormValues) => {
      if (!profile) return;
      const next: UserProfile = {
        ...profile,
        businessName: values.businessName,
        businessEmail: values.businessEmail,
        businessAddress: values.businessAddress,
        branding: {
          primaryColor: values.primaryColor,
          fontFamily: values.fontFamily,
          logoData: values.logoData,
        },
        termsAndConditions: values.termsAndConditions,
      };
      setProfile(next);

      // Guests have no backing document, so there is nothing to write.
      if (isGuest || !authUser) return;
      try {
        await setDoc(doc(db, 'users', authUser.uid), next);
      } catch (error) {
        console.error('Failed to save settings', error);
      }
    },
    [profile, isGuest, authUser],
  );

  /* --- Documents -------------------------------------------------------- */
  const saveDocument = useCallback(
    async (values: EditorFormValues, existing: InvoiceDocument | null) => {
      if (!authUser || !profile) return;

      const items: DocumentItem[] = (values.items ?? []).map((item) => {
        const quantity = toNumber(item.quantity);
        const unitPrice = toNumber(item.unitPrice);
        return {
          id: item.id || generateId(),
          description: item.description ?? '',
          quantity,
          unitPrice,
          total: quantity * unitPrice,
        };
      });

      const payload: InvoiceDocument = {
        id: existing?.id ?? generateId(),
        ownerId: authUser.uid,
        type: values.type,
        number: values.number,
        date: values.date,
        items,
        total: items.reduce((sum, item) => sum + item.total, 0),
        status: existing?.status ?? 'pending',
        clientId: values.clientId || '',
        clientName: values.clientName,
        clientEmail: values.clientEmail,
        clientAddress: values.clientAddress,
        businessName: values.businessName,
        businessEmail: values.businessEmail,
        businessAddress: values.businessAddress,
        termsAndConditions: values.termsAndConditions,
        branding: {
          primaryColor: values.primaryColor,
          fontFamily: values.fontFamily,
          logoData: values.logoData,
        },
      };

      if (existing?.relatedQuotationId) {
        payload.relatedQuotationId = existing.relatedQuotationId;
      }

      try {
        // The `id` field doubles as the Firestore document ID.
        await setDoc(doc(db, 'documents', payload.id), payload);
        setEditingDocument(null);
        setView('dashboard');
      } catch (error) {
        console.error('Failed to save document', error);
      }
    },
    [authUser, profile],
  );

  /* --- PDF generation (FR-P1, FR-P2) ------------------------------------ */
  const downloadPdf = useCallback(
    async (node: HTMLElement, type: DocumentType, number: string) => {
      try {
        const canvas = await html2canvas(node, {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
        });

        const imageData = canvas.toDataURL('image/png');
        // `compress` keeps the embedded raster from ballooning the file; an
        // uncompressed one-page capture runs to several megabytes.
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
          compress: true,
        });

        // Scale to full page width; height follows proportionally. Content
        // taller than one page is not paginated.
        const pageWidth = pdf.internal.pageSize.getWidth();
        const imageHeight = (canvas.height * pageWidth) / canvas.width;

        pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, imageHeight);
        pdf.save(`${type}-${number}.pdf`);

        setEditingDocument(null);
        setView('dashboard');
      } catch (error) {
        console.error('Failed to generate PDF', error);
      }
    },
    [],
  );

  const deleteDocument = useCallback(async (document: InvoiceDocument) => {
    if (!window.confirm(`Delete ${document.number}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'documents', document.id));
    } catch (error) {
      console.error('Failed to delete document', error);
    }
  }, []);

  /**
   * Clone a quotation into a brand-new invoice and open it in the editor
   * (FR-M4). The source quotation is left untouched.
   */
  const convertToInvoice = useCallback((quotation: InvoiceDocument) => {
    setEditingDocument({
      ...quotation,
      id: generateId(),
      type: 'invoice',
      number: generateDocumentNumber('invoice'),
      relatedQuotationId: quotation.id,
      status: 'pending',
    });
    setView('editor');
  }, []);

  /* --- Clients ---------------------------------------------------------- */
  const addClient = useCallback(
    async (values: Omit<Client, 'id' | 'ownerId'>) => {
      if (!authUser) return;
      try {
        await addDoc(collection(db, 'clients'), { ...values, ownerId: authUser.uid });
      } catch (error) {
        console.error('Failed to add client', error);
      }
    },
    [authUser],
  );

  const deleteClient = useCallback(async (client: Client) => {
    if (!window.confirm(`Delete ${client.name}?`)) return;
    try {
      await deleteDoc(doc(db, 'clients', client.id));
    } catch (error) {
      console.error('Failed to delete client', error);
    }
  }, []);

  /* --- Render ----------------------------------------------------------- */
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <Coins className="h-7 w-7 animate-pulse text-teal-600" />
          <p className="text-sm text-slate-400">Loading Quote A Coin…</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <AuthScreen onGoogle={signInWithGoogle} onGuest={enterGuestMode} busy={busy} />
    );
  }

  const startNewDocument = () => {
    setEditingDocument(null);
    setView('editor');
  };

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Sidebar (FR-N1) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-200 bg-white p-4 lg:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2 pt-2">
          <div className="rounded-xl bg-teal-600 p-2">
            <Coins className="h-4 w-4 text-white" />
          </div>
          <span className="font-display text-base font-semibold text-slate-900">
            Quote A Coin
          </span>
        </div>

        <nav className="space-y-1">
          <NavButton
            icon={<LayoutDashboard className="h-4 w-4" />}
            label="Dashboard"
            active={view === 'dashboard'}
            onClick={() => setView('dashboard')}
          />
          <NavButton
            icon={<Plus className="h-4 w-4" />}
            label="New Document"
            active={view === 'editor'}
            onClick={startNewDocument}
          />
          {isTier2 && (
            <NavButton
              icon={<Users className="h-4 w-4" />}
              label="Clients"
              active={view === 'clients'}
              onClick={() => setView('clients')}
            />
          )}
          <NavButton
            icon={<SettingsIcon className="h-4 w-4" />}
            label="Settings"
            active={view === 'settings'}
            onClick={() => setView('settings')}
          />
        </nav>

        <div className="mt-auto space-y-1 border-t border-slate-200 pt-4">
          <div className="px-3 pb-2">
            <p className="truncate text-xs font-medium text-slate-700">
              {isGuest ? 'Guest session' : profile.email}
            </p>
            <p className="text-xs text-slate-400">
              Tier {profile.tier} · {profile.tier === 2 ? 'Pro' : 'Basic'}
            </p>
          </div>
          <NavButton
            icon={<LogOut className="h-4 w-4" />}
            label={isGuest ? 'Exit guest mode' : 'Sign Out'}
            onClick={isGuest ? exitGuestMode : handleSignOut}
          />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="rounded-lg bg-teal-600 p-1.5">
              <Coins className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-display text-sm font-semibold text-slate-900">
              Quote A Coin
            </span>
          </div>

          <div className="hidden text-sm text-slate-500 lg:block">
            {view === 'editor'
              ? editingDocument
                ? `Editing ${editingDocument.number}`
                : 'New document'
              : null}
          </div>

          <div className="flex items-center gap-3">
            {profile.tier === 1 && (
              <button
                type="button"
                onClick={() => (isGuest ? exitGuestMode() : setView('tiers'))}
                className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isGuest ? 'Login to Upgrade' : 'Upgrade to Pro'}
              </button>
            )}
            <span className="hidden text-xs text-slate-400 sm:block">
              {isGuest ? 'Guest' : profile.email}
            </span>
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
          <MobileTab label="Dashboard" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <MobileTab label="New" active={view === 'editor'} onClick={startNewDocument} />
          {isTier2 && (
            <MobileTab label="Clients" active={view === 'clients'} onClick={() => setView('clients')} />
          )}
          <MobileTab label="Settings" active={view === 'settings'} onClick={() => setView('settings')} />
          <MobileTab
            label={isGuest ? 'Exit' : 'Sign out'}
            onClick={isGuest ? exitGuestMode : handleSignOut}
          />
        </nav>

        <main className="min-w-0 flex-1 p-5 lg:p-8">
          {view === 'tiers' && (
            <TierScreen currentTier={profile.tier} onSelect={selectTier} />
          )}

          {view === 'dashboard' && (
            <Dashboard
              profile={profile}
              documents={documents}
              onNew={startNewDocument}
              onEdit={(document) => {
                setEditingDocument(document);
                setView('editor');
              }}
              onDelete={deleteDocument}
              onConvert={convertToInvoice}
            />
          )}

          {view === 'editor' && (
            <DocumentEditor
              key={editingDocument?.id ?? 'new'}
              profile={profile}
              clients={clients}
              existing={editingDocument}
              onSave={saveDocument}
              onDownload={downloadPdf}
              onCancel={() => {
                setEditingDocument(null);
                setView('dashboard');
              }}
            />
          )}

          {view === 'clients' && isTier2 && (
            <ClientsScreen clients={clients} onAdd={addClient} onDelete={deleteClient} />
          )}

          {view === 'settings' && (
            <SettingsScreen profile={profile} onSave={saveSettings} />
          )}
        </main>
      </div>
    </div>
  );
}

function MobileTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition',
        active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
      )}
    >
      {label}
    </button>
  );
}

export default function App() {
  return (
    <ErrorBoundary FallbackComponent={AppErrorFallback}>
      <QuoteACoin />
    </ErrorBoundary>
  );
}
