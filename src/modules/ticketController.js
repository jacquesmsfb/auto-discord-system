'use strict';

/**
 * ticketController.js
 * Orchestrates the full ticket lifecycle.
 * Called once per ticket creation. All subsequent actions come from
 * staffCommands.js (prefix commands) or interactionHandler.js (buttons).
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require('discord.js');

const { createTicket }    = require('./ticketStore');
const { STATES }          = require('./stateMachine');
const { renameChannel }   = require('./renameService');
const { collectProduct }  = require('./productCollector');

const PAYMENT_INFO = `We accept:\n• **PayPal:** \`zheolucy@gmail.com\` (Friends & Family only)\n• **Crypto** — contact staff with coin + network\n\nSend proof of payment here when ready.`;

/**
 * Build the "Have you paid?" action row.
 */
function buildPaymentRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('paid_yes')
      .setLabel('✅ YES — I have paid')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('paid_no')
      .setLabel('❌ NO — I have not paid')
      .setStyle(ButtonStyle.Danger)
  );
}

/**
 * Build post-delivery action row.
 */
function buildDeliveryRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('replace_product')
      .setLabel('🔄 Replace Product')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ask_staff')
      .setLabel('❓ Question')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('buy_again')
      .setLabel('🛒 Buy Again')
      .setStyle(ButtonStyle.Success)
  );
}

/**
 * openTicket — called when a user triggers ticket creation.
 *
 * @param {import('discord.js').Guild}   guild
 * @param {import('discord.js').User}    user
 * @param {string}                       categoryId   Optional category ID
 * @param {string}                       staffRoleId  Role to ping for verification
 */
async function openTicket(guild, user, categoryId, staffRoleId) {
  // 1. Create private channel
  const channel = await guild.channels.create({
    name: STATES.AWAITING_PAYMENT,
    parent: categoryId || null,
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
    ],
  });

  // 2. Register in store
  createTicket(channel.id, user.id, user.username);

  // 3. Greet + ask for product (text input)
  await channel.send(`👋 Hey ${user}, welcome to your ticket!\n\n**What product would you like to buy?**\n*(Type it below — no buttons needed)*`);

  // 4. Collect product via text
  let product = await collectProduct(channel, user.id);

  // If timed out, retry once
  if (!product) {
    await channel.send('**What product would you like to buy?**');
    product = await collectProduct(channel, user.id);
    if (!product) {
      await channel.send('Ticket timed out. Please open a new ticket and try again.');
      return;
    }
  }

  // 5. Ask payment status
  await channel.send({
    content: `Got it — **${product}**.\n\nHave you already paid?`,
    components: [buildPaymentRow()],
  });
}

module.exports = { openTicket, buildDeliveryRow, buildPaymentRow, PAYMENT_INFO };
