### Navigation and IA (Information Architecture)
- Landing page: Missing. Needs a clear overview, value prop, and primary CTAs.
- Default route: Redirects to `/media` (confusing). Route to dashboard or organizations.
- Navbar IA: Too dense, unclear hierarchy. Group related actions; add “Create Org” and “My Orgs” as first-class items.
- Org switcher: Use a prominent, persistent switcher with current org label; move from hover-only to click-activated.
- URL structure: Standardize resource routes (`/dashboard`, `/organizations`, `/events`, `/bookings`, `/invitations`, `/settings`).

### Onboarding and Empty States
- First-run onboarding: No guided steps. Add checklist (Create org → Invite → Create event).
- Empty states: “No organizations” just text. Add CTA buttons and helpful tips.
- Invite flow: Lacks clarity. Add modal with role explanation and preview.

### Roles and Permissions UX
- Role visibility: Roles not obvious. Show role badges and permissions hints.
- Admin vs member actions: Disable/hide restricted actions with reason tooltips.

### Organizations UX
- Organizations page: Needs clear list, roles, member count, quick actions (view members, settings).
- Members view: Add filters, search, role change dropdowns (if admin), and invite entry point.

### Events and Bookings
- Events list: Add tabs (Upcoming/Ongoing/Completed), search, category filter, pagination.
- Event detail: Clear slots, waitlist status, actions (Book/Cancel) with confirmations.
- Booking feedback: Show toast confirmations and waitlist promotions clearly.

### Invitations
- Central “Invitations” page: Pending, sent, and history with statuses.
- Invite UX: Email input with role picker; surface errors inline (invalid email, already a member).

### Feedback and States
- Loading states: Use skeletons/spinners for pages and lists.
- Error states: Human-friendly messages with retry.
- Toasters: Success/error toasts for actions (create org, invite, book, cancel).

### Consistency and Visual Design
- Branding: Consistent “Eventify” across UI.
- Components: Standardize buttons, modals, inputs, tables; consistent spacing and typography.
- Icons and labels: Add descriptive icons and tooltips for ambiguous actions.

### Accessibility and Responsiveness
- Keyboard navigation: Ensure focus states and tab order.
- ARIA labels: For dropdowns, dialogs, and interactive elements.
- Mobile: Responsive navbar (hamburger), stacked layouts, large touch targets.

### Auth and Session
- Login flows: Clear “Login”/“Logout” visibility and state.
- Protected routes: Friendly redirect/notice for unauthenticated access.
- Token refresh: Surface session expiry gracefully; auto-refresh in background.

### Settings and Profile
- Org settings: Name, domain, assignment/notification preferences.
- User profile: Email, name, password redirect to Keycloak as needed.

### Discoverability and Help
- In-app help: Quick tips or a “?” help menu linking to docs.
- Empty-state guidance: “What’s next” cards after key actions.

If you want, I can draft a prioritized UI roadmap (landing page → dashboard → orgs → invites → events) and start implementing pages incrementally.









__________________

Booking and Waitlist (FCFS)
• FCFS seat claim: When someone tries to book seats, the system atomically checks remaining capacity. If enough seats exist, the booking is confirmed immediately.
• Preferred seats honored when free: If specific seat numbers are requested and none are already taken, those exact seats are assigned. Otherwise, the lowest available seat numbers are auto-assigned.
• Waitlist placement: If capacity is insufficient, the person is placed on a waitlist in the order they arrived. Their live position can be viewed and updates as others cancel or get promoted.
Seat Allocation
• Conflict-free assignment: Confirmed bookings receive seat numbers that are guaranteed not to overlap with previously assigned seats.
• Deterministic order: If no specific seats are requested, the system assigns the lowest available numbers to keep seating compact and predictable.
• Backfill for older bookings: If a past confirmed booking lacks recorded seat numbers, the system assigns them on-demand using the same lowest-available rule.
Cancellation and Rebooking (Promotion)
• Full cancellation: Cancelling a booking frees those seats. The system immediately increases capacity and starts promoting people from the waitlist in the exact order they joined.
• Partial cancellation: Cancelling specific seat numbers frees only those seats and triggers the same promotion process.
• Promotion logic:
Promotes as many seats as are available.
If the next person in line requested more seats than are available, they receive a partial confirmation for the available amount, and the remainder stays in the waitlist without losing their place.
Seat numbers are then assigned to the newly confirmed seats using the conflict-free, lowest-available approach.
• Real-time updates: Once promotions happen, all connected viewers are notified about newly booked seats and any seats that just became free.
Live Waiting Position
• Immediate visibility: People on the waitlist can see their current place in line.
• Fallback awareness: If live data can’t be determined, the system uses a stored fallback position.
Real-Time Seat Holds (Pre-Booking Protection)
• Short-lived holds: While someone is selecting seats in the UI, the system temporarily “holds” those seats so others don’t select the same ones at the same time.
• Auto-expiration: Holds expire quickly if not refreshed, preventing long-term blocking.
• Room-wide awareness: Everyone viewing the event sees which seats are currently held and which are free in near real-time.
Notifications
• Booking confirmed/waitlisted: People are notified when their booking is immediately confirmed or when they’re placed on the waitlist.
• Waitlist promoted: People are notified when they are moved from the waitlist to confirmed after seats free up.
UI Workflows
• Seat selection modal:
Shows available, held, and booked seats in real-time.
Lets people pick specific seats (if desired) and proceeds to booking.
Keeps holds alive while the modal is open and releases them when closed or after inactivity.
• Manage seats:
Displays current seat assignments for a booking.
Allows seat-by-seat cancellation, triggering immediate reallocation to the waitlist if any.
• Cancel flow:
A simple process to cancel a whole booking.
Frees seats and triggers immediate promotion of waiting users.
• Your events / booking status:
Shows confirmed and pending (waitlisted) seats per event.
Provides entry points to manage or cancel.