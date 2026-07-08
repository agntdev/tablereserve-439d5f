# TableReserve Booking Bot — Bot specification

**Archetype:** booking

**Voice:** professional and warm — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that manages table reservations for a restaurant based on configured availability rules. Guests select dates/times/party sizes through guided buttons, receive confirmation codes, and can reschedule/cancel via inline actions. Owners get a dashboard with real-time booking summaries, capacity tracking, and no-show marking capabilities, all within Telegram with strict guest data privacy.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Restaurant guests seeking reservations
- Restaurant owners/staff managing bookings

## Success criteria

- Guest receives valid reservation confirmation with reference code
- Owner receives real-time booking status updates
- No-show tracking works without exposing guest details

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with booking options
- **Book Table** (button, actor: user, callback: booking:start) — Initiate reservation flow with party size selection
- **Reschedule** (button, actor: user, callback: booking:reschedule) — Modify existing reservation
  - inputs: booking reference
  - outputs: updated booking confirmation
- **Cancel** (button, actor: user, callback: booking:cancel) — Cancel existing reservation
  - inputs: booking reference
  - outputs: cancellation confirmation
- **/today** (command, actor: owner, command: /today) — Show owner dashboard for current day
- **/bookings** (command, actor: owner, command: /bookings) — List upcoming bookings for specified date range

## Flows

### guest_booking_flow
_Trigger:_ booking:start

1. Select party size (1-8+)
2. Choose date via calendar
3. Display available time slots
4. Capture optional name/phone
5. Generate confirmation code
6. Show reschedule/cancel buttons

_Data touched:_ booking, restaurant_configuration, table_inventory

### owner_dashboard_flow
_Trigger:_ /today

1. Show today's bookings list
2. Display remaining capacity by time blocks

_Data touched:_ restaurant_configuration, table_inventory, booking

### reschedule_flow
_Trigger:_ booking:reschedule

1. Select new date
2. Display available time slots excluding original
3. Confirm changes
4. Update booking record
5. Send new confirmation to guest

_Data touched:_ booking, availability_slot

### cancel_flow
_Trigger:_ booking:cancel

1. Request confirmation
2. Mark booking as cancelled
3. Update inventory availability
4. Notify owner

_Data touched:_ booking, table_inventory

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **restaurant_configuration** _(retention: persistent)_ — Core restaurant settings for availability calculation
  - fields: weekday_opening_hours, sitting_length_minutes, table_layout, reminder_lead_time_hours, timezone
- **table_inventory** _(retention: persistent)_ — Available table capacity grouped by seat size
  - fields: seat_capacity_groups, total_tables, total_seats
- **booking** _(retention: persistent)_ — Reservation record with guest and timing details
  - fields: reference_code, guest_name, guest_phone, booking_date, start_time, party_size, allocated_table, status
- **availability_slot** _(retention: session)_ — Computed time slots based on inventory and bookings
  - fields: date, time_range, available_capacity

## Integrations

- **Telegram** (required) — Bot API messaging and owner dashboard
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure opening hours
- Set table inventory
- Adjust reminder lead time
- View daily booking summary
- Mark no-shows
- Cancel bookings

## Notifications

- New booking alert to owner
- Reminder notification to guest and owner
- Cancellation/reschedule alerts to owner
- No-show flag notifications

## Permissions & privacy

- Guest phone numbers only visible to owner
- Booking references public but not personally identifiable
- Owner must authenticate via pre-configured Telegram user IDs

## Edge cases

- Guest inputs non-button values for party size/date
- Double-booking at boundary times
- No-show marking when guest doesn't arrive
- Timezone conversion errors

## Required tests

- End-to-end booking flow with calendar and slot selection
- Owner dashboard accuracy after multiple bookings
- No-show marking without exposing guest data
- Reminder timing validation

## Assumptions

- Default 90-minute sitting length
- 15-minute slot granularity
- Simple table model (seat groups instead of individual tables)
- Owner pre-configures Telegram user IDs during setup
