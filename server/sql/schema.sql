-- Multi-Tenant Event Booking & Notification Platform Schema (Eventify)
-- Updated for Eventify project with orgAdmin, Organizer, User roles

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Organizations (Tenants)
CREATE TABLE IF NOT EXISTS eventify_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) UNIQUE,
  keycloak_org_id VARCHAR(255) UNIQUE,
  settings JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users (can be orgAdmin, organizer, or user)
CREATE TABLE IF NOT EXISTS eventify_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_id VARCHAR(255) UNIQUE,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(20),
  avatar_url TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eventify_organization_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES eventify_organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES eventify_users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('orgAdmin', 'organizer', 'user')),
  permissions JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS eventify_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES eventify_organizations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK (category IN ('webinar','concert','hackathon')),
  event_date TIMESTAMP NOT NULL,
  total_slots INT NOT NULL CHECK (total_slots > 0),
  available_slots INT NOT NULL CHECK (available_slots >= 0),
  status TEXT CHECK (status IN ('upcoming','ongoing','completed','cancelled')) DEFAULT 'upcoming',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Backfill for existing deployments where the column may not exist yet
ALTER TABLE eventify_events
  ADD COLUMN IF NOT EXISTS available_slots INT NOT NULL DEFAULT 0;
ALTER TABLE eventify_events
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'upcoming';

-- Ensure constraints exist (Postgres skips duplicates safely when named)
DO $$ BEGIN
  BEGIN
    ALTER TABLE eventify_events
      ADD CONSTRAINT eventify_events_available_slots_nonnegative CHECK (available_slots >= 0);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Bookings
CREATE TABLE IF NOT EXISTS eventify_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES eventify_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES eventify_users(id) ON DELETE CASCADE,
  seats INT NOT NULL CHECK (seats > 0),
  status TEXT NOT NULL CHECK (status IN ('confirmed','waiting','cancelled')),
  waiting_number INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Per-seat allocation for events
CREATE TABLE IF NOT EXISTS eventify_booking_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES eventify_events(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES eventify_bookings(id) ON DELETE SET NULL,
  user_id UUID REFERENCES eventify_users(id) ON DELETE SET NULL,
  seat_no INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('booked','cancelled')) DEFAULT 'booked',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_eventify_booking_seats_unique ON eventify_booking_seats(event_id, seat_no) WHERE status = 'booked';

-- Booking History
CREATE TABLE IF NOT EXISTS eventify_booking_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES eventify_bookings(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created','cancelled','promoted')),
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Waitlist for sold-out events
CREATE TABLE IF NOT EXISTS eventify_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES eventify_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES eventify_users(id) ON DELETE CASCADE,
  position INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting','notified','confirmed','expired','cancelled')) DEFAULT 'waiting',
  notified_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS eventify_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES eventify_users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES eventify_events(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('booking_confirmed','booking_waitlisted','booking_cancelled','waitlist_promoted','event_updated','seat_available')),
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','failed')) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eventify_organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES eventify_organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('orgAdmin', 'organizer', 'user')),
  invited_by UUID NOT NULL REFERENCES eventify_users(id),
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Performance (Eventify)
CREATE INDEX IF NOT EXISTS idx_eventify_organization_users_org_id ON eventify_organization_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_eventify_organization_users_user_id ON eventify_organization_users(user_id);
CREATE INDEX IF NOT EXISTS idx_eventify_organization_users_role ON eventify_organization_users(role);
CREATE INDEX IF NOT EXISTS idx_eventify_events_org_id ON eventify_events(org_id);
CREATE INDEX IF NOT EXISTS idx_eventify_events_date ON eventify_events(event_date);
CREATE INDEX IF NOT EXISTS idx_eventify_bookings_event_id ON eventify_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_eventify_bookings_user_id ON eventify_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_eventify_waitlist_event_id ON eventify_waitlist(event_id);
CREATE INDEX IF NOT EXISTS idx_eventify_waitlist_user_id ON eventify_waitlist(user_id);
CREATE INDEX IF NOT EXISTS idx_eventify_waitlist_position ON eventify_waitlist(event_id, position);
CREATE INDEX IF NOT EXISTS idx_eventify_waitlist_status ON eventify_waitlist(status);

-- Functions for automatic updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Make triggers idempotent using conditional blocks
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_eventify_organizations_updated_at' AND c.relname = 'eventify_organizations'
  ) THEN
    CREATE TRIGGER update_eventify_organizations_updated_at
    BEFORE UPDATE ON eventify_organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_eventify_users_updated_at' AND c.relname = 'eventify_users'
  ) THEN
    CREATE TRIGGER update_eventify_users_updated_at
    BEFORE UPDATE ON eventify_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_eventify_organization_users_updated_at' AND c.relname = 'eventify_organization_users'
  ) THEN
    CREATE TRIGGER update_eventify_organization_users_updated_at
    BEFORE UPDATE ON eventify_organization_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_eventify_events_updated_at' AND c.relname = 'eventify_events'
  ) THEN
    CREATE TRIGGER update_eventify_events_updated_at
    BEFORE UPDATE ON eventify_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_eventify_bookings_updated_at' AND c.relname = 'eventify_bookings'
  ) THEN
    CREATE TRIGGER update_eventify_bookings_updated_at
    BEFORE UPDATE ON eventify_bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_eventify_organization_invites_updated_at' AND c.relname = 'eventify_organization_invites'
  ) THEN
    CREATE TRIGGER update_eventify_organization_invites_updated_at
    BEFORE UPDATE ON eventify_organization_invites
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_eventify_waitlist_updated_at' AND c.relname = 'eventify_waitlist'
  ) THEN
    CREATE TRIGGER update_eventify_waitlist_updated_at
    BEFORE UPDATE ON eventify_waitlist
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- No ticket priority scaffolding in Eventify schema