import { Composer } from "grammy";
import { readdirSync } from "node:fs";
import { createBot, type BotContext } from "./toolkit/index.js";

// The per-chat session shape (ephemeral conversation state only).
// Durable domain data must NOT live here — use the toolkit's persistent storage.
export interface Session {
  /** Current flow step. */
  step: string;
  /** The booking reference being worked on (reschedule/cancel). */
  bookingRef?: string;
  /** Party size selected during booking. */
  partySize?: number;
  /** Date selected during booking. */
  bookingDate?: string;
  /** Selected slot start time. */
  slotTime?: string;
  /** Guest name collected during booking. */
  guestName?: string;
  /** Guest phone collected during booking. */
  guestPhone?: string;
  /** Reschedule: original booking date + time (for display). */
  origBookingInfo?: string;
}

export type Ctx = BotContext<Session>;

/**
 * buildBot — assembles the bot, AUTO-LOADS every feature handler from
 * src/handlers/, then registers the global fallback. Does NOT start the bot.
 * Add a feature by creating src/handlers/<name>.ts that default-exports a grammY
 * Composer — NEVER edit this file (concurrent feature PRs would conflict).
 */
export async function buildBot(token: string) {
  const bot = createBot<Session>(token, {
    initial: () => ({ step: "idle" }),
  });

  const dir = new URL("./handlers/", import.meta.url);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter(
      (f) =>
        (f.endsWith(".js") || f.endsWith(".ts")) &&
        !f.endsWith(".d.ts") &&
        !f.includes(".test.") &&
        !f.includes(".spec."),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    files = [];
  }
  for (const file of files.sort()) {
    const mod = (await import(new URL(file, dir).href)) as { default?: Composer<Ctx> };
    if (!mod.default) {
      throw new Error(`handler ${file} must default-export a grammY Composer`);
    }
    bot.use(mod.default);
  }

  // /cancel at the top level — cancels any flow from any handler
  bot.command("cancel", async (ctx) => {
    ctx.session.step = "idle";
    await ctx.reply("Cancelled. Tap /start to begin again.");
  });

  bot.on("message", (ctx) => ctx.reply("Sorry, I didn't understand that. Try /help."));

  return bot;
}