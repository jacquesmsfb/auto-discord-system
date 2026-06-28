'use strict';

const { updateTicket } = require('./ticketStore');

const TIMEOUT_MS  = 5 * 60 * 1000;
const MAX_RETRIES = 10;

const FILLER_WORDS = new Set([
  'hey', 'hi', 'hello', 'sup', 'yo', 'hiya', 'heya', 'howdy',
  'ok', 'okay', 'sure', 'yes', 'no', 'nope', 'yep', 'yeah',
  'lol', 'lmao', 'haha', 'hmm', 'uh', 'um', 'idk',
  'good', 'fine', 'great', 'nice', 'cool', 'thanks', 'ty',
  'pls', 'please', 'help', 'wait', 'brb', 'done', 'ready',
]);

// Check if the entire message is filler (exact or word-by-word)
function isFiller(text) {
  const lower = text.toLowerCase().trim();
  if (FILLER_WORDS.has(lower)) return true;
  // Multi-word: if ALL words are filler, reject
  const words = lower.split(/\s+/);
  return words.length > 0 && words.every((w) => FILLER_WORDS.has(w));
}

async function collectProduct(channel, userId) {
  const filter = (msg) => msg.author.id === userId && !msg.author.bot;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    try {
      const collected = await channel.awaitMessages({
        filter,
        max: 1,
        time: TIMEOUT_MS,
        errors: ['time'],
      });

      const text = collected.first().content.trim();

      if (isFiller(text)) {
        attempts++;
        await channel.send(
          `👋 Please type the **product name** you want to buy.\n*(e.g. Netflix, Spotify, Disney+)*`
        );
        continue;
      }

      updateTicket(channel.id, { product: text });
      console.log(`[ProductCollector] Channel ${channel.id}: product = "${text}"`);
      return text;

    } catch {
      await channel.send('⏰ No product entered in time. Please type the product name to continue.');
      return null;
    }
  }

  await channel.send('⚠️ Too many invalid attempts. Please open a new ticket.');
  return null;
}

module.exports = { collectProduct };
