/**
 * Notification utilities — sending alerts to owners and reminders to guests.
 *
 * IMPORTANT: A Telegram bot can ONLY message users who have already started it.
 * Sending to a stranger's user ID returns 403. All owner DMs must be wrapped
 * to tolerate 403 without aborting.
 */

import { Composer } from "grammy";
import { getStore } from "../storage/domain.js";
import type { Booking } from "../storage/schemas.js";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { loadConfigOrDefault } from "../services/availability-service.js";

// Empty composer so buildBot auto-loader doesn't reject this file.
// This module exports notification helpers used by other handlers.
const composer = new Composer<Ctx>();
export default composer;

// ─────────────────────────────────────────────────────────────────────
// Owner notification helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Send a new-booking alert to all owners. Best-effort — tolerates 403.
 */
export async function notifyOwnerNewBooking(
  booking: Booking,
  ctx: Ctx,
): Promise<void> {
  const store = getStore();
  const ownerCfg = await store.getOwnerConfig();
  if (!ownerCfg || !ownerCfg.ownerIds.length) return;

  const msg =
    `🆕 New booking!\n\n` +
    `Ref: <code>${booking.referenceCode}</code>\n` +
    `👤 ${booking.partySize} guests\n` +
    `📅 ${booking.bookingDate} at ${booking.startTime}\n` +
    `Name: ${booking.guestName || "(no name)"}\n` +
    `Phone: ${booking.guestPhone || "(no phone)"}\n` +
    `Status: confirmed`;

  for (const ownerId of ownerCfg.ownerIds) {
    try {
      await ctx.api.sendMessage(ownerId, msg, {
        parse_mode: "HTML",
        reply_markup: inlineKeyboard([
          [inlineButton("📋 Today", "owner:today")],
        ]),
      });
    } catch {
      // User hasn't started the bot or blocked it — skip silently
    }
  }
}

/**
 * Send a cancellation alert to all owners. Best-effort.
 */
export async function notifyOwnerCancellation(booking: Booking, ctx: Ctx): Promise<void> {
  const store = getStore();
  const ownerCfg = await store.getOwnerConfig();
  if (!ownerCfg || !ownerCfg.ownerIds.length) return;

  const msg =
    `❌ Booking cancelled\n\n` +
    `Ref: <code>${booking.referenceCode}</code>\n` +
    `📅 ${booking.bookingDate} at ${booking.startTime}\n` +
    `👤 ${booking.partySize} guests`;

  for (const ownerId of ownerCfg.ownerIds) {
    try {
      await ctx.api.sendMessage(ownerId, msg, {
        parse_mode: "HTML",
      });
    } catch {
      // skip
    }
  }
}

/**
 * Send a reschedule alert to all owners. Best-effort.
 */
export async function notifyOwnerReschedule(
  oldBooking: Booking | undefined,
  newBooking: Booking,
  ctx: Ctx,
): Promise<void> {
  const store = getStore();
  const ownerCfg = await store.getOwnerConfig();
  if (!ownerCfg || !ownerCfg.ownerIds.length) return;

  const msg =
    `🔄 Booking rescheduled\n\n` +
    `Ref: <code>${newBooking.referenceCode}</code>\n` +
    `📅 ${newBooking.bookingDate} at ${newBooking.startTime}\n` +
    `👤 ${newBooking.partySize} guests` +
    (oldBooking
      ? `\nWas: ${oldBooking.startTime} on ${oldBooking.bookingDate}`
      : "");

  for (const ownerId of ownerCfg.ownerIds) {
    try {
      await ctx.api.sendMessage(ownerId, msg, {
        parse_mode: "HTML",
      });
    } catch {
      // skip
    }
  }
}

/**
 * Send a no-show alert to all owners. Best-effort.
 */
export async function notifyOwnerNoShow(booking: Booking, ctx: Ctx): Promise<void> {
  const store = getStore();
  const ownerCfg = await store.getOwnerConfig();
  if (!ownerCfg || !ownerCfg.ownerIds.length) return;

  const msg =
    `🚫 No-show marked\n\n` +
    `Ref: <code>${booking.referenceCode}</code>\n` +
    `📅 ${booking.bookingDate} at ${booking.startTime}\n` +
    `👤 ${booking.partySize} guests`;

  for (const ownerId of ownerCfg.ownerIds) {
    try {
      await ctx.api.sendMessage(ownerId, msg, {
        parse_mode: "HTML",
      });
    } catch {
      // skip
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Guest reminder — send a reminder to a guest about their upcoming booking
// ─────────────────────────────────────────────────────────────────────

/**
 * Send a reminder to a guest about their upcoming booking. Best-effort —
 * tolerates 403 if the guest hasn't started the bot.
 */
export async function sendGuestReminder(
  booking: Booking,
  ctx: Ctx,
): Promise<void> {
  const msg =
    `⏰ Reminder! You have a reservation today.\n\n` +
    `📅 ${booking.bookingDate} at ${booking.startTime}\n` +
    `👤 ${booking.partySize} guest${booking.partySize > 1 ? "s" : ""}\n` +
    `Ref: <code>${booking.referenceCode}</code>\n\n` +
    `Need to change? Use the buttons below.`;

  try {
    await ctx.api.sendMessage(booking.guestUserId, msg, {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("🔄 Reschedule", `booking:reschedule:${booking.referenceCode}`)],
        [inlineButton("Cancel", `booking:cancel:${booking.referenceCode}`)],
      ]),
    });
  } catch {
    // Guest hasn't started bot or blocked — skip silently
  }
}