import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

// /help — explains how the bot works for restaurant guests.
const composer = new Composer<Ctx>();

const HELP =
  "ℹ️ How TableReserve works:\n\n" +
  "Tap /start to open the menu, then:\n" +
  "• 📅 Book a table — pick a date, time, and party size\n" +
  "• 🔄 Reschedule — change an existing booking\n" +
  "• Cancel — cancel a reservation\n\n" +
  "Need help? Contact the restaurant directly.";

const backToMenu = inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(HELP);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP, { reply_markup: backToMenu });
});

export default composer;