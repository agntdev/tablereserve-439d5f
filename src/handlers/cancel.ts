/**
 * Cancel flow — cancel an existing reservation.
 *
 * Flow: booking:cancel (from main menu) → enter booking ref →
 * confirm cancellation → mark booking as cancelled → notify owner.
 */

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getStore } from "../storage/domain.js";
import { notifyOwnerCancellation } from "./notifications.js";

const composer = new Composer<Ctx>();

// ─────────────────────────────────────────────────────────────────────
// Step 1 — Request booking reference
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("booking:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "cancel:ref";

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

// Handle direct cancel from booking confirmation (with ref in data)
composer.callbackQuery(/^booking:cancel:(.+)$/, async (ctx) => {
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
  await showCancelConfirm(ctx, booking);
});

// ─────────────────────────────────────────────────────────────────────
// Step 2 — Receive reference code as text
// ─────────────────────────────────────────────────────────────────────

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "cancel:ref") return next();

  const ref = ctx.message.text.trim().toUpperCase();
  const store = getStore();
  const booking = await store.getBooking(ref);

  if (!booking || booking.status !== "confirmed") {
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
  await showCancelConfirm(ctx, booking);
});

// ─────────────────────────────────────────────────────────────────────
// Step 3 — Confirm cancellation
// ─────────────────────────────────────────────────────────────────────

async function showCancelConfirm(ctx: Ctx, booking: { bookingDate: string; startTime: string; partySize: number }): Promise<void> {
  ctx.session.step = "cancel:confirm";

  const summary =
    `Are you sure you want to cancel this reservation?\n\n` +
    `📅 ${booking.bookingDate} at 🕐 ${booking.startTime}\n` +
    `👤 ${booking.partySize} guest${booking.partySize > 1 ? "s" : ""}`;

  await ctx.editMessageText(summary, {
    reply_markup: inlineKeyboard([
      [inlineButton("✅ Yes, cancel", "cancel:confirm:yes")],
      [inlineButton("⬅️ Keep it", "cancel:confirm:no")],
    ]),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Step 4 — Execute cancellation
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("cancel:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();

  const store = getStore();
  const ref = ctx.session.bookingRef;
  const booking = ref ? await store.getBooking(ref) : undefined;

  if (!booking) {
    await ctx.editMessageText(
      "Couldn't find that booking. It may have been cancelled already.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]) },
    );
    return;
  }

  // Mark as cancelled
  booking.status = "cancelled";
  await store.saveBooking(booking);
  ctx.session.step = "idle";

  await ctx.editMessageText(
    `✅ Your reservation for 📅 ${booking.bookingDate} at 🕐 ${booking.startTime} has been cancelled.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("📅 Book a new table", "booking:start")],
        [inlineButton("⬅️ Menu", "menu:main")],
      ]),
    },
  );

  // Notify owner
  await notifyOwnerCancellation(booking, ctx);
});

composer.callbackQuery("cancel:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText("Cancellation cancelled — your reservation is still confirmed.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
  });
});

export default composer;