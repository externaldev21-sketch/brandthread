/**
 * Manufacturer Hub — TypeScript data models
 */

// ─── Enums / unions ───────────────────────────────────────────────────────────

export type ManufacturerRelationshipStatus =
  | 'saved' | 'invited' | 'connected' | 'active' | 'paused' | 'archived';

export type QuoteRequestStatus =
  | 'draft' | 'sent' | 'viewed' | 'questions_asked' | 'quote_received'
  | 'counteroffer_sent' | 'accepted' | 'declined' | 'expired' | 'cancelled';

export type SampleStatus =
  | 'requested' | 'pending_payment' | 'awaiting_payment' | 'paid' | 'in_development'
  | 'revision_requested' | 'shipped' | 'delivered' | 'review_needed'
  | 'approved' | 'rejected' | 'cancelled';

export type ProductionStageKey =
  | 'quote_accepted' | 'deposit_pending' | 'deposit_paid' | 'materials_sourcing'
  | 'cutting' | 'printing' | 'sewing' | 'finishing' | 'quality_control'
  | 'packaging' | 'ready_to_ship' | 'shipped' | 'delivered';

export type ProductionStatus =
  | 'pending' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export type IssueType =
  | 'delay' | 'quality_issue' | 'quantity_mismatch' | 'material_issue'
  | 'color_mismatch' | 'print_issue' | 'packaging_issue' | 'shipping_issue'
  | 'payment_issue' | 'other';

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueStatus = 'open' | 'in_review' | 'resolved' | 'closed';

export type QcResult = 'pass' | 'fail' | 'needs_review';

export type PaymentType =
  | 'sample' | 'deposit' | 'milestone' | 'final' | 'shipping';

export type PaymentStatus = 'pending' | 'due' | 'paid' | 'overdue' | 'waived';

export type FileCategory =
  | 'tech_pack' | 'design' | 'measurement' | 'quote' | 'invoice'
  | 'sample_photo' | 'revision_note' | 'production_image' | 'qc_report' | 'shipping_doc';

export type MessageSender = 'seller' | 'manufacturer' | 'system';

// ─── Manufacturer ─────────────────────────────────────────────────────────────

export interface ManufacturerCertification {
  id: string;
  name: string;   // e.g. "GOTS", "OEKO-TEX", "ISO 9001"
  issuer?: string;
  validUntil?: string;
}

export interface ManufacturerCapability {
  id: string;
  category: string;   // e.g. "Cut & Sew", "Embroidery"
  materials: string[];
  printMethods?: string[];
}

export interface ManufacturerReview {
  id: string;
  sellerId: string;
  sellerName: string;
  rating: number;          // 1-5
  qualityRating: number;
  communicationRating: number;
  deliveryRating: number;
  comment: string;
  createdAt: string;
}

export interface Manufacturer {
  id: string;
  name: string;
  country: string;
  city: string;
  description: string;
  profileImageUri?: string;
  galleryUris: string[];
  yearsInBusiness: number;
  teamSize: string;         // e.g. "50–200"
  productionCapacity: string; // e.g. "5,000 units/month"
  specialties: string[];
  categories: string[];
  capabilities: ManufacturerCapability[];
  certifications: ManufacturerCertification[];
  materials: string[];
  moq: number;
  samplePriceMinCents: number;
  samplePriceMaxCents: number;
  unitPriceMinCents: number;
  unitPriceMaxCents: number;
  leadTimeDays: number;
  responseTimeHours: number;
  rating: number;
  reviewCount: number;
  isVerified: boolean;
  shippingRegions: string[];
  website?: string;
  email?: string;
  phone?: string;
  createdAt: string;
}

// ─── Relationship ─────────────────────────────────────────────────────────────

export interface ManufacturerRelationship {
  id: string;
  sellerId: string;
  manufacturerId: string;
  status: ManufacturerRelationshipStatus;
  activeProductIds: string[];
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadCount: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Invitation ───────────────────────────────────────────────────────────────

export interface ManufacturerInvitation {
  id: string;
  sellerId: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  country?: string;
  website?: string;
  notes?: string;
  productIds: string[];
  inviteLink?: string;
  status: 'pending' | 'sent' | 'accepted' | 'declined';
  createdAt: string;
}

// ─── Quote Request ────────────────────────────────────────────────────────────

export interface QuoteRequest {
  id: string;
  sellerId: string;
  manufacturerId: string;
  productId?: string;
  productName: string;
  status: QuoteRequestStatus;
  // Step 2: production details
  quantity: number;
  targetUnitPriceCents?: number;
  neededByDate?: string;
  sampleRequired: boolean;
  productionType?: string;
  packagingRequirements?: string;
  shippingDestination?: string;
  // Step 3: materials
  materials: string[];
  colorways: string[];
  sizes: string[];
  variantQuantities: Record<string, number>;
  printMethod?: string;
  hasEmbroidery: boolean;
  hasWash: boolean;
  hasHardware: boolean;
  hasLabels: boolean;
  customPackaging: boolean;
  // Step 4: files
  fileIds: string[];
  notes?: string;
  // Meta
  currentStep: number;
  isDraft: boolean;
  submittedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Quote (response from manufacturer) ──────────────────────────────────────

export interface QuoteLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface Quote {
  id: string;
  quoteRequestId: string;
  manufacturerId: string;
  sellerId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  sampleCostCents: number;
  setupCostCents: number;
  packagingCostCents: number;
  shippingEstimateCents: number;
  totalEstimateCents: number;
  moq: number;
  leadTimeDays: number;
  productionDays: number;
  paymentTerms: string;
  validUntil: string;
  status: QuoteRequestStatus;
  lineItems: QuoteLineItem[];
  notes?: string;
  receivedAt: string;
  updatedAt: string;
}

export interface Counteroffer {
  id: string;
  quoteId: string;
  sellerId: string;
  desiredUnitPriceCents?: number;
  desiredMoq?: number;
  desiredProductionDays?: number;
  desiredPaymentTerms?: string;
  notes?: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

// ─── Sample ───────────────────────────────────────────────────────────────────

export interface SampleRevision {
  id: string;
  sampleId: string;
  sellerId: string;
  title: string;
  notes: string;
  priority: 'low' | 'medium' | 'high';
  deadline?: string;
  imageUris: string[];
  fileIds: string[];
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
}

export interface SampleReview {
  id: string;
  sampleId: string;
  sellerId: string;
  decision: 'approved' | 'revision_requested' | 'rejected';
  overallRating: number;
  qualityRating: number;
  fitRating: number;
  materialRating: number;
  colorRating: number;
  printRating: number;
  packagingRating: number;
  notes: string;
  imageUris: string[];
  createdAt: string;
}

export interface Sample {
  id: string;
  sellerId: string;
  manufacturerId: string;
  quoteId?: string;
  productId?: string;
  productName: string;
  type: 'proto' | 'size_set' | 'pre_production' | 'production';
  status: SampleStatus;
  costCents: number;
  paymentStatus: PaymentStatus;
  estimatedCompletionDate?: string;
  shippedDate?: string;
  deliveredDate?: string;
  trackingNumber?: string;
  trackingCarrier?: string;
  imageUris: string[];
  fileIds: string[];
  revisions: SampleRevision[];
  review?: SampleReview;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** Server optimistic-concurrency revision for seller sample decisions/uploads. */
  revision: number;
  threadId?: string;
  orderType?: 'sample' | 'bulk';
  manufacturerName?: string;
  manufacturerCountry?: string;
  /** Server-confirmed Connect readiness; payment must not start unless true. */
  manufacturerPayoutReady?: boolean;
  manufacturerHasStripe?: boolean;
  quantity?: number;
}

export interface ManufacturerThread {
  id: string;
  manufacturerId: string;
  manufacturerName: string;
  manufacturerCountry?: string | null;
  manufacturerPhoto?: string | null;
  subject: string;
  lastMessage?: string | null;
  lastMessageAt: string;
  unreadCount: number;
  createdAt: string;
}

// ─── Production ───────────────────────────────────────────────────────────────

export interface ProductionStage {
  key: ProductionStageKey;
  label: string;
  completedAt?: string;
  notes?: string;
  imageUris?: string[];
}

export interface QualityControlCheck {
  id: string;
  category: string;   // 'measurements', 'stitching', 'fabric', etc.
  label: string;
  result?: QcResult;
  notes?: string;
  imageUris: string[];
}

export interface ProductionIssue {
  id: string;
  productionOrderId: string;
  type: IssueType;
  severity: IssueSeverity;
  status: IssueStatus;
  title: string;
  description: string;
  imageUris: string[];
  fileIds: string[];
  requestedResolution?: string;
  resolvedAt?: string;
  resolvedNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionUpdate {
  id: string;
  productionOrderId: string;
  stage?: ProductionStageKey;
  message: string;
  imageUris: string[];
  fileIds: string[];
  isDelayNotice: boolean;
  newEstimatedDate?: string;
  createdAt: string;
  createdBy: 'seller' | 'manufacturer' | 'system';
}

export interface ManufacturerPaymentRecord {
  id: string;
  productionOrderId: string;
  type: PaymentType;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  dueDate?: string;
  paidDate?: string;
  notes?: string;
  createdAt: string;
}

export interface ProductionOrder {
  id: string;
  sellerId: string;
  manufacturerId: string;
  quoteId: string;
  sampleId?: string;
  productId?: string;
  productName: string;
  status: ProductionStatus;
  quantity: number;
  variants: Record<string, number>;
  totalCostCents: number;
  depositAmountCents: number;
  remainingBalanceCents: number;
  startDate?: string;
  estimatedCompletionDate?: string;
  actualCompletionDate?: string;
  currentStage: ProductionStageKey;
  stages: ProductionStage[];
  updates: ProductionUpdate[];
  qcChecklist: QualityControlCheck[];
  issues: ProductionIssue[];
  payments: ManufacturerPaymentRecord[];
  fileIds: string[];
  trackingNumber?: string;
  trackingCarrier?: string;
  shippingAddress?: string;
  deliveredDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** Server optimistic-concurrency revision for order mutations. */
  revision: number;
  threadId?: string;
  manufacturerName?: string;
  /** Server-confirmed Connect readiness; payment must not start unless true. */
  manufacturerPayoutReady?: boolean;
  manufacturerHasStripe?: boolean;
  walletPaymentState?: 'pending' | 'processing' | 'paid' | 'failed' | null;
}

// ─── Messaging ────────────────────────────────────────────────────────────────

export interface ManufacturerMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: MessageSender;
  text: string;
  imageUris: string[];
  fileIds: string[];
  attachmentType?: 'product' | 'quote' | 'sample' | 'production';
  attachmentId?: string;
  attachmentLabel?: string;
  isInternalNote: boolean;
  readAt?: string;
  createdAt: string;
}

export interface ManufacturerConversation {
  id: string;
  sellerId: string;
  manufacturerId: string;
  manufacturerName: string;
  productId?: string;
  quoteId?: string;
  sampleId?: string;
  productionId?: string;
  contextLabel?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  messages: ManufacturerMessage[];
  createdAt: string;
  updatedAt: string;
}

// ─── Files ────────────────────────────────────────────────────────────────────

export interface ManufacturerFile {
  id: string;
  sellerId: string;
  name: string;
  category: FileCategory;
  uri: string;
  mimeType: string;
  sizeBytes?: number;
  manufacturerId?: string;
  productId?: string;
  quoteId?: string;
  sampleId?: string;
  productionId?: string;
  createdAt: string;
}

// ─── Price Card ───────────────────────────────────────────────────────────────

export interface ManufacturerPriceCard {
  id: string;
  manufacturerId: string;
  productId?: string;
  quoteId?: string;
  productName: string;
  quantityBreak: number;
  unitPriceCents: number;
  samplePriceCents: number;
  setupCostCents: number;
  packagingCostCents: number;
  shippingEstimateCents: number;
  leadTimeDays: number;
  validUntil?: string;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PRODUCTION_STAGES: { key: ProductionStageKey; label: string }[] = [
  { key: 'quote_accepted',    label: 'Quote Accepted' },
  { key: 'deposit_pending',   label: 'Deposit Pending' },
  { key: 'deposit_paid',      label: 'Deposit Paid' },
  { key: 'materials_sourcing',label: 'Materials Sourcing' },
  { key: 'cutting',           label: 'Cutting' },
  { key: 'printing',          label: 'Printing / Embroidery' },
  { key: 'sewing',            label: 'Sewing' },
  { key: 'finishing',         label: 'Finishing' },
  { key: 'quality_control',   label: 'Quality Control' },
  { key: 'packaging',         label: 'Packaging' },
  { key: 'ready_to_ship',     label: 'Ready to Ship' },
  { key: 'shipped',           label: 'Shipped' },
  { key: 'delivered',         label: 'Delivered' },
];

export const QC_CATEGORIES = [
  'Measurements', 'Stitching', 'Fabric', 'Color', 'Print',
  'Embroidery', 'Hardware', 'Labels', 'Packaging', 'Quantity', 'Damage check',
];

export const ISSUE_TYPES: { key: IssueType; label: string }[] = [
  { key: 'delay',             label: 'Delay' },
  { key: 'quality_issue',     label: 'Quality Issue' },
  { key: 'quantity_mismatch', label: 'Quantity Mismatch' },
  { key: 'material_issue',    label: 'Material Issue' },
  { key: 'color_mismatch',    label: 'Color Mismatch' },
  { key: 'print_issue',       label: 'Print Issue' },
  { key: 'packaging_issue',   label: 'Packaging Issue' },
  { key: 'shipping_issue',    label: 'Shipping Issue' },
  { key: 'payment_issue',     label: 'Payment Issue' },
  { key: 'other',             label: 'Other' },
];
