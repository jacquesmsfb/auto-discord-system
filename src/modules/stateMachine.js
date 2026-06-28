'use strict';

/**
 * stateMachine.js
 * Deterministic state machine for ticket lifecycle.
 * No AI. No guessing. State changes are explicit and logged.
 */

const { getTicket, updateTicket } = require('./ticketStore');

const STATES = {
  AWAITING_PAYMENT:    'awaiting-payment',
  VERIFYING_PAYMENT:   'verifying-payment',
  AWAITING_DELIVERY:   'awaiting-delivery',
  DELIVERED:           'delivered',
  REPLACEMENT:         'replacement',
  CLOSED:              'closed',
};

const TRANSITIONS = {
  [STATES.AWAITING_PAYMENT]:    [STATES.VERIFYING_PAYMENT],
  [STATES.VERIFYING_PAYMENT]:   [STATES.AWAITING_DELIVERY],
  [STATES.AWAITING_DELIVERY]:   [STATES.DELIVERED],
  [STATES.DELIVERED]:           [STATES.REPLACEMENT, STATES.AWAITING_PAYMENT, STATES.CLOSED],
  [STATES.REPLACEMENT]:         [STATES.AWAITING_DELIVERY, STATES.CLOSED],
  [STATES.CLOSED]:              [],
};

function canTransition(currentState, nextState) {
  return (TRANSITIONS[currentState] || []).includes(nextState);
}

function transition(channelId, nextState) {
  const ticket = getTicket(channelId);

  if (!ticket) throw new Error(`No ticket found for channel ${channelId}`);

  if (!canTransition(ticket.state, nextState)) {
    throw new Error(
      `Invalid transition: ${ticket.state} → ${nextState} (channel: ${channelId})`
    );
  }

  const prevState = ticket.state;
  updateTicket(channelId, { state: nextState });
  console.log(`[StateMachine] ${channelId}: ${prevState} → ${nextState}`);
  return nextState;
}

module.exports = { STATES, transition, canTransition };
