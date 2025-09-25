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