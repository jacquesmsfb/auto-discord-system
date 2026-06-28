'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const { getTicket, updateTicket, createTicket, deleteTicket } = require('../modules/ticketStore');
const { STATES, transition }   = require('../modules/stateMachine');
const { renameChannel }        = require('../modules/renameService');
const { buildDeliveryRow }     = require('../modules/ticketController');
const logger                   = require('../modules/logger');

const STAFF_ROLE_IDS = [
  '1513120435472961536',
  '1513120624741060700',
  ...(process.env.STAFF_ROLE_ID ? [process.env.STAFF_ROLE_ID] : []),
];

const PAYMENT_VERIFICATION_ID = process.env.PAYMENT_VERIFICATION_CHANNEL_ID;

function isStaff(member) {
  return (
    STAFF_ROLE_IDS.some((id) => member.roles.cache.has(id)) ||
    member.permissions.has('ManageChannels')
  );
}

async function handleStaffCommand(message) {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const [command, ...args] = message.content.trim().slice(1).toLowerCase().split(/\s+/);

  switch (command) {
    case 'dashboard':         return handleDashboard(message);
    case 'verify':            return handleVerify(message);
    case 'deliver':           return handleDeliver(message);
    case 'close':
    case 'cllose':            return handleClose(message);
    case 'reopen':            return handleReopen(message, args);
    case 'rename':            return handleRename(message, args);
    default:                  return;
  }
}

// ── !dashboard ────────────────────────────────────────────────────────────────

async function handleDashboard(message) {
  if (!isStaff(message.member)) {
    return message.reply('🚫 You do not have permission to use this command.');
  }

  await message.delete().catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle('🎫 Support Tickets')
    .setDescription(
      'Need help or want to place an order?\nClick the button below to open a private ticket with our team.'
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'One button. Private channel. Fast support.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_ticket')
      .setLabel('📩 Open a Ticket')
      .setStyle(ButtonStyle.Primary)
  );

  await message.channel.send({ embeds: [embed], components: [row] });
}

// ── !verify ───────────────────────────────────────────────────────────────────

async function handleVerify(message) {
  if (!isStaff(message.member)) {
    return message.reply('🚫 You do not have permission to use this command.');
  }

  const ticket = getTicket(message.channel.id);
  if (!ticket) {
    return message.reply('❌ No ticket record. Use `!reopen <product> <userId>` to restore it.');
  }

  if (ticket.state !== STATES.VERIFYING_PAYMENT) {
    return message.reply(`❌ Ticket state is \`${ticket.state}\`. Expected \`verifying-payment\`.`);
  }

  const product = ticket.product || 'unknown-product';

  try {
    transition(message.channel.id, STATES.AWAITING_DELIVERY);
    const result = await renameChannel(message.channel, product);

    let extra = '';
    if (!result.ok && result.rateLimited) {
      const mins = Math.ceil((result.retryAfter ?? 600) / 60);
      extra = `\n⚠️ Rename rate limited — rename to **${product}** manually in ~${mins} min.`;
    }

    await message.channel.send(
      `✅ **Payment verified** by ${message.member}.\n\nReady for delivery — product: **${product}**.${extra}`
    );

    if (PAYMENT_VERIFICATION_ID) {
      try {
        const pvChannel = await message.guild.channels.fetch(PAYMENT_VERIFICATION_ID);
        if (pvChannel) {
          await pvChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle('✅ Payment Verified')
                .setDescription(
                  `**Ticket:** <#${message.channel.id}>\n**Customer:** <@${ticket.userId}>\n**Product:** ${product}\n**Verified by:** ${message.member}`
                )
                .setTimestamp(),
            ],
          });
        }
      } catch (err) {
        console.error('[staffCommands] payment-verification log error:', err.message);
      }
    }

    await logger.log('payment_verified', {
      title: '✅ Payment Verified',
      channelId: message.channel.id,
      userId: ticket.userId,
      product,
      extra: `Verified by ${message.member}`,
    });
  } catch (err) {
    console.error('[staffCommands] !verify error:', err.message);
    await message.reply(`⚠️ Error: ${err.message}`);
  }
}

// ── !deliver ──────────────────────────────────────────────────────────────────

async function handleDeliver(message) {
  if (!isStaff(message.member)) {
    return message.reply('🚫 You do not have permission to use this command.');
  }

  const ticket = getTicket(message.channel.id);
  if (!ticket) {
    return message.reply('❌ No ticket record. Use `!reopen <product> <userId>` to restore it.');
  }

  if (ticket.state !== STATES.AWAITING_DELIVERY) {
    return message.reply(`❌ Ticket state is \`${ticket.state}\`. Expected \`awaiting-delivery\`.`);
  }

  try {
    transition(message.channel.id, STATES.DELIVERED);

    const result = await renameChannel(message.channel, 'done');
    if (!result.ok && result.rateLimited) {
      const mins = Math.ceil((result.retryAfter ?? 600) / 60);
      await message.channel.send(
        `⚠️ Channel rename to \`done\` rate limited — rename manually in ~${mins} min.`
      );
    }

    await message.channel.send({
      content: `📦 **Delivery complete!**\n\n<@${ticket.userId}> — What would you like to do next?`,
      components: [buildDeliveryRow()],
    });

    await logger.log('delivered', {
      title: '📦 Order Delivered',
      channelId: message.channel.id,
      userId: ticket.userId,
      product: ticket.product,
      extra: `Delivered by ${message.member}`,
    });
  } catch (err) {
    console.error('[staffCommands] !deliver error:', err.message);
    await message.reply(`⚠️ Error: ${err.message}`);
  }
}

// ── !close ────────────────────────────────────────────────────────────────────

async function handleClose(message) {
  if (!isStaff(message.member)) {
    return message.reply('🚫 You do not have permission to use this command.');
  }

  const ticket = getTicket(message.channel.id);
  if (!ticket) {
    return message.reply('❌ No ticket record. Use `!reopen <product> <userId>` to restore it.');
  }

  await logger.log('closed', {
    title: '🔒 Ticket Closed',
    channelId: message.channel.id,
    userId: ticket.userId,
    product: ticket.product,
    extra: `Closed by ${message.member}`,
  });

  // Remove from store BEFORE deleting channel so record is clean
  deleteTicket(message.channel.id);

  await message.channel.send('🔒 Ticket closed. This channel will be deleted in 5 seconds.');
  setTimeout(() => {
    message.channel.delete('Ticket closed by staff').catch(console.error);
  }, 5000);
}

// ── !rename ───────────────────────────────────────────────────────────────────

async function handleRename(message, args) {
  if (!isStaff(message.member)) {
    return message.reply('🚫 You do not have permission to use this command.');
  }

  if (!args.length) {
    return message.reply('**Usage:** `!rename <new-name>`\n**Example:** `!rename done`');
  }

  const newName = args.join('-');
  const result  = await renameChannel(message.channel, newName);

  if (result.ok) {
    await message.reply(`✅ Channel renamed to \`${newName}\`.`);
    await logger.log('renamed', {
      title: '✏️ Channel Renamed',
      channelId: message.channel.id,
      extra: `Renamed to \`${newName}\` by ${message.member}`,
    });
  } else if (result.rateLimited) {
    const mins = Math.ceil((result.retryAfter ?? 600) / 60);
    await message.reply(`⚠️ Rate limited — try again in ~${mins} min.`);
  } else {
    await message.reply('⚠️ Rename failed. Check bot permissions.');
  }
}

// ── !reopen ───────────────────────────────────────────────────────────────────

async function handleReopen(message, args) {
  if (!isStaff(message.member)) {
    return message.reply('🚫 You do not have permission to use this command.');
  }

  if (args.length < 2) {
    return message.reply(
      '**Usage:** `!reopen <product> <@user or userId> [state]`\n' +
      '**States:** `awaiting-payment` `verifying-payment` `awaiting-delivery` `delivered`\n' +
      '**Example:** `!reopen netflix @User awaiting-delivery`'
    );
  }

  const product  = args[0];
  const userId   = args[1].replace(/[<@!>]/g, '');
  const stateArg = args[2] || 'awaiting-delivery';

  const validStates = Object.values(STATES);
  if (!validStates.includes(stateArg)) {
    return message.reply(
      `❌ Invalid state \`${stateArg}\`.\nValid: ${validStates.map((s) => `\`${s}\``).join(', ')}`
    );
  }

  const existing = getTicket(message.channel.id);
  if (existing) {
    updateTicket(message.channel.id, { product, userId, state: stateArg, menuActive: false });
  } else {
    createTicket(message.channel.id, userId, 'restored');
    updateTicket(message.channel.id, { product, state: stateArg, menuActive: false });
  }

  await message.reply(
    `✅ Ticket restored.\n> **Product:** ${product}\n> **User:** <@${userId}>\n> **State:** \`${stateArg}\``
  );
}

module.exports = { handleStaffCommand, isStaff, STAFF_ROLE_IDS };
