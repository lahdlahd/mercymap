-- MERCYMAP · Milestone 1 · Core schema
-- Every tenant-owned table carries church_id. Child tables reference their
-- parents with composite (church_id, id) foreign keys so a row can never
-- point at another church's record.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Platform-level tables (not tenant-owned)
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.categories (
  key        text primary key check (key ~ '^[a-z_]{2,40}$'),
  label      text not null,
  sort_order smallint not null default 0,
  is_active  boolean not null default true
);

insert into public.categories (key, label, sort_order) values
  ('food',          'Food and groceries',            10),
  ('clothing',      'Clothing',                      20),
  ('education',     'Education support',             30),
  ('financial',     'Financial assistance',          40),
  ('medical',       'Medical support and referrals', 50),
  ('transport',     'Transport',                     60),
  ('accommodation', 'Accommodation',                 70),
  ('employment',    'Employment support',            80),
  ('other',         'Other',                         90);

-- ---------------------------------------------------------------------------
-- Churches and staff
-- ---------------------------------------------------------------------------

create table public.churches (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 2 and 120),
  slug               text not null unique
                     check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  status             text not null default 'pending'
                     check (status in ('pending', 'verified', 'suspended')),
  area               text check (char_length(area) <= 120),
  contact_phone      text check (char_length(contact_phone) <= 40),
  contact_email      text check (char_length(contact_email) <= 254),
  emergency_guidance text check (char_length(emergency_guidance) <= 1000),
  created_by         uuid references auth.users (id) on delete set null,
  verified_at        timestamptz,
  verified_by        uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.church_memberships (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid not null references public.churches (id) on delete restrict,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'coordinator')),
  status     text not null default 'active' check (status in ('active', 'suspended')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (church_id, user_id)
);
create index church_memberships_user_idx on public.church_memberships (user_id);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches (id) on delete restrict,
  email       text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role        text not null check (role in ('admin', 'coordinator')),
  token_hash  text not null unique check (char_length(token_hash) >= 32),
  invited_by  uuid not null references auth.users (id) on delete cascade,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (expires_at > created_at)
);
create index invitations_church_idx on public.invitations (church_id);

-- ---------------------------------------------------------------------------
-- Assistance requests
-- ---------------------------------------------------------------------------

create table public.requests (
  id                 uuid primary key default gen_random_uuid(),
  church_id          uuid not null references public.churches (id) on delete restrict,
  reference          text not null unique default (
                       'MM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
                       || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  channel            text not null check (channel in ('public', 'staff')),
  created_by         uuid references auth.users (id) on delete set null,
  category_key       text not null references public.categories (key),
  language           text not null default 'en',
  input_method       text not null default 'text' check (input_method in ('text', 'voice')),
  original_text      text not null check (char_length(btrim(original_text)) between 1 and 5000),
  quantity_needed    integer not null default 1 check (quantity_needed between 1 and 1000),
  requester_name     text check (char_length(requester_name) <= 120),
  contact_method     text not null default 'none'
                     check (contact_method in ('phone_call', 'sms', 'in_person', 'none')),
  contact_value      text check (char_length(contact_value) <= 120),
  area               text check (char_length(area) <= 120),
  consent_given_at   timestamptz not null,
  status             text not null default 'submitted' check (status in (
                       'submitted', 'under_review', 'awaiting_clarification', 'awaiting_match',
                       'approved', 'in_progress', 'fulfilled',
                       'declined', 'cancelled', 'unable_to_fulfil')),
  outcome_reason     text check (char_length(outcome_reason) <= 1000),
  attention_flag     boolean not null default false,
  attention_source   text check (attention_source in ('ai', 'keyword', 'staff')),
  attention_reason   text check (char_length(attention_reason) <= 500),
  attention_acknowledged_by uuid references auth.users (id) on delete set null,
  attention_acknowledged_at timestamptz,
  attention_note     text check (char_length(attention_note) <= 1000),
  ai_status          text not null default 'pending'
                     check (ai_status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  ai_attempts        smallint not null default 0,
  anonymized_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (church_id, id),
  -- A public submission never carries a staff author.
  check (channel = 'staff' or created_by is null),
  -- A phone-based contact method needs a number to contact.
  check (contact_method in ('in_person', 'none') or contact_value is not null)
);
create index requests_church_status_idx on public.requests (church_id, status, created_at desc);
create index requests_attention_idx on public.requests (church_id) where attention_flag;

-- AI output is stored apart from the human-edited request fields.
create table public.ai_analyses (
  id             uuid primary key default gen_random_uuid(),
  church_id      uuid not null,
  request_id     uuid not null,
  status         text not null check (status in ('done', 'failed')),
  output         jsonb,
  error          text check (char_length(error) <= 1000),
  provider       text not null,
  model          text not null,
  prompt_version text not null,
  created_at     timestamptz not null default now(),
  foreign key (church_id, request_id) references public.requests (church_id, id) on delete restrict
);
create index ai_analyses_request_idx on public.ai_analyses (church_id, request_id, created_at desc);

-- Append-only history of what happened to a request.
create table public.request_events (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null,
  request_id    uuid not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type    text not null check (event_type ~ '^[a-z_]{2,60}$'),
  from_status   text,
  to_status     text,
  note          text check (char_length(note) <= 2000),
  created_at    timestamptz not null default now(),
  foreign key (church_id, request_id) references public.requests (church_id, id) on delete restrict
);
create index request_events_request_idx on public.request_events (church_id, request_id, created_at);

-- ---------------------------------------------------------------------------
-- Resources and allocations
-- ---------------------------------------------------------------------------

create table public.resources (
  id              uuid primary key default gen_random_uuid(),
  church_id       uuid not null references public.churches (id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 2 and 160),
  category_key    text not null references public.categories (key),
  description     text check (char_length(description) <= 2000),
  unit            text not null check (char_length(btrim(unit)) between 1 and 40),
  total_quantity  integer not null check (total_quantity >= 0),
  source_type     text not null default 'church' check (source_type in ('church', 'partner')),
  source_name     text check (char_length(source_name) <= 160),
  coverage_areas  text[] not null default '{}',
  valid_from      date,
  valid_until     date,
  manager_user_id uuid,
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (church_id, id),
  check (valid_from is null or valid_until is null or valid_until >= valid_from),
  -- The resource manager must be a member of the same church.
  foreign key (church_id, manager_user_id)
    references public.church_memberships (church_id, user_id)
    on delete set null (manager_user_id)
);
create index resources_church_category_idx on public.resources (church_id, category_key) where status = 'active';

-- One row = one human-approved allocation of a resource to a request.
--   reserved  -> approved by a coordinator, stock held
--   fulfilled -> delivery confirmed, stock distributed
--   released  -> cancelled or invalidated, stock returned
create table public.allocations (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null,
  request_id    uuid not null,
  resource_id   uuid not null,
  quantity      integer not null check (quantity > 0),
  status        text not null default 'reserved' check (status in ('reserved', 'fulfilled', 'released')),
  ai_recommended          boolean not null default false,
  recommendation_snapshot jsonb,
  approved_by   uuid references auth.users (id) on delete set null,
  approved_at   timestamptz not null default now(),
  fulfilled_by  uuid references auth.users (id) on delete set null,
  fulfilled_at  timestamptz,
  released_by   uuid references auth.users (id) on delete set null,
  released_at   timestamptz,
  release_reason text check (char_length(release_reason) <= 500),
  created_at    timestamptz not null default now(),
  foreign key (church_id, request_id)  references public.requests  (church_id, id) on delete restrict,
  foreign key (church_id, resource_id) references public.resources (church_id, id) on delete restrict
);
-- MVP rule: one active allocation per request. Drop this index to allow
-- several resources per request later; nothing else needs to change.
create unique index allocations_one_active_per_request
  on public.allocations (request_id) where status in ('reserved', 'fulfilled');
create index allocations_resource_idx on public.allocations (church_id, resource_id, status);

-- ---------------------------------------------------------------------------
-- Volunteers (records only; volunteers do not log in)
-- ---------------------------------------------------------------------------

create table public.volunteers (
  id                 uuid primary key default gen_random_uuid(),
  church_id          uuid not null references public.churches (id) on delete restrict,
  full_name          text not null check (char_length(btrim(full_name)) between 2 and 120),
  phone              text check (char_length(phone) <= 40),
  skills             text[] not null default '{}',
  availability_notes text check (char_length(availability_notes) <= 500),
  consent_given_at   timestamptz,
  status             text not null default 'active' check (status in ('active', 'inactive')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (church_id, id)
);

create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  church_id    uuid not null,
  volunteer_id uuid not null,
  request_id   uuid not null,
  task_brief   text not null check (char_length(btrim(task_brief)) between 1 and 2000),
  status       text not null default 'assigned'
               check (status in ('assigned', 'in_progress', 'completed', 'cancelled')),
  assigned_by  uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (church_id, volunteer_id) references public.volunteers (church_id, id) on delete restrict,
  foreign key (church_id, request_id)   references public.requests   (church_id, id) on delete restrict
);
create index assignments_request_idx on public.assignments (church_id, request_id);

-- ---------------------------------------------------------------------------
-- Notifications, audit, intake protection
-- ---------------------------------------------------------------------------

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  church_id         uuid not null,
  recipient_user_id uuid not null,
  type              text not null check (type ~ '^[a-z_]{2,60}$'),
  request_id        uuid,
  title             text not null check (char_length(title) <= 200),
  body              text check (char_length(body) <= 500),
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  -- The recipient must be a member of the church the notification is about.
  foreign key (church_id, recipient_user_id)
    references public.church_memberships (church_id, user_id) on delete cascade,
  foreign key (church_id, request_id) references public.requests (church_id, id) on delete restrict
);
create index notifications_recipient_idx on public.notifications (recipient_user_id, church_id, created_at desc);

-- Append-only. church_id is null for platform-level actions.
create table public.audit_logs (
  id            bigint generated always as identity primary key,
  church_id     uuid references public.churches (id) on delete restrict,
  actor_user_id uuid references auth.users (id) on delete set null,
  action        text not null check (action ~ '^[a-z_.]{2,80}$'),
  entity_type   text not null,
  entity_id     uuid,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index audit_logs_church_idx on public.audit_logs (church_id, created_at desc);

-- Counters for the public intake endpoint. Stores a hash of the caller's IP,
-- never the IP itself. Only the server (service role) touches this table.
create table public.intake_rate_limits (
  ip_hash      text not null check (char_length(ip_hash) between 32 and 128),
  church_id    uuid not null references public.churches (id) on delete cascade,
  window_start timestamptz not null,
  hits         integer not null default 1 check (hits > 0),
  primary key (ip_hash, church_id, window_start)
);
create index intake_rate_limits_window_idx on public.intake_rate_limits (window_start);
