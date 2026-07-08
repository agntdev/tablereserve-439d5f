/**
 * Durable domain-data types for the TableReserve bot.
 *
 * These types describe data that MUST survive a restart — stored in the
 * toolkit's persistent storage (Redis-backed in production, in-memory in
 * dev/test). NEVER store this in session or module-level variables.
 */

// ─────────────────────────────────────────────────────────────────────
// Booking status
// ─────────────────────────────────────────────────────────────────────

export type BookingStatus = "confirmed" | "cancelled" | "no_show" | "completed";

// ─────────────────────────────────────────────────────────────────────
// Booking
// ─────────────────────────────────────────────────────────────────────

export interface Booking {
  /** Unique reference code (human-readable, e.g. "ABC1D"). */
  referenceCode: string;
  /** Guest's name (optional — can be empty string). */
  guestName: string;
  /** Guest's phone number (optional). Stored; only visible to owner. */
  guestPhone: string;
  /** Date of the booking, stored as "YYYY-MM-DD". */
  bookingDate: string;
  /** Start time as "HH:mm" (24h). */
  startTime: string;
  /** End time as "HH:mm" (24h), computed from start + sitting length. */
  endTime: string;
  /** Number of guests. */
  partySize: number;
  /** Capacity group label used (e.g. "2", "4", "6", "8+"). */
  seatGroup: string;
  /** Telegram user ID of the guest who booked. */
  guestUserId: number;
  /** Current status. */
  status: BookingStatus;
  /** Unix timestamp (ms) when the booking was created. */
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────────────
// Restaurant configuration (persistent)
// ─────────────────────────────────────────────────────────────────────

export interface RestaurantConfig {
  /** Opening hours per weekday. Keys 0 (Sun) .. 6 (Sat). */
  weekdayOpeningHours: Record<number, { open: string; close: string }>;
  /** Default sitting length in minutes. */
  sittingLengthMinutes: number;
  /** Reminder lead time in hours before the booking. */
  reminderLeadTimeHours: number;
  /** IANA timezone string, e.g. "America/New_York". */
  timezone: string;
}

// ─────────────────────────────────────────────────────────────────────
// Table inventory (persistent)
// ─────────────────────────────────────────────────────────────────────

export interface TableInventory {
  /** Capacity groups: key = label (e.g. "2", "4", "6", "8+"), value = count of tables. */
  seatCapacityGroups: Record<string, number>;
  /** Total number of tables across all groups. */
  totalTables: number;
  /** Total number of seats across all groups. */
  totalSeats: number;
}

// ─────────────────────────────────────────────────────────────────────
// Owner configuration (persistent)
// ─────────────────────────────────────────────────────────────────────

export interface OwnerConfig {
  /** Telegram user IDs authorized as owner. */
  ownerIds: number[];
}

// ─────────────────────────────────────────────────────────────────────
// Availability slot (computed at query time — not stored persistently)
// ─────────────────────────────────────────────────────────────────────

export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  available: boolean;
  remainingCapacity: number;
}