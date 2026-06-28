# Discord Ticket System — Clean Rebuild

Zero AI. Deterministic state machine. Staff-controlled flow.

## Setup

1. Fill in `.env`:
   ```
   DISCORD_TOKEN=your_bot_token
   STAFF_ROLE_ID=123456789        # Role to ping for payment verification
   STAFF_CHANNEL_ID=123456789     # Channel for staff alerts (optional)
   TICKET_CATEGORY=123456789      # Category for ticket channels (optional)
   OPEN_TICKET_CHANNEL_ID=123456789  # Channel where !ticket is allowed (optional)
   ```

2. Run:
   ```
   node index.js
   ```

## Ticket Flow

| Step | Trigger | State | Channel Name |
|------|---------|-------|--------------|
| 1 | User types `!ticket` | `awaiting-payment` | `awaiting-payment` |
| 2 | User types product name | still `awaiting-payment` | unchanged |
| 3 | User clicks **YES** (paid) | `verifying-payment` | `verifying-payment` |
| 4 | Staff runs `!verify` | `awaiting-delivery` | `{product-name}` |
| 5 | Staff runs `!deliver` | `delivered` | `delivered` |

## Staff Commands

| Command | Required State | Effect |
|---------|---------------|--------|
| `!verify` | `verifying-payment` | Confirms payment, renames channel to product name |
| `!deliver` | `awaiting-delivery` | Marks delivered, shows post-delivery buttons |
| `!close` | Any | Deletes ticket channel after 5s |

## Post-Delivery Buttons

| Button | Action |
|--------|--------|
| 🔄 Replace Product | Sets state `replacement`, renames to `replace-product`, asks for issue |
| ❓ Question | Pings staff in ticket + staff channel alert |
| 🛒 Buy Again | Resets to `awaiting-payment`, restarts product input |

## Architecture

```
Discord Event
  → messageCreate (index.js)
      → !ticket           → ticketController.openTicket()
      → !verify/deliver   → staffCommands.handleStaffCommand()
  → interactionCreate     → interactionHandler.handleInteraction()
        ↓
  stateMachine.transition()
        ↓
  renameService.renameChannel()
        ↓
  ticketStore.updateTicket()
```
