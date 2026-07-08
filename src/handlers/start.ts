import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard, registerMainMenuItem } from "../toolkit/index.js";

// Register main-menu items at module load time so they appear on /start
registerMainMenuItem({ label: "📅 Book a table", data: "booking:start", order: 10 });
registerMainMenuItem({ label: "🔄 Reschedule", data: "booking:reschedule", order: 20 });
registerMainMenuItem({ label: "Cancel", data: "booking:cancel", order: 30 });

const composer = new Composer<Ctx>();

const WELCOME =
  "👋 Welcome to TableReserve.\n\n" +
  "Tap a button below to book a table, or pick from the menu.";

composer.command("start", async (ctx) => {
  ctx.session.step = "idle";
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;