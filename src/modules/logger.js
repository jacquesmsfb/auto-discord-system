'use strict';

const { EmbedBuilder } = require('discord.js');

let client      = null;
let _channel    = null; // cached channel reference

const MONITOR_ID = process.env.TICKET_MONITOR_CHANNEL_ID;

const COLORS = {
  created:           0x5865f2,
  state_change:      0xfee75c,
  renamed:           0x57f287,
  delivered:         0x57f287,
  closed:            0xed4245,
  payment_submitted: 0xfee75c,
  payment_verified:  0x57f287,
  replacement:       0xeb459e,
  error:             0xed4245,
};

function init(discordClient) {
  client   = discordClient;
  _channel = null; // reset cache on re-init
}

async function getMonitorChannel() {
  if (_channel) return _channel;
  if (!client || !MONITOR_ID) return null;
  try {
    _channel = await client.channels.fetch(MONITOR_ID);
    return _channel;
  } catch (err) {
    console.error('[Logger] Could not fetch monitor channel:', err.message);
    return null;
  }
}

async function log(event, fields = {}) {
  const channel = await getMonitorChannel();
  if (!channel) return;

  const color = COLORS[event] ?? 0x99aab5;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(fields.title || event.replace(/_/g, ' ').toUpperCase())
    .setTimestamp();

  const lines = [];
  if (fields.channelId)   lines.push(`**Ticket:** <#${fields.channelId}>`);
  if (fields.userId)      lines.push(`**User:** <@${fields.userId}>`);
  if (fields.product)     lines.push(`**Product:** ${fields.product}`);
  if (fields.description) lines.push(fields.description);
  if (fields.extra)       lines.push(fields.extra);

  embed.setDescription(lines.join('\n') || '\u200b');

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    _channel = null; // invalidate cache on send failure
    console.error('[Logger] Failed to send log:', err.message);
  }
}

module.exports = { init, log };
