/**
 * Persistent domain storage — wraps the toolkit's storage adapter for durable data.
 *
 * Owns all booking, configuration, and inventory records. Stores each value under a
 * namespaced key and maintains explicit INDEX records so the code NEVER enumerates
 * keyspace (no KEYS/SCAN — an O(N) production hazard on shared Redis).
 *
 * The underlying adapter is the SAME `StorageAdapter` interface grammY sessions use,
 * backed by the same auto-selected storage (Redis in production, Memory in dev/test)
 * — but a SEPARATE store instance with its own key prefix.
 */

import type { StorageAdapter } from "grammy";
import { MemorySessionStorage } from "../toolkit/session/memory.js";
import { defaultRedisStorage } from "../toolkit/session/redis.js";
import type {
  Booking,
  BookingStatus,
  OwnerConfig,
  RestaurantConfig,
  TableInventory,
} from "./schemas.js";

// ─────────────────────────────────────────────────────────────────────
// Key helpers
// ─────────────────────────────────────────────────────────────────────

function bookingKey(code: string): string {
  return `domain:booking:${code}`;
}
function userIndexKey(userId: number): string {
  return `domain:idx:user:${userId}`;
}
function dateIndexKey(date: string): string {
  return `domain:idx:date:${date}`;
}
function allBookingsKey(): string {
  return "domain:idx:all";
}
function configKey(name: string): string {
  return `domain:config:${name}`;
}

// ─────────────────────────────────────────────────────────────────────
// PersistentStore class
// ─────────────────────────────────────────────────────────────────────

export class PersistentStore {
  constructor(
    private readonly adapter: StorageAdapter<unknown>,
  ) {}

  // ── Booking CRUD ──────────────────────────────────────────────────

  async getBooking(code: string): Promise<Booking | undefined> {
    return (await this.adapter.read(bookingKey(code))) as Booking | undefined;
  }

  async saveBooking(booking: Booking): Promise<void> {
    const code = booking.referenceCode;
    await this.adapter.write(bookingKey(code), booking);
    // Update indexes
    await this.addToSet(allBookingsKey(), code);
    await this.addToSet(userIndexKey(booking.guestUserId), code);
    await this.addToSet(dateIndexKey(booking.bookingDate), code);
  }

  async updateBookingStatus(code: string, status: BookingStatus): Promise<boolean> {
    const booking = await this.getBooking(code);
    if (!booking) return false;
    booking.status = status;
    await this.adapter.write(bookingKey(code), booking);
    return true;
  }

  async getBookingsByUser(userId: number): Promise<Booking[]> {
    const codes = (await this.readSet(userIndexKey(userId))) as string[];
    return this.resolveBookings(codes);
  }

  async getBookingsByDate(date: string): Promise<Booking[]> {
    const codes = (await this.readSet(dateIndexKey(date))) as string[];
    return this.resolveBookings(codes);
  }

  async getAllBookings(): Promise<Booking[]> {
    const codes = (await this.readSet(allBookingsKey())) as string[];
    return this.resolveBookings(codes);
  }

  /** Delete a booking and remove it from all indexes. */
  async deleteBooking(code: string): Promise<boolean> {
    const booking = await this.getBooking(code);
    if (!booking) return false;
    await this.adapter.delete(bookingKey(code));
    await this.removeFromSet(allBookingsKey(), code);
    await this.removeFromSet(userIndexKey(booking.guestUserId), code);
    await this.removeFromSet(dateIndexKey(booking.bookingDate), code);
    return true;
  }

  // ── Configuration ─────────────────────────────────────────────────

  async getRestaurantConfig(): Promise<RestaurantConfig | undefined> {
    return (await this.adapter.read(configKey("restaurant"))) as RestaurantConfig | undefined;
  }

  async saveRestaurantConfig(cfg: RestaurantConfig): Promise<void> {
    await this.adapter.write(configKey("restaurant"), cfg);
  }

  async getTableInventory(): Promise<TableInventory | undefined> {
    return (await this.adapter.read(configKey("inventory"))) as TableInventory | undefined;
  }

  async saveTableInventory(inv: TableInventory): Promise<void> {
    await this.adapter.write(configKey("inventory"), inv);
  }

  async getOwnerConfig(): Promise<OwnerConfig | undefined> {
    return (await this.adapter.read(configKey("owner"))) as OwnerConfig | undefined;
  }

  async saveOwnerConfig(cfg: OwnerConfig): Promise<void> {
    await this.adapter.write(configKey("owner"), cfg);
  }

  // ── Set helpers (indexes as stored JSON arrays) ───────────────────

  private async readSet(key: string): Promise<unknown[]> {
    const raw = await this.adapter.read(key);
    return Array.isArray(raw) ? (raw as unknown[]) : [];
  }

  private async addToSet(key: string, value: string): Promise<void> {
    const set = await this.readSet(key);
    if (!set.includes(value)) {
      set.push(value);
      await this.adapter.write(key, set);
    }
  }

  private async removeFromSet(key: string, value: string): Promise<void> {
    const set = (await this.readSet(key)).filter((v) => v !== value);
    await this.adapter.write(key, set);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async resolveBookings(codes: string[]): Promise<Booking[]> {
    const results: Booking[] = [];
    for (const code of codes) {
      const b = await this.getBooking(code);
      if (b) results.push(b);
    }
    return results;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Factory — resolves the storage adapter the same way createBot does.
// ─────────────────────────────────────────────────────────────────────

let _store: PersistentStore | undefined;

/**
 * Get the singleton persistent store. Created on first call, using the same
 * auto-select logic as createBot (Redis if REDIS_URL is set, else in-memory).
 */
export function getStore(): PersistentStore {
  if (_store) return _store;
  const REDIS_URL = process.env.REDIS_URL;
  const adapter: StorageAdapter<unknown> = REDIS_URL
    ? (defaultRedisStorage(REDIS_URL) as unknown as StorageAdapter<unknown>)
    : new MemorySessionStorage<unknown>();
  _store = new PersistentStore(adapter);
  return _store;
}

/**
 * Replace the store with a test double. Returns the previous store so the
 * caller can restore it.
 */
export function setStore(store: PersistentStore): void {
  _store = store;
}

/** Clear the singleton (for test cleanup). */
export function resetStore(): void {
  _store = undefined;
}
