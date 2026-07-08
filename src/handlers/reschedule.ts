/**
 * Reschedule flow — modify an existing reservation.
 *
 * Flow: booking:reschedule (from main menu or booking confirmation) →
 * enter booking ref → show booking details → pick new date →
 * pick new slot → confirm changes → update booking.
 */

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { now } from "../time/clock.js";
import { getStore } from "../storage/domain.js";
import type { Booking } from "../storage/schemas.js";
import {
  computeAvailableSlots,
  filterAvailableSlots,
  generateReferenceCode,
  loadConfigOrDefault,
  seatGroupForSize,
} from "../services/availability-service.js";
import { notifyOwnerReschedule } from "./notifications.js";

const composer = new Composer<Ctx>();

// ─────────────────────────────────────────────────────────────────────
// Step 1 — Request booking reference
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("booking:reschedule", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "reschedule:ref";

  await ctx.editMessageText(
    "Please enter the reference code from your booking confirmation.\n\n" +
    "Type it below, or tap back to return to the menu.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back", "menu:main")],
      ]),
    },
  );
});

// Handle direct reschedule from booking confirmation (with ref in data)
composer.callbackQuery(/^booking:reschedule:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ref = ctx.callbackQuery.data.split(":")[2];
  const store = getStore();
  const booking = await store.getBooking(ref);

  if (!booking || booking.status !== "confirmed") {
    await ctx.editMessageText(
      "Couldn't find that booking. It may have been cancelled already.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "menu:main")]]) },
    );
    return;
  }

  ctx.session.bookingRef = ref;
  ctx.session.partySize = booking.partySize;
  // Remember original info
  ctx.session.origBookingInfo = `${booking.bookingDate} at ${booking.startTime}`;

  await showRescheduleDateSelection(ctx);
});

// ─────────────────────────────────────────────────────────────────────
// Step 2 — Receive reference code as text
// ─────────────────────────────────────────────────────────────────────

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "reschedule:ref") return next();

  const ref = ctx.message.text.trim().toUpperCase();
  const store = getStore();
  const booking = await store.getBooking(ref);

  if (!booking || booking.status !== "confirmed") {
    ctx.session.step = "reschedule:ref";
    await ctx.reply(
      "Couldn't find a booking with that code. Check the code and try again, or tap back.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back", "menu:main")],
        ]),
      },
    );
    return;
  }

  ctx.session.bookingRef = ref;
  ctx.session.partySize = booking.partySize;
  ctx.session.origBookingInfo = `${booking.bookingDate} at ${booking.startTime}`;

  await showRescheduleDateSelection(ctx);
});

// ─────────────────────────────────────────────────────────────────────
// Step 3 — Pick new date
// ─────────────────────────────────────────────────────────────────────

async function showRescheduleDateSelection(ctx: Ctx): Promise<void> {
  ctx.session.step = "reschedule:date";

  const currentDate = now();
  const rows: ReturnType<typeof inlineButton>[][] = [];
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (let i = 0; i < 14; i++) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${day}`;
    const label = i === 0 ? "📅 Today" : `${dayLabels[d.getDay()]}, ${m}/${day}`;
    rows.push([inlineButton(label, `reschedule:date:${dateStr}`)]);
  }
  rows.push([inlineButton("⬅️ Back", "menu:main")]);

  await ctx.editMessageText(
    `Your current booking is for ${ctx.session.origBookingInfo}.\n\nPick a new date:`,
    { reply_markup: inlineKeyboard(rows) },
  );
}

composer.callbackQuery(/^reschedule:date:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const dateStr = ctx.callbackQuery.data.split(":")[2];
  ctx.session.bookingDate = dateStr;
  ctx.session.step = "reschedule:slot";

  await showRescheduleSlots(ctx, dateStr);
});

// ─────────────────────────────────────────────────────────────────────
// Step 4 — Pick new slot
// ─────────────────────────────────────────────────────────────────────

async function showRescheduleSlots(ctx: Ctx, dateStr: string): Promise<void> {
  const partySize = ctx.session.partySize ?? 2;
  const bookingRef = ctx.session.bookingRef;
  const { config, inventory } = await loadConfigOrDefault();
  const store = getStore();
  const bookings = await store.getBookingsByDate(dateStr);

  const allSlots = computeAvailableSlots(dateStr, partySize, config, inventory, bookings, bookingRef);
  const availableSlots = filterAvailableSlots(allSlots, dateStr);

  if (availableSlots.length === 0) {
    await ctx.editMessageText(
      "No available slots on that date. Pick another date.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Pick another date", "reschedule:date")],
        ]),
      },
    );
    return;
  }

  const rows: ReturnType<typeof inlineButton>[][] = [];
  for (let i = 0; i < availableSlots.length; i += 3) {
    rows.push(
      availableSlots.slice(i, i + 3).map((s) =>
        inlineButton(`🕐 ${s.startTime}`, `reschedule:slot:${s.startTime}`),
      ),
    );
  }
  rows.push([inlineButton("⬅️ Pick another date", "reschedule:date")]);

  await ctx.editMessageText("Pick a new time:", {
    reply_markup: inlineKeyboard(rows),
  });
}

composer.callbackQuery(/^reschedule:date$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showRescheduleDateSelection(ctx);
});

composer.callbackQuery(/^reschedule:slot:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const slotTime = ctx.callbackQuery.data.split(":")[2];
  ctx.session.slotTime = slotTime;
  ctx.session.step = "reschedule:confirm";

  const dateStr = ctx.session.bookingDate ?? "";
  const summary =
    `🔄 Confirm reschedule:\n\n` +
    `From: ${ctx.session.origBookingInfo}\n` +
    `To: 📅 ${dateStr} at 🕐 ${slotTime}`;

  await ctx.editMessageText(summary, {
    reply_markup: inlineKeyboard([
      [inlineButton("✅ Confirm", "reschedule:confirm:yes")],
      [inlineButton("Cancel", "reschedule:confirm:no")],
    ]),
  });
});

// ─────────────────────────────────────────────────────────────────────
// Step 5 — Confirm reschedule
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("reschedule:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();

  const store = getStore();
  const oldRef = ctx.session.bookingRef;
  const oldBooking = oldRef ? await store.getBooking(oldRef) : undefined;

  if (!oldBooking) {
    await ctx.editMessageText(
      "Couldn't find the original booking. It may have been cancelled.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]) },
    );
    return;
  }

  // Cancel old booking
  oldBooking.status = "cancelled";
  await store.saveBooking(oldBooking);

  // Create new booking
  let newRef = generateReferenceCode();
  while (await store.getBooking(newRef)) {
    newRef = generateReferenceCode();
  }

  const partySize = ctx.session.partySize ?? 2;
  const dateStr = ctx.session.bookingDate ?? "";
  const slotTime = ctx.session.slotTime ?? "";
  const { config, inventory } = await loadConfigOrDefault();
  const group = seatGroupForSize(partySize, inventory) ?? "2";

  const startMinutes =
    parseInt(slotTime.split(":")[0], 10) * 60 + parseInt(slotTime.split(":")[1], 10);
  const endMinutes = startMinutes + config.sittingLengthMinutes;
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

  const newBooking: Booking = {
    referenceCode: newRef,
    guestName: oldBooking.guestName,
    guestPhone: oldBooking.guestPhone,
    bookingDate: dateStr,
    startTime: slotTime,
    endTime: endTime,
    partySize,
    seatGroup: group,
    guestUserId: oldBooking.guestUserId,
    status: "confirmed",
    createdAt: Date.now(),
  };

  await store.saveBooking(newBooking);

  ctx.session.step = "idle";

  const confirmMsg =
    `✅ Reservation rescheduled!\n\n` +
    `Old: ${ctx.session.origBookingInfo}\n` +
    `New: 📅 ${dateStr} at 🕐 ${slotTime}\n\n` +
    `New reference: <code>${newRef}</code>`;

  await ctx.editMessageText(confirmMsg, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      [inlineButton("🔄 Reschedule again", `booking:reschedule:${newRef}`)],
      [inlineButton("Cancel", `booking:cancel:${newRef}`)],
      [inlineButton("⬅️ Menu", "menu:main")],
    ]),
  });

  // Notify owner
  await notifyOwnerReschedule(oldBooking, newBooking, ctx);
});

composer.callbackQuery("reschedule:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText("Reschedule cancelled. Your original booking is unchanged.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
  });
});

export default composer;