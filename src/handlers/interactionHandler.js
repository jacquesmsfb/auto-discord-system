'use strict';

const { EmbedBuilder }    = require('discord.js');
const { getTicket, updateTicket, getTicketByUserId } = require('../modules/ticketStore');
const { STATES, transition }    = require('../modules/stateMachine');
const { renameChannel }         = require('../modules/renameService');
const { collectProduct }        = require('../modules/productCollector');
const { openTicket, PAYMENT_INFO, buildPaymentRow } = require('../modules/ticketController');
const logger                    = require('../modules/logger');

const STAFF_ROLE_IDS      = ['1513120435472961536', '1513120624741060700'];
const PAYMENT_VERIFY_ID   = process.env.PAYMENT_VERIFICATION_CHANNEL_ID;
const CUSTOMER_SUPPORT_ID = process.env.CUSTOMER_SUPPORT_CHANNEL_ID;
const TICKET_CATEGORY     = process.env.TICKET_CATEGORY || null;

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return;

  const { customId, channelId, guild } = interaction;

  const user = interaction.user ?? interaction.member?.user;
  if (!user) {
    console.error('[interactionHandler] Could not resolve user from interaction');
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => interaction.channel);

  // open_ticket — no existing ticket needed, handle before the guard
  if (customId === 'open_ticket') {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    return handleOpenTicket(interaction, guild, user);
  }

  await interaction.deferUpdate().catch(() => {});

  const ticket = getTicket(channelId);
  if (!ticket) {
    return interaction.followUp({ content: '❌ No ticket found for this channel.', ephemeral: true });
  }

  switch (customId) {
    case 'paid_yes':        return handlePaidYes(interaction, ticket, guild, channel, user);
    case 'paid_no':         return handlePaidNo(interaction, channel);
    case 'replace_product': return handleReplaceProduct(interaction, ticket, channel, user);
    case 'ask_staff':       return handleAskStaff(interaction, ticket, channel, user, guild);
    case 'buy_again':       return handleBuyAgain(interaction, ticket, channel, user);
    default:
      console.warn(`[interactionHandler] Unknown customId: ${customId}`);
  }
}

// ── open_ticket ───────────────────────────────────────────────────────────────

async function handleOpenTicket(interaction, guild, user) {
  // BUG 4 FIX: prevent duplicate tickets
  const existing = getTicketByUserId(user.id);
  if (existing) {
    return interaction.followUp({
      content: `❌ You already have an open ticket: <#${existing.channelId}>.\nPlease use that channel.`,
      ephemeral: true,
    });
  }

  try {
    await openTicket(guild, user, TICKET_CATEGORY);

    await logger.log('created', {
      title: '🎫 Ticket Opened',
      userId: user.id,
      extra: `Opened by ${user.tag ?? user.username}`,
    });

    await interaction.followUp({
      content: '✅ Your ticket has been created! Check your private channel.',
      ephemeral: true,
    });
  } catch (err) {
    console.error('[interactionHandler] open_ticket error:', err.message);
    await interaction.followUp({
      content: '⚠️ Failed to create ticket. Please contact staff.',
      ephemeral: true,
    });
  }
}

// ── paid_yes ──────────────────────────────────────────────────────────────────

async function handlePaidYes(interaction, ticket, guild, channel, user) {
  if (user.id !== ticket.userId) {
    return interaction.followUp({ content: '❌ This is not your ticket.', ephemeral: true });
  }

  if (ticket.state !== STATES.AWAITING_PAYMENT) {
    return interaction.followUp({
      content: '❌ Payment already submitted or ticket is in wrong state.',
      ephemeral: true,
    });
  }

  try {
    transition(channel.id, STATES.VERIFYING_PAYMENT);
    await renameChannel(channel, STATES.VERIFYING_PAYMENT);

    const staffPings = STAFF_ROLE_IDS.map((id) => `<@&${id}>`).join(' ');

    await channel.send(
      `📨 **Payment submitted.**\n\n${staffPings} — please verify the payment.\n\n> **Product:** ${ticket.product || 'Not set'}\n> **Customer:** <@${ticket.userId}>`
    );

    if (PAYMENT_VERIFY_ID) {
      try {
        const pvChannel = await guild.channels.fetch(PAYMENT_VERIFY_ID);
        if (pvChannel) {
          await pvChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0xfee75c)
                .setTitle('🔍 Payment Awaiting Verification')
                .setDescription(
                  `**Ticket:** <#${channel.id}>\n**Customer:** <@${ticket.userId}>\n**Product:** ${ticket.product || 'Not set'}\n\nRun \`!verify\` inside the ticket channel to confirm.`
                )
                .setTimestamp(),
            ],
          });
        }
      } catch (err) {
        console.error('[interactionHandler] payment-verification forward error:', err.message);
      }
    }

    await logger.log('payment_submitted', {
      title: '💳 Payment Submitted',
      channelId: channel.id,
      userId: ticket.userId,
      product: ticket.product,
    });

    await interaction.followUp({
      content: '✅ Payment submitted. Staff will verify shortly.',
      ephemeral: true,
    });
  } catch (err) {
    console.error('[interactionHandler] paid_yes error:', err.message);
    await interaction.followUp({ content: `⚠️ Error: ${err.message}`, ephemeral: true });
  }
}

// ── paid_no ───────────────────────────────────────────────────────────────────

async function handlePaidNo(interaction, channel) {
  await channel.send(`💳 **Payment instructions:**\n\n${PAYMENT_INFO}`);
  await interaction.followUp({ content: 'Payment info sent.', ephemeral: true });
}

// ── replace_product ───────────────────────────────────────────────────────────

async function handleReplaceProduct(interaction, ticket, channel, user) {
  if (ticket.state !== STATES.DELIVERED) {
    return interaction.followUp({
      content: '❌ Can only request replacement after delivery.',
      ephemeral: true,
    });
  }

  try {
    transition(channel.id, STATES.REPLACEMENT);
    updateTicket(channel.id, { menuActive: false });
    await renameChannel(channel, 'replace-product');

    await channel.send(
      `🔄 **Replacement requested.**\n\n<@${user.id}> — Please describe the issue with your product:`
    );

    await logger.log('replacement', {
      title: '🔄 Replacement Requested',
      channelId: channel.id,
      userId: user.id,
      product: ticket.product,
    });

    await interaction.followUp({
      content: '✅ Replacement started. Describe your issue above.',
      ephemeral: true,
    });
  } catch (err) {
    console.error('[interactionHandler] replace_product error:', err.message);
    await interaction.followUp({ content: `⚠️ Error: ${err.message}`, ephemeral: true });
  }
}

// ── ask_staff ─────────────────────────────────────────────────────────────────

async function handleAskStaff(interaction, ticket, channel, user, guild) {
  const staffPings = STAFF_ROLE_IDS.map((id) => `<@&${id}>`).join(' ');

  updateTicket(channel.id, { menuActive: false });

  await channel.send(
    `${staffPings}\n\n❓ **Customer needs assistance.**\n> User: <@${user.id}>\n\nPlease respond in this channel.`
  );

  if (CUSTOMER_SUPPORT_ID) {
    try {
      const supportChannel = await guild.channels.fetch(CUSTOMER_SUPPORT_ID);
      if (supportChannel) {
        await supportChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xeb459e)
              .setTitle('❓ Customer Needs Assistance')
              .setDescription(
                `**Ticket:** <#${channel.id}>\n**Customer:** <@${user.id}>\n**Product:** ${ticket.product || 'Not set'}\n\nRespond in the ticket channel.`
              )
              .setTimestamp(),
          ],
        });
      }
    } catch (err) {
      console.error('[interactionHandler] customer-support alert error:', err.message);
    }
  }

  await logger.log('state_change', {
    title: '❓ Customer Asked for Help',
    channelId: channel.id,
    userId: user.id,
    product: ticket.product,
  });

  await interaction.followUp({ content: '📣 Staff has been alerted.', ephemeral: true });
}

// ── buy_again ─────────────────────────────────────────────────────────────────

async function handleBuyAgain(interaction, ticket, channel, user) {
  if (ticket.state !== STATES.DELIVERED) {
    return interaction.followUp({
      content: '❌ Can only buy again after delivery.',
      ephemeral: true,
    });
  }

  // BUG 3 FIX: transition first, then update extra fields
  transition(channel.id, STATES.AWAITING_PAYMENT);
  updateTicket(channel.id, { product: null, menuActive: false });
  await renameChannel(channel, STATES.AWAITING_PAYMENT);

  await channel.send(
    `🛒 **New order started!**\n\n<@${user.id}> — **What product would you like to buy?**\n*(Type it below)*`
  );

  await logger.log('state_change', {
    title: '🛒 Buy Again — New Order',
    channelId: channel.id,
    userId: user.id,
  });

  await interaction.followUp({ content: '✅ New order started.', ephemeral: true });

  const product = await collectProduct(channel, user.id);
  if (!product) return;

  await channel.send({
    content: `Got it — **${product}**.\n\nHave you already paid?`,
    components: [buildPaymentRow()],
  });
}

module.exports = { handleInteraction };
