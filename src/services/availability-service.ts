/**
 * Availability service — computes available time slots based on restaurant
 * configuration, table inventory, and existing bookings.
 *
 * Uses an injectable clock (now()) for all time-based decisions so tests can
 * drive time behavior deterministically.
 */

import { now } from "../time/clock.js";
import { getStore } from "../storage/domain.js";
import type { AvailabilitySlot, Booking, RestaurantConfig, TableInventory } from "../storage/schemas.js";

// ─────────────────────────────────────────────────────────────────────
// Default config (used when restaurant hasn't configured anything yet)
// ─────────────────────────────────────────────────────────────────────

export function defaultConfig(): RestaurantConfig {
  return {
    weekdayOpeningHours: {
      0: { open: "10:00", close: "22:00" }, // Sun
      1: { open: "09:00", close: "23:00" }, // Mon
      2: { open: "09:00", close: "23:00" }, // Tue
      3: { open: "09:00", close: "23:00" }, // Wed
      4: { open: "09:00", close: "23:00" }, // Thu
      5: { open: "09:00", close: "00:00" }, // Fri
      6: { open: "10:00", close: "00:00" }, // Sat
    },
    sittingLengthMinutes: 90,
    reminderLeadTimeHours: 2,
    timezone: "UTC",
  };
}

export function defaultInventory(): TableInventory {
  return {
    seatCapacityGroups: { "2": 4, "4": 3, "6": 2, "8+": 1 },
    totalTables: 10,
    totalSeats: 40,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Parsing helpers
// ─────────────────────────────────────────────────────────────────────

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────
// Availability computation
// ─────────────────────────────────────────────────────────────────────

/**
 * Get the seat group label that fits a party size.
 */
export function seatGroupForSize(partySize: number, inventory: TableInventory): string | undefined {
  const labels = Object.keys(inventory.seatCapacityGroups)
    .map((l) => ({ label: l, capacity: parsePartyCap(l) }))
    .sort((a, b) => a.capacity - b.capacity);

  for (const g of labels) {
    if (g.capacity >= partySize) return g.label;
  }
  // If party exceeds all groups, return the largest group
  return labels.length > 0 ? labels[labels.length - 1].label : undefined;
}

function parsePartyCap(label: string): number {
  // "2" → 2, "4" → 4, "8+" → 8
  return parseInt(label.replace("+", ""), 10) || parseInt(label, 10) || 2;
}

/**
 * Compute available time slots for a given date and party size.
 * Returns slots from opening to closing at 15-minute granularity.
 */
export function computeAvailableSlots(
  dateStr: string,
  partySize: number,
  config: RestaurantConfig,
  inventory: TableInventory,
  bookings: Booking[],
  excludeCode?: string,
): AvailabilitySlot[] {
  const date = new Date(dateStr + "T12:00:00Z"); // midday to get day-of-week
  const dow = date.getUTCDay();
  const dayConfig = config.weekdayOpeningHours[dow];
  if (!dayConfig) return [];

  const openMin = parseTime(dayConfig.open);
  const closeMin = parseTime(dayConfig.close);
  const sittingLen = config.sittingLengthMinutes;
  const granularity = 15;

  // Get seat group for party size
  const group = seatGroupForSize(partySize, inventory);
  if (!group) return [];

  const tablesInGroup = inventory.seatCapacityGroups[group] ?? 0;
  if (tablesInGroup === 0) return [];

  // Count bookings per slot
  const activeBookings = bookings.filter(
    (b) =>
      b.status === "confirmed" &&
      b.bookingDate === dateStr &&
      b.seatGroup === group &&
      b.referenceCode !== excludeCode,
  );

  const slots: AvailabilitySlot[] = [];
  for (let m = openMin; m + sittingLen <= closeMin; m += granularity) {
    const start = formatTime(m);
    const end = formatTime(m + sittingLen);

    // Count how many bookings overlap this slot
    const overlapping = activeBookings.filter((b) => {
      const bStart = parseTime(b.startTime);
      const bEnd = parseTime(b.endTime);
      // Overlap: slot starts before booking ends AND slot ends after booking starts
      return m < bEnd && m + sittingLen > bStart;
    }).length;

    const remaining = tablesInGroup - overlapping;
    slots.push({
      startTime: start,
      endTime: end,
      available: remaining > 0,
      remainingCapacity: remaining,
    });
  }

  return slots;
}

/**
 * Filter slots to only available ones, and optionally remove slots in the past
 * (for today's date).
 */
export function filterAvailableSlots(
  slots: AvailabilitySlot[],
  dateStr: string,
): AvailabilitySlot[] {
  const currentTime = now();
  const todayStr = `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, "0")}-${String(currentTime.getDate()).padStart(2, "0")}`;

  return slots.filter((s) => {
    if (!s.available) return false;
    // If the date is today, filter out past slots
    if (dateStr === todayStr) {
      const slotMinutes = parseTime(s.startTime);
      const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
      if (slotMinutes <= currentMinutes) return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Reference code generation
// ─────────────────────────────────────────────────────────────────────

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion

export function generateReferenceCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

// ─────────────────────────────────────────────────────────────────────
// Convenience: load config + inventory (with defaults)
// ─────────────────────────────────────────────────────────────────────

export async function loadConfigOrDefault(): Promise<{
  config: RestaurantConfig;
  inventory: TableInventory;
}> {
  const store = getStore();
  const config = (await store.getRestaurantConfig()) ?? defaultConfig();
  const inventory = (await store.getTableInventory()) ?? defaultInventory();
  return { config, inventory };
}
