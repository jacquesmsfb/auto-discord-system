'use strict';

const { DiscordAPIError } = require('discord.js');

function sanitise(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'ticket';
}

async function renameChannel(channel, newName) {
  const safe  = sanitise(newName);
  const fresh = await channel.fetch().catch(() => channel);

  if (fresh.name === safe) {
    console.log(`[RenameService] #${channel.id} already named "${safe}", skipping.`);
    return { ok: true };
  }

  try {
    await fresh.setName(safe);
    console.log(`[RenameService] #${channel.id} renamed to "${safe}"`);
    return { ok: true };
  } catch (err) {
    // Discord.js v14: rate limit comes back as HTTP 429
    const isRateLimit = err instanceof DiscordAPIError
      ? err.status === 429
      : err.status === 429 || err.httpStatus === 429;

    if (isRateLimit) {
      const retryAfter = err.retryAfter ?? 600;
      console.warn(`[RenameService] Rate limited on #${channel.id}. Retry after ${retryAfter}s`);
      return { ok: false, rateLimited: true, retryAfter };
    }

    console.error(`[RenameService] Failed to rename #${channel.id}:`, err.message);
    return { ok: false };
  }
}

module.exports = { renameChannel, sanitise };
