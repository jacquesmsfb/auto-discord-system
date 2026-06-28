'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { handleStaffCommand }  = require('./src/handlers/staffCommands');
const { handleInteraction }   = require('./src/handlers/interactionHandler');
const { openTicket, buildDeliveryRow } = require('./src/modules/ticketController');
const { getTicket, updateTicket }      = require('./src/modules/ticketStore');
const { STATES }              = require('./src/modules/stateMachine');
const logger                  = require('./src/modules/logger');

const TOKEN               = process.env.DISCORD_TOKEN;
const TICKET_CATEGORY     = process.env.TICKET_CATEGORY    || null;
const OPEN_TICKET_CHANNEL = process.env.OPEN_TICKET_CHANNEL_ID || null;
const STAFF_ROLE_IDS      = ['1513120435472961536', '1513120624741060700'];

if (!TOKEN) {
  console.error('DISCORD_TOKEN is not set. Exiting.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// BUG 10 FIX: only DELIVERED and REPLACEMENT are eligible for keyword menu
// BUG 2 FIX: menuActive is now persisted in ticketStore, not in-memory Set
const MENU_ELIGIBLE_STATES = new Set([
  STATES.DELIVERED,
  STATES.REPLACEMENT,
]);

const TRIGGER_KEYWORDS = [
  'help', 'support',
  'replace', 'replacement', 'broken', 'not working', 'doesnt work', "doesn't work",
  'wrong', 'issue', 'problem', 'error', 'fix',
  'buy again', 'reorder', 'order again', 'another',
  'question', 'ask', 'confused',
];

function containsTrigger(text) {
  const lower = text.toLowerCase();
  return TRIGGER_KEYWORDS.some((kw) => lower.includes(kw));
}

client.once('ready', () => {
  logger.init(client);
  console.log(`✅ Ticket bot online as ${client.user.tag}`);
  console.log(`   Payment verification: ${process.env.PAYMENT_VERIFICATION_CHANNEL_ID}`);
  console.log(`   Ticket monitor:       ${process.env.TICKET_MONITOR_CHANNEL_ID}`);
  console.log(`   Customer support:     ${process.env.CUSTOMER_SUPPORT_CHANNEL_ID}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ── !ticket ────────────────────────────────────────────────────────────────
  if (message.content.trim().toLowerCase() === '!ticket') {
    if (OPEN_TICKET_CHANNEL && message.channel.id !== OPEN_TICKET_CHANNEL) {
      return message.reply(`Please open tickets in <#${OPEN_TICKET_CHANNEL}>.`).catch(() => {});
    }
    try {
      await openTicket(message.guild, message.author, TICKET_CATEGORY, STAFF_ROLE_IDS[0]);
      await message.reply('✅ Your ticket has been created!').catch(() => {});
    } catch (err) {
      console.error('[index] openTicket error:', err.message);
      await message.reply('⚠️ Failed to create ticket. Please contact staff.').catch(() => {});
    }
    return;
  }

  // ── Staff commands ─────────────────────────────────────────────────────────
  if (message.content.startsWith('!')) {
    await handleStaffCommand(message).catch((err) =>
      console.error('[index] staffCommand error:', err.message)
    );
    return;
  }

  // ── Ticket keyword / post-delivery menu listener ───────────────────────────
  const ticket = getTicket(message.channel.id);
  if (!ticket || message.author.id !== ticket.userId) return;

  const isEligible = MENU_ELIGIBLE_STATES.has(ticket.state);
  const isDelivered = ticket.state === STATES.DELIVERED;
  const hasTrigger  = containsTrigger(message.content);

  // Show menu if:
  //   A) state is DELIVERED and customer types anything
  //   B) state is REPLACEMENT and customer types a trigger keyword
  // Only show once — tracked via ticket.menuActive in the store (survives restarts)
  if ((isDelivered || (isEligible && hasTrigger)) && !ticket.menuActive) {
    updateTicket(message.channel.id, { menuActive: true });
    await message.channel.send({
      content: `<@${message.author.id}> What would you like to do?`,
      components: [buildDeliveryRow()],
    });
  }
});

client.on('interactionCreate', async (interaction) => {
  await handleInteraction(interaction).catch((err) =>
    console.error('[index] interactionHandler error:', err.message)
  );
});

client.on('error', (err) => console.error('[Discord Client Error]', err));
process.on('unhandledRejection', (err) => console.error('[UnhandledRejection]', err));

client.login(TOKEN);
