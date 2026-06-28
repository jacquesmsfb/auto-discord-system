'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../../data/tickets.json');
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

let store = new Map();
let saveTimer = null;

(function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const obj = JSON.parse(raw);
      store = new Map(Object.entries(obj));
      console.log(`[TicketStore] Loaded ${store.size} ticket(s) from disk.`);
    }
  } catch (err) {
    console.error('[TicketStore] Failed to load tickets from disk:', err.message);
  }
})();

// Debounced async save — coalesces rapid writes into one disk op
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const obj = Object.fromEntries(store);
    fs.writeFile(DATA_FILE, JSON.stringify(obj, null, 2), (err) => {
      if (err) console.error('[TicketStore] Failed to save tickets:', err.message);
    });
  }, 200);
}

function createTicket(channelId, userId, username) {
  const ticket = {
    channelId,
    userId,
    username,
    product: null,
    state: 'awaiting-payment',
    menuActive: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.set(channelId, ticket);
  save();
  return ticket;
}

function getTicket(channelId) {
  return store.get(channelId) || null;
}

// Find an open ticket for a user (for duplicate prevention)
function getTicketByUserId(userId) {
  for (const ticket of store.values()) {
    if (ticket.userId === userId && ticket.state !== 'closed') {
      return ticket;
    }
  }
  return null;
}

function updateTicket(channelId, fields) {
  const ticket = store.get(channelId);
  if (!ticket) return null;
  Object.assign(ticket, fields, { updatedAt: Date.now() });
  save();
  return ticket;
}

function deleteTicket(channelId) {
  store.delete(channelId);
  save();
}

function allTickets() {
  return [...store.values()];
}

module.exports = { createTicket, getTicket, getTicketByUserId, updateTicket, deleteTicket, allTickets };
