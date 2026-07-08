/**
 * Booking flow handler — party size → date → time → name → phone → confirm.
 *
 * Flow: booking:start (from main menu) → size selection → date selection →
 * slot selection → name → phone → confirmation → complete.
 */

import { Composer, InlineKeyboard } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { now } from "../time/clock.js";
import { getStore } from "../storage/domain.js";
import type { Booking, BookingStatus } from "../storage/schemas.js";
import {
  computeAvailableSlots,
  filterAvailableSlots,
  generateReferenceCode,
  loadConfigOrDefault,
  seatGroupForSize,
} from "../services/availability-service.js";
import { notifyOwnerNewBooking } from "./notifications.js";

const composer = new Composer<Ctx>();

// ─────────────────────────────────────────────────────────────────────
// Step 1 — Party size selection
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("booking:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "booking:size";

  const sizes = [1, 2, 3, 4, 5, 6, 7, "8+"];
  const rows: ReturnType<typeof inlineButton>[][] = [];
  // 4 per row
  for (let i = 0; i < sizes.length; i += 4) {
    rows.push(
      sizes.slice(i, i + 4).map((s) =>
        inlineButton(`👤 ${s}`, `booking:size:${s}`),
      ),
    );
  }
  rows.push([inlineButton("⬅️ Back", "menu:main")]);

  await ctx.editMessageText("How many guests will be dining?", {
    reply_markup: inlineKeyboard(rows),
  });
});

// ─────────────────────────────────────────────────────────────────────
// Step 2 — Party size chosen → date selection
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery(/^booking:size:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const raw = ctx.callbackQuery.data.split(":")[2];
  const size = raw === "8+" ? 8 : parseInt(raw, 10);
  ctx.session.partySize = size;
  ctx.session.step = "booking:date";

  await showDateSelection(ctx);
});

// ─────────────────────────────────────────────────────────────────────
// Step 3 — Date selection
// ─────────────────────────────────────────────────────────────────────

async function showDateSelection(ctx: Ctx): Promise<void> {
  const currentDate = now();
  const rows: ReturnType<typeof inlineButton>[][] = [];
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Show next 14 days as date buttons
  for (let i = 0; i < 14; i++) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${day}`;
    const label = i === 0 ? "📅 Today" : `${dayLabels[d.getDay()]}, ${m}/${day}`;
    rows.push([inlineButton(label, `booking:date:${dateStr}`)]);
  }
  rows.push([inlineButton("⬅️ Back", "booking:start")]);

  await ctx.editMessageText("Pick a date for your reservation:", {
    reply_markup: inlineKeyboard(rows),
  });
}

composer.callbackQuery(/^booking:date:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const dateStr = ctx.callbackQuery.data.split(":")[2];
  ctx.session.bookingDate = dateStr;
  ctx.session.step = "booking:slot";

  await showSlotSelection(ctx, dateStr);
});

// ─────────────────────────────────────────────────────────────────────
// Step 4 — Slot selection
// ─────────────────────────────────────────────────────────────────────

async function showSlotSelection(ctx: Ctx, dateStr: string): Promise<void> {
  const partySize = ctx.session.partySize ?? 2;
  const { config, inventory } = await loadConfigOrDefault();
  const store = getStore();
  const bookings = await store.getBookingsByDate(dateStr);

  const allSlots = computeAvailableSlots(dateStr, partySize, config, inventory, bookings);
  const availableSlots = filterAvailableSlots(allSlots, dateStr);

  if (availableSlots.length === 0) {
    await ctx.editMessageText(
      "Sorry, no available slots on that date. Pick another date.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Pick another date", `booking:date`)],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const rows: ReturnType<typeof inlineButton>[][] = [];
  // 3 slots per row
  for (let i = 0; i < availableSlots.length; i += 3) {
    rows.push(
      availableSlots.slice(i, i + 3).map((s) =>
        inlineButton(`🕐 ${s.startTime}`, `booking:slot:${s.startTime}`),
      ),
    );
  }
  rows.push([inlineButton("⬅️ Pick another date", `booking:date`)]);

  await ctx.editMessageText(
    `Available times on ${dateStr} for ${partySize} guest${partySize > 1 ? "s" : ""}:`,
    { reply_markup: inlineKeyboard(rows) },
  );
}

composer.callbackQuery(/^booking:date$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "booking:date";
  await showDateSelection(ctx);
});

composer.callbackQuery(/^booking:slot:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const slotTime = ctx.callbackQuery.data.split(":")[2];
  ctx.session.slotTime = slotTime;
  ctx.session.step = "booking:name";

  await ctx.editMessageText(
    "What name should the reservation be under? (or tap Skip)",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⏭ Skip", "booking:name:skip")],
        [inlineButton("⬅️ Back", `booking:date:${ctx.session.bookingDate}`)],
      ]),
    },
  );
});

// ─────────────────────────────────────────────────────────────────────
// Step 5 — Name input
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("booking:name:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.guestName = "";
  ctx.session.step = "booking:phone";
  await ctx.editMessageText(
    "A phone number for contact tracing? (or tap Skip)",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⏭ Skip", "booking:phone:skip")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "booking:name") return next();

  const name = ctx.message.text.trim();
  ctx.session.guestName = name;
  ctx.session.step = "booking:phone";

  await ctx.reply(
    "Got it. A phone number for contact tracing? (or tap Skip)",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⏭ Skip", "booking:phone:skip")],
      ]),
    },
  );
});

// ─────────────────────────────────────────────────────────────────────
// Step 6 — Phone input
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("booking:phone:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.guestPhone = "";
  await showConfirmation(ctx);
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "booking:phone") return next();

  const phone = ctx.message.text.trim();
  ctx.session.guestPhone = phone;
  await showConfirmation(ctx);
});

// ─────────────────────────────────────────────────────────────────────
// Step 7 — Confirmation
// ─────────────────────────────────────────────────────────────────────

async function showConfirmation(ctx: Ctx): Promise<void> {
  ctx.session.step = "booking:confirm";

  const partySize = ctx.session.partySize ?? 2;
  const dateStr = ctx.session.bookingDate ?? "";
  const slotTime = ctx.session.slotTime ?? "";
  const guestName = ctx.session.guestName || "(no name)";
  const guestPhone = ctx.session.guestPhone || "(no phone)";

  const summary =
    `📋 Please confirm your reservation:\n\n` +
    `👤 ${partySize} guest${partySize > 1 ? "s" : ""}\n` +
    `📅 ${dateStr}\n` +
    `🕐 ${slotTime}\n` +
    `Name: ${guestName}\n` +
    `Phone: ${guestPhone}`;

  await ctx.editMessageText(summary, {
    reply_markup: inlineKeyboard([
      [inlineButton("✅ Confirm", "booking:confirm:yes")],
      [inlineButton("Cancel", "booking:confirm:no")],
    ]),
  });
}

composer.callbackQuery("booking:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();

  // Generate unique reference code
  let referenceCode = generateReferenceCode();
  const store = getStore();
  // Ensure uniqueness
  while (await store.getBooking(referenceCode)) {
    referenceCode = generateReferenceCode();
  }

  const partySize = ctx.session.partySize ?? 2;
  const dateStr = ctx.session.bookingDate ?? "";
  const slotTime = ctx.session.slotTime ?? "";
  const { config, inventory } = await loadConfigOrDefault();
  const group = seatGroupForSize(partySize, inventory) ?? "2";

  // Compute end time
  const startMinutes =
    parseInt(slotTime.split(":")[0], 10) * 60 + parseInt(slotTime.split(":")[1], 10);
  const endMinutes = startMinutes + config.sittingLengthMinutes;
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

  const booking: Booking = {
    referenceCode,
    guestName: ctx.session.guestName ?? "",
    guestPhone: ctx.session.guestPhone ?? "",
    bookingDate: dateStr,
    startTime: slotTime,
    endTime: endTime,
    partySize,
    seatGroup: group,
    guestUserId: ctx.from?.id ?? 0,
    status: "confirmed",
    createdAt: Date.now(),
  };

  await store.saveBooking(booking);

  // Reset session
  ctx.session.step = "idle";

  // Send confirmation
  const confirmMsg =
    `✅ Reservation confirmed!\n\n` +
    `Reference: <code>${referenceCode}</code>\n` +
    `📅 ${dateStr} at ${slotTime}\n` +
    `👤 ${partySize} guest${partySize > 1 ? "s" : ""}\n\n` +
    `Use the buttons below to reschedule or cancel.`;

  await ctx.editMessageText(confirmMsg, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      [inlineButton("🔄 Reschedule", `booking:reschedule:${referenceCode}`)],
      [inlineButton("Cancel", `booking:cancel:${referenceCode}`)],
      [inlineButton("⬅️ Menu", "menu:main")],
    ]),
  });

  // Notify owner
  await notifyOwnerNewBooking(booking, ctx);
});

composer.callbackQuery("booking:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText("Booking cancelled. Tap /start to begin again.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
  });
});

export default composer;