/**
 * Owner dashboard and settings handler.
 *
 * Owner-only commands:
 *   /today — shows today's bookings and capacity
 *   /bookings <date> — shows bookings for a specific date
 *
 * Owner controls (via "Owner Panel" button on main menu for authenticated owners):
 *   - View daily summary
 *   - Mark no-shows
 *   - Cancel any booking
 *   - Configure settings
 */

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { getStore } from "../storage/domain.js";
import { loadConfigOrDefault, seatGroupForSize, computeAvailableSlots } from "../services/availability-service.js";
import { now } from "../time/clock.js";
import { notifyOwnerCancellation, notifyOwnerNoShow } from "./notifications.js";
import type { Booking } from "../storage/schemas.js";
import { defaultConfig, defaultInventory } from "../services/availability-service.js";

const composer = new Composer<Ctx>();

// Register owner panel on the main menu (handlers check auth at runtime)
registerMainMenuItem({ label: "⚙️ Owner Panel", data: "owner:panel", order: 200 });

// ─────────────────────────────────────────────────────────────────────
// Auth check helpers
// ─────────────────────────────────────────────────────────────────────

async function isOwner(userId: number | undefined): Promise<boolean> {
  if (!userId) return false;
  const store = getStore();
  const cfg = await store.getOwnerConfig();
  if (!cfg) return false;
  return cfg.ownerIds.includes(userId);
}

async function requireOwner(ctx: Ctx): Promise<boolean> {
  if (await isOwner(ctx.from?.id)) return true;
  await ctx.answerCallbackQuery?.();
  await ctx.editMessageText?.(
    "This section is only available to restaurant staff.",
    { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "menu:main")]]) },
  ).catch(() => {});
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Owner panel entry
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("owner:panel", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isOwner(ctx.from?.id))) {
    await ctx.editMessageText(
      "This section is only available to restaurant staff.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "menu:main")]]) },
    );
    return;
  }

  await ctx.editMessageText("⚙️ Owner Panel — what would you like to do?", {
    reply_markup: inlineKeyboard([
      [inlineButton("📋 Today's bookings", "owner:today")],
      [inlineButton("📅 View bookings by date", "owner:bookings:prompt")],
      [inlineButton("🚫 Mark no-show", "owner:noshow:prompt")],
      [inlineButton("🗑 Cancel a booking", "owner:cancel:booking:prompt")],
      [inlineButton("⚙️ Configure settings", "owner:settings")],
      [inlineButton("⬅️ Back", "menu:main")],
    ]),
  });
});

// ─────────────────────────────────────────────────────────────────────
// /today — owner dashboard
// ─────────────────────────────────────────────────────────────────────

composer.command("today", async (ctx) => {
  if (!(await isOwner(ctx.from?.id))) {
    await ctx.reply("This command is only available to restaurant staff.");
    return;
  }

  const currentDate = now();
  const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
  const store = getStore();
  const bookings = await store.getBookingsByDate(dateStr);
  const { config, inventory } = await loadConfigOrDefault();

  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const noShows = bookings.filter((b) => b.status === "no_show");
  const cancelled = bookings.filter((b) => b.status === "cancelled");

  const dw = currentDate.getDay();
  const hours = config.weekdayOpeningHours[dw];
  const hoursStr = hours ? `${hours.open} – ${hours.close}` : "Closed";

  // Build capacity summary
  const capacityLines: string[] = [];
  for (const [group, tables] of Object.entries(inventory.seatCapacityGroups)) {
    const groupBookings = confirmed.filter((b) => b.seatGroup === group);
    const used = groupBookings.length;
    capacityLines.push(`  Table${tables > 1 ? "s" : ""} for ${group}: ${used}/${tables} used`);
  }

  let msg =
    `📋 Today's bookings — ${dateStr}\n\n` +
    `Hours: ${hoursStr}\n` +
    `Capacity:\n${capacityLines.join("\n")}\n\n` +
    `Confirmed: ${confirmed.length}\n` +
    `No-shows: ${noShows.length}\n` +
    `Cancelled: ${cancelled.length}`;

  if (confirmed.length > 0) {
    msg += "\n\n── Bookings ──";
    for (const b of confirmed.sort((a, c) => a.startTime.localeCompare(c.startTime))) {
      msg += `\n${b.startTime}–${b.endTime} | ${b.partySize}p | <code>${b.referenceCode}</code> | ${b.guestName || "(no name)"}`;
    }
  } else {
    msg += "\n\nNo bookings today.";
  }

  await ctx.reply(msg, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      [inlineButton("🔄 Refresh", "owner:today")],
      [inlineButton("🚫 Mark no-show", "owner:noshow:prompt")],
      [inlineButton("⬅️ Owner Panel", "owner:panel")],
    ]),
  });
});

// Handle owner:today from callback
composer.callbackQuery("owner:today", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  const currentDate = now();
  const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
  const store = getStore();
  const bookings = await store.getBookingsByDate(dateStr);
  const { config, inventory } = await loadConfigOrDefault();

  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const noShows = bookings.filter((b) => b.status === "no_show");
  const cancelled = bookings.filter((b) => b.status === "cancelled");

  const dw = currentDate.getDay();
  const hours = config.weekdayOpeningHours[dw];
  const hoursStr = hours ? `${hours.open} – ${hours.close}` : "Closed";

  const capacityLines: string[] = [];
  for (const [group, tables] of Object.entries(inventory.seatCapacityGroups)) {
    const groupBookings = confirmed.filter((b) => b.seatGroup === group);
    const used = groupBookings.length;
    capacityLines.push(`  Table${tables > 1 ? "s" : ""} for ${group}: ${used}/${tables} used`);
  }

  let msg =
    `📋 Today's bookings — ${dateStr}\n\n` +
    `Hours: ${hoursStr}\n` +
    `Capacity:\n${capacityLines.join("\n")}\n\n` +
    `Confirmed: ${confirmed.length}\n` +
    `No-shows: ${noShows.length}\n` +
    `Cancelled: ${cancelled.length}`;

  if (confirmed.length > 0) {
    msg += "\n\n── Bookings ──";
    for (const b of confirmed.sort((a, c) => a.startTime.localeCompare(c.startTime))) {
      msg += `\n${b.startTime}–${b.endTime} | ${b.partySize}p | ${b.referenceCode} | ${b.guestName || "(no name)"}`;
    }
  } else {
    msg += "\n\nNo bookings today.";
  }

  await ctx.editMessageText(msg, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      [inlineButton("🔄 Refresh", "owner:today")],
      [inlineButton("🚫 Mark no-show", "owner:noshow:prompt")],
      [inlineButton("⬅️ Owner Panel", "owner:panel")],
    ]),
  });
});

// ─────────────────────────────────────────────────────────────────────
// /bookings — view bookings for a specific date range
// ─────────────────────────────────────────────────────────────────────

composer.command("bookings", async (ctx) => {
  if (!(await isOwner(ctx.from?.id))) {
    await ctx.reply("This command is only available to restaurant staff.");
    return;
  }

  // Parse optional date from command args, or default to today
  const args = ctx.message?.text?.split(" ").slice(1).join(" ") ?? "";
  let dateStr: string;
  if (args) {
    // Try to parse user-provided date
    const parsed = parseDateInput(args);
    if (!parsed) {
      await ctx.reply(
        "Couldn't understand that date. Try /bookings YYYY-MM-DD or just /bookings for today.",
      );
      return;
    }
    dateStr = parsed;
  } else {
    const d = now();
    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const store = getStore();
  const bookings = await store.getBookingsByDate(dateStr);

  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const noShows = bookings.filter((b) => b.status === "no_show");
  const cancelled = bookings.filter((b) => b.status === "cancelled");

  let msg = `📅 Bookings for ${dateStr}\n\nConfirmed: ${confirmed.length} | No-shows: ${noShows.length} | Cancelled: ${cancelled.length}`;

  if (confirmed.length > 0) {
    msg += "\n\n── Confirmed ──";
    for (const b of confirmed.sort((a, c) => a.startTime.localeCompare(c.startTime))) {
      msg += `\n${b.startTime} | ${b.partySize}p | ${b.referenceCode} | ${b.guestName || "(no name)"}`;
    }
  } else {
    msg += "\n\nNo confirmed bookings for this date.";
  }

  await ctx.reply(msg, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Owner Panel", "owner:panel")],
    ]),
  });
});

// Handle owner:bookings:prompt
composer.callbackQuery("owner:bookings:prompt", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  ctx.session.step = "owner:awaiting_date";
  await ctx.editMessageText(
    "Enter a date to view bookings for (e.g. 2026-07-15):",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back", "owner:panel")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner:awaiting_date") return next();
  if (!(await isOwner(ctx.from?.id))) return next();

  const dateInput = ctx.message.text.trim();
  const parsed = parseDateInput(dateInput);
  if (!parsed) {
    await ctx.reply(
      "Couldn't understand that date. Use YYYY-MM-DD format (e.g. 2026-07-15).",
    );
    return;
  }

  ctx.session.step = "idle";
  const store = getStore();
  const bookings = await store.getBookingsByDate(parsed);

  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const noShows = bookings.filter((b) => b.status === "no_show");
  const cancelled = bookings.filter((b) => b.status === "cancelled");

  let msg = `📅 Bookings for ${parsed}\n\nConfirmed: ${confirmed.length} | No-shows: ${noShows.length} | Cancelled: ${cancelled.length}`;

  if (confirmed.length > 0) {
    msg += "\n\n── Confirmed ──";
    for (const b of confirmed.sort((a, c) => a.startTime.localeCompare(c.startTime))) {
      msg += `\n${b.startTime} | ${b.partySize}p | ${b.referenceCode} | ${b.guestName || "(no name)"}`;
    }
  } else {
    msg += "\n\nNo confirmed bookings for this date.";
  }

  await ctx.reply(msg, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Owner Panel", "owner:panel")],
    ]),
  });
});

// ─────────────────────────────────────────────────────────────────────
// No-show marking flow
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("owner:noshow:prompt", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  ctx.session.step = "owner:noshow:ref";
  await ctx.editMessageText(
    "Enter the reference code of the booking to mark as no-show:",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Today's bookings", "owner:today")],
        [inlineButton("⬅️ Owner Panel", "owner:panel")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner:noshow:ref") return next();
  if (!(await isOwner(ctx.from?.id))) return next();

  const ref = ctx.message.text.trim().toUpperCase();
  const store = getStore();
  const booking = await store.getBooking(ref);

  if (!booking) {
    await ctx.reply(
      "Couldn't find a booking with that code. Try again.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Try again", "owner:noshow:prompt")],
          [inlineButton("⬅️ Owner Panel", "owner:panel")],
        ]),
      },
    );
    return;
  }

  if (booking.status !== "confirmed") {
    await ctx.reply(
      `Booking <code>${ref}</code> has status "${booking.status}". Only confirmed bookings can be marked as no-show.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  ctx.session.bookingRef = ref;
  ctx.session.step = "owner:noshow:confirm";

  // Show booking details WITHOUT guest personal info (privacy requirement)
  await ctx.reply(
    `Mark this booking as no-show?\n\n` +
    `Ref: <code>${ref}</code>\n` +
    `📅 ${booking.bookingDate} at 🕐 ${booking.startTime}\n` +
    `👤 ${booking.partySize} guest${booking.partySize > 1 ? "s" : ""}\n` +
    `Table: ${booking.seatGroup}`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Mark as no-show", "owner:noshow:confirm:yes")],
        [inlineButton("⬅️ Cancel", "owner:noshow:cancel")],
      ]),
    },
  );
});

composer.callbackQuery("owner:noshow:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText("No-show marking cancelled.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Owner Panel", "owner:panel")]]),
  });
});

composer.callbackQuery("owner:noshow:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  const store = getStore();
  const ref = ctx.session.bookingRef;
  const booking = ref ? await store.getBooking(ref) : undefined;

  if (!booking) {
    await ctx.editMessageText(
      "Couldn't find that booking.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Owner Panel", "owner:panel")]]) },
    );
    return;
  }

  booking.status = "no_show";
  await store.saveBooking(booking);
  ctx.session.step = "idle";

  // No-show notification — does NOT include guest name or phone (privacy)
  await ctx.editMessageText(
    `🚫 Booking <code>${ref}</code> marked as no-show.\n\n` +
    `📅 ${booking.bookingDate} at 🕐 ${booking.startTime}\n` +
    `👤 ${booking.partySize} guests`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("📋 Today's bookings", "owner:today")],
        [inlineButton("⬅️ Owner Panel", "owner:panel")],
      ]),
    },
  );

  // Notify other owners
  await notifyOwnerNoShow(booking, ctx);
});

// ─────────────────────────────────────────────────────────────────────
// Settings configuration
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("owner:settings", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  const { config } = await loadConfigOrDefault();

  await ctx.editMessageText(
    "⚙️ Restaurant settings\n\n" +
    `Sitting length: ${config.sittingLengthMinutes} min\n` +
    `Reminder lead: ${config.reminderLeadTimeHours} hours\n` +
    `Timezone: ${config.timezone}\n\n` +
    `Opening hours: see available options below.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("🕐 Sitting length", "owner:settings:sitting")],
        [inlineButton("🕑 Opening hours", "owner:settings:hours")],
        [inlineButton("⏰ Reminder lead time", "owner:settings:reminder")],
        [inlineButton("🕑 Timezone", "owner:settings:tz")],
        [inlineButton("📊 Table inventory", "owner:settings:inventory")],
        [inlineButton("⬅️ Back", "owner:panel")],
      ]),
    },
  );
});

// Sitting length
composer.callbackQuery("owner:settings:sitting", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  ctx.session.step = "owner:settings:sitting";
  await ctx.editMessageText(
    "Enter the sitting length in minutes (e.g. 90, 120, 60):",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back", "owner:settings")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner:settings:sitting") return next();
  if (!(await isOwner(ctx.from?.id))) return next();

  const minutes = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(minutes) || minutes < 30 || minutes > 240) {
    await ctx.reply("Please enter a number between 30 and 240.");
    return;
  }

  const store = getStore();
  const existing = (await store.getRestaurantConfig()) ?? defaultConfig();
  existing.sittingLengthMinutes = minutes;
  await store.saveRestaurantConfig(existing);

  ctx.session.step = "idle";
  await ctx.reply(`✅ Sitting length updated to ${minutes} minutes.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Settings", "owner:settings")],
    ]),
  });
});

// Reminder lead time
composer.callbackQuery("owner:settings:reminder", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  ctx.session.step = "owner:settings:reminder";
  await ctx.editMessageText(
    "Enter the reminder lead time in hours before the booking (e.g. 2, 4, 24):",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back", "owner:settings")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner:settings:reminder") return next();
  if (!(await isOwner(ctx.from?.id))) return next();

  const hours = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(hours) || hours < 1 || hours > 72) {
    await ctx.reply("Please enter a number between 1 and 72.");
    return;
  }

  const store = getStore();
  const existing = (await store.getRestaurantConfig()) ?? defaultConfig();
  existing.reminderLeadTimeHours = hours;
  await store.saveRestaurantConfig(existing);

  ctx.session.step = "idle";
  await ctx.reply(`✅ Reminder lead time updated to ${hours} hours before booking.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Settings", "owner:settings")],
    ]),
  });
});

// Timezone
composer.callbackQuery("owner:settings:tz", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  ctx.session.step = "owner:settings:tz";
  await ctx.editMessageText(
    "Enter the restaurant's IANA timezone (e.g. America/New_York, Europe/London, Asia/Tokyo):",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back", "owner:settings")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner:settings:tz") return next();
  if (!(await isOwner(ctx.from?.id))) return next();

  const tz = ctx.message.text.trim();
  // Basic validation — check if Intl accepts it
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    await ctx.reply(
      "That doesn't look like a valid timezone. Try something like America/New_York.",
    );
    return;
  }

  const store = getStore();
  const existing = (await store.getRestaurantConfig()) ?? defaultConfig();
  existing.timezone = tz;
  await store.saveRestaurantConfig(existing);

  ctx.session.step = "idle";
  await ctx.reply(`✅ Timezone updated to ${tz}.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Settings", "owner:settings")],
    ]),
  });
});

// Table inventory
composer.callbackQuery("owner:settings:inventory", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  const inv = (await loadConfigOrDefault()).inventory;
  const lines = Object.entries(inv.seatCapacityGroups)
    .map(([group, count]) => `  Tables for ${group}: ${count}`)
    .join("\n");

  await ctx.editMessageText(
    `📊 Current table inventory:\n\n${lines}\n\n` +
    `To update, send a message with the format:\n` +
    `<code>2:4, 4:3, 6:2, 8+:1</code>\n\n` +
    `Where each is <code>group:count</code> separated by commas.`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back", "owner:settings")],
      ]),
    },
  );

  ctx.session.step = "owner:settings:inventory";
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner:settings:inventory") return next();
  if (!(await isOwner(ctx.from?.id))) return next();

  const input = ctx.message.text.trim();
  const groups: Record<string, number> = {};
  let totalTables = 0;
  let totalSeats = 0;
  let valid = true;

  for (const part of input.split(",")) {
    const trimmed = part.trim();
    const match = trimmed.match(/^(\d\+?)\s*:\s*(\d+)$/);
    if (!match) {
      valid = false;
      break;
    }
    const label = match[1];
    const count = parseInt(match[2], 10);
    if (count < 1) { valid = false; break; }
    groups[label] = count;
    totalTables += count;
    const cap = parseInt(label.replace("+", ""), 10);
    totalSeats += cap * count;
  }

  if (!valid || Object.keys(groups).length === 0) {
    await ctx.reply(
      "Couldn't parse that format. Use: 2:4, 4:3, 6:2, 8+:1",
      { parse_mode: "HTML" },
    );
    return;
  }

  const store = getStore();
  await store.saveTableInventory({ seatCapacityGroups: groups, totalTables, totalSeats });

  ctx.session.step = "idle";
  await ctx.reply(`✅ Table inventory updated.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Settings", "owner:settings")],
    ]),
  });
});

// ─────────────────────────────────────────────────────────────────────
// Opening hours configuration
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("owner:settings:hours", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  const { config } = await loadConfigOrDefault();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let msg = "🕑 Current opening hours:\n\n";
  for (let d = 0; d <= 6; d++) {
    const h = config.weekdayOpeningHours[d];
    msg += `${dayNames[d]}: ${h ? `${h.open} – ${h.close}` : "Closed"}\n`;
  }
  msg += "\nTo update, send the day number and times in the format:\n";
  msg += "<code>0:10:00-22:00</code> (Sun 10:00–22:00)\n";
  msg += "Or <code>0:closed</code> to mark a day as closed.";

  await ctx.editMessageText(msg, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back", "owner:settings")],
    ]),
  });

  ctx.session.step = "owner:settings:hours";
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner:settings:hours") return next();
  if (!(await isOwner(ctx.from?.id))) return next();

  const input = ctx.message.text.trim();
  const match = input.match(/^(\d)\s*:\s*(closed|(\d{1,2}:\d{2})-(\d{1,2}:\d{2}))$/i);
  if (!match) {
    await ctx.reply(
      "Couldn't parse that format. Use: <code>0:10:00-22:00</code> or <code>0:closed</code>",
      { parse_mode: "HTML" },
    );
    return;
  }

  const day = parseInt(match[1], 10);
  if (day < 0 || day > 6) {
    await ctx.reply("Day must be 0 (Sun) to 6 (Sat).");
    return;
  }

  const store = getStore();
  const existing = (await store.getRestaurantConfig()) ?? defaultConfig();

  if (match[2].toLowerCase() === "closed") {
    delete existing.weekdayOpeningHours[day];
  } else {
    existing.weekdayOpeningHours[day] = {
      open: match[3].padStart(5, "0"),
      close: match[4].padStart(5, "0"),
    };
  }

  await store.saveRestaurantConfig(existing);
  ctx.session.step = "idle";

  await ctx.reply("✅ Opening hours updated.", {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Settings", "owner:settings")],
    ]),
  });
});

// ─────────────────────────────────────────────────────────────────────
// Owner-initiated booking cancellation
// ─────────────────────────────────────────────────────────────────────

composer.callbackQuery("owner:cancel:booking:prompt", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  ctx.session.step = "owner:cancel:ref";
  await ctx.editMessageText(
    "Enter the reference code of the booking to cancel:",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Today's bookings", "owner:today")],
        [inlineButton("⬅️ Owner Panel", "owner:panel")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner:cancel:ref") return next();
  if (!(await isOwner(ctx.from?.id))) return next();

  const ref = ctx.message.text.trim().toUpperCase();
  const store = getStore();
  const booking = await store.getBooking(ref);

  if (!booking) {
    await ctx.reply(
      "Couldn't find a booking with that code.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Try again", "owner:cancel:booking:prompt")],
        ]),
      },
    );
    return;
  }

  if (booking.status === "cancelled") {
    await ctx.reply(`Booking <code>${ref}</code> is already cancelled.`, {
      parse_mode: "HTML",
    });
    return;
  }

  ctx.session.bookingRef = ref;
  ctx.session.step = "owner:cancel:confirm";

  await ctx.reply(
    `Cancel this booking?\n\n` +
    `Ref: <code>${ref}</code>\n` +
    `📅 ${booking.bookingDate} at 🕐 ${booking.startTime}\n` +
    `👤 ${booking.partySize} guests\n` +
    `Status: ${booking.status}`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Yes, cancel", "owner:cancel:confirm:yes")],
        [inlineButton("⬅️ No, keep it", "owner:cancel:confirm:no")],
      ]),
    },
  );
});

composer.callbackQuery("owner:cancel:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;

  const store = getStore();
  const ref = ctx.session.bookingRef;
  const booking = ref ? await store.getBooking(ref) : undefined;

  if (!booking) {
    await ctx.editMessageText(
      "Couldn't find that booking.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Owner Panel", "owner:panel")]]) },
    );
    return;
  }

  booking.status = "cancelled";
  await store.saveBooking(booking);
  ctx.session.step = "idle";

  await ctx.editMessageText(
    `✅ Booking <code>${ref}</code> cancelled.\n` +
    `📅 ${booking.bookingDate} at 🕐 ${booking.startTime}`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("📋 Today's bookings", "owner:today")],
        [inlineButton("⬅️ Owner Panel", "owner:panel")],
      ]),
    },
  );

  await notifyOwnerCancellation(booking, ctx);
});

composer.callbackQuery("owner:cancel:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText("Cancellation aborted.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Owner Panel", "owner:panel")]]),
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function parseDateInput(input: string): string | null {
  // Try YYYY-MM-DD first
  const isoMatch = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = String(parseInt(isoMatch[2], 10)).padStart(2, "0");
    const d = String(parseInt(isoMatch[3], 10)).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // Try MM/DD or MM/DD/YYYY
  const slashMatch = input.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (slashMatch) {
    const m = String(parseInt(slashMatch[1], 10)).padStart(2, "0");
    const d = String(parseInt(slashMatch[2], 10)).padStart(2, "0");
    const y = slashMatch[3] ?? String(now().getFullYear());
    return `${y}-${m}-${d}`;
  }

  return null;
}

export default composer;