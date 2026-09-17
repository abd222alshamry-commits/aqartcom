CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(40),
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'user' CHECK (role IN ('user','agent','admin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS properties (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  type VARCHAR(80) NOT NULL,
  mode VARCHAR(30) NOT NULL CHECK (mode IN ('بيع','إيجار')),
  city VARCHAR(100) NOT NULL,
  district VARCHAR(150),
  price NUMERIC(14,2) NOT NULL,
  area NUMERIC(12,2),
  rooms INTEGER,
  baths INTEGER,
  description TEXT,
  image_url TEXT,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','rejected')),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'USD';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS app_seed_runs (key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE TABLE IF NOT EXISTS favorites (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_type ON properties(type);
CREATE INDEX IF NOT EXISTS idx_properties_mode ON properties(mode);
CREATE INDEX IF NOT EXISTS idx_properties_price ON properties(price);
CREATE INDEX IF NOT EXISTS idx_properties_featured ON properties(featured);
CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);


ALTER TABLE properties ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_properties_views ON properties(views_count);

CREATE TABLE IF NOT EXISTS property_images (
  id BIGSERIAL PRIMARY KEY,
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_images_property ON property_images(property_id, sort_order);

CREATE TABLE IF NOT EXISTS inquiries (
  id BIGSERIAL PRIMARY KEY,
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  sender_name VARCHAR(120) NOT NULL,
  sender_phone VARCHAR(40),
  sender_email VARCHAR(255),
  message TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','replied','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inquiries_property ON inquiries(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_sender ON inquiries(sender_id);

ALTER TABLE properties ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'active';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_geo ON properties(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;


CREATE TABLE IF NOT EXISTS property_videos (
  id BIGSERIAL PRIMARY KEY,
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title VARCHAR(200),
  source_type VARCHAR(30) NOT NULL DEFAULT 'upload' CHECK (source_type IN ('upload','youtube','external')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_videos_property ON property_videos(property_id, created_at DESC);
ALTER TABLE property_videos ADD COLUMN IF NOT EXISTS source_type VARCHAR(30) NOT NULL DEFAULT 'upload';
ALTER TABLE property_videos ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE property_videos ADD COLUMN IF NOT EXISTS poster_url TEXT;
CREATE INDEX IF NOT EXISTS idx_property_videos_primary ON property_videos(property_id, is_primary DESC, created_at DESC);

ALTER TABLE properties ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS offices (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(220) UNIQUE,
  phone VARCHAR(40),
  whatsapp VARCHAR(40),
  city VARCHAR(100),
  district VARCHAR(150),
  address TEXT,
  description TEXT,
  logo_url TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS office_id BIGINT REFERENCES offices(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS office_title VARCHAR(80);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS office_id BIGINT REFERENCES offices(id) ON DELETE SET NULL;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_office ON users(office_id);
CREATE INDEX IF NOT EXISTS idx_properties_office ON properties(office_id);
CREATE INDEX IF NOT EXISTS idx_properties_assigned_to ON properties(assigned_to);

CREATE TABLE IF NOT EXISTS office_leads (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
  property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
  name VARCHAR(140) NOT NULL,
  phone VARCHAR(40),
  email VARCHAR(255),
  budget NUMERIC(14,2),
  interest_type VARCHAR(80),
  interest_mode VARCHAR(30),
  city VARCHAR(100),
  district VARCHAR(150),
  source VARCHAR(60) DEFAULT 'manual',
  stage VARCHAR(30) NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','interested','viewing','negotiation','won','lost')),
  notes TEXT,
  next_follow_up TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_office_leads_office ON office_leads(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_leads_stage ON office_leads(office_id, stage);

CREATE TABLE IF NOT EXISTS office_appointments (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  lead_id BIGINT REFERENCES office_leads(id) ON DELETE SET NULL,
  property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
  assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_office_appointments_office ON office_appointments(office_id, starts_at);

CREATE TABLE IF NOT EXISTS office_deals (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  lead_id BIGINT REFERENCES office_leads(id) ON DELETE SET NULL,
  property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
  agent_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  mode VARCHAR(30) NOT NULL CHECK (mode IN ('بيع','إيجار')),
  amount NUMERIC(14,2) NOT NULL,
  office_commission NUMERIC(14,2) DEFAULT 0,
  agent_commission NUMERIC(14,2) DEFAULT 0,
  platform_commission_rate NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  platform_commission NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_payer VARCHAR(20) NOT NULL DEFAULT 'seller' CHECK (commission_payer IN ('seller')),
  status VARCHAR(30) NOT NULL DEFAULT 'negotiation' CHECK (status IN ('negotiation','reserved','completed','cancelled')),
  closed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_office_deals_office ON office_deals(office_id, created_at DESC);

CREATE TABLE IF NOT EXISTS office_activities (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_office_activities_office ON office_activities(office_id, created_at DESC);


-- Monetization / subscriptions / advertising / verification / payments
CREATE TABLE IF NOT EXISTS office_plans (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) UNIQUE NOT NULL,
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','yearly','one_time')),
  max_properties INTEGER NOT NULL DEFAULT 10,
  max_staff INTEGER NOT NULL DEFAULT 2,
  max_featured INTEGER NOT NULL DEFAULT 0,
  max_ads INTEGER NOT NULL DEFAULT 0,
  verified_included BOOLEAN NOT NULL DEFAULT FALSE,
  priority_support BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS office_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  plan_id BIGINT NOT NULL REFERENCES office_plans(id),
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','past_due','cancelled','expired')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  payment_provider VARCHAR(40),
  external_subscription_id VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_office_subscriptions_office ON office_subscriptions(office_id, status, ends_at DESC);
CREATE TABLE IF NOT EXISTS office_ads (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  property_id BIGINT REFERENCES properties(id) ON DELETE CASCADE,
  title VARCHAR(180),
  placement VARCHAR(40) NOT NULL DEFAULT 'featured' CHECK (placement IN ('featured','homepage','search','city')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','expired','rejected')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  whatsapp_clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_office_ads_active ON office_ads(status, starts_at, ends_at);
CREATE TABLE IF NOT EXISTS office_verifications (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  document_url TEXT,
  document_type VARCHAR(80),
  notes TEXT,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_office_verifications_office ON office_verifications(office_id, created_at DESC);
CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  office_id BIGINT REFERENCES offices(id) ON DELETE SET NULL,
  subscription_id BIGINT REFERENCES office_subscriptions(id) ON DELETE SET NULL,
  ad_id BIGINT REFERENCES office_ads(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  provider VARCHAR(40) NOT NULL DEFAULT 'mock',
  provider_payment_id VARCHAR(180),
  checkout_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payments_office ON payments(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS review_status VARCHAR(30) NOT NULL DEFAULT 'not_required';
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_review_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_review_status_check CHECK (review_status IN ('not_required','pending','approved','rejected'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(180);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS proof_url TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_no VARCHAR(80) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_payments_finance ON payments(provider,review_status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_office_finance ON payments(office_id,created_at DESC);


INSERT INTO office_plans(name,slug,price,currency,billing_period,max_properties,max_staff,max_featured,max_ads,verified_included,priority_support,description,features,sort_order)
VALUES
('البداية','starter',29,'USD','monthly',15,2,1,1,FALSE,FALSE,'للمكاتب الصغيرة','["15 عقار","2 موظفين","عقار مميز واحد","إعلان مدفوع واحد"]'::jsonb,1),
('الاحترافي','pro',79,'USD','monthly',100,10,5,5,TRUE,TRUE,'للمكاتب النشطة','["100 عقار","10 موظفين","5 عقارات مميزة","5 حملات إعلانية","شارة موثّق","دعم أولوية"]'::jsonb,2),
('المؤسسات','enterprise',199,'USD','monthly',-1,30,20,20,TRUE,TRUE,'لشركات العقارات الكبيرة','["عقارات غير محدودة","30 موظفاً","20 عقاراً مميزاً","20 حملة","توثيق المكتب","دعم أولوية وتقارير متقدمة"]'::jsonb,3)
ON CONFLICT (slug) DO UPDATE SET price=EXCLUDED.price,max_properties=EXCLUDED.max_properties,max_staff=EXCLUDED.max_staff,max_featured=EXCLUDED.max_featured,max_ads=EXCLUDED.max_ads,features=EXCLUDED.features;


ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100;
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS daily_budget NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS whatsapp_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS last_whatsapp_at TIMESTAMPTZ;
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS last_impression_at TIMESTAMPTZ;
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS last_click_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_office_ads_marketplace ON office_ads(placement,status,starts_at,ends_at,priority DESC,budget DESC);

CREATE TABLE IF NOT EXISTS ad_events (
  id BIGSERIAL PRIMARY KEY,
  ad_id BIGINT NOT NULL REFERENCES office_ads(id) ON DELETE CASCADE,
  property_id BIGINT REFERENCES properties(id) ON DELETE CASCADE,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('impression','click','whatsapp')),
  session_key VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ad_events DROP CONSTRAINT IF EXISTS ad_events_event_type_check;
ALTER TABLE ad_events ADD CONSTRAINT ad_events_event_type_check CHECK (event_type IN ('impression','click','whatsapp'));
CREATE INDEX IF NOT EXISTS idx_ad_events_ad_time ON ad_events(ad_id, event_type, created_at DESC);

-- Advertising wallet, ledger and campaign consumption
CREATE TABLE IF NOT EXISTS office_wallets (
  office_id BIGINT PRIMARY KEY REFERENCES offices(id) ON DELETE CASCADE,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('topup','ad_charge','refund','adjustment')),
  amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  ad_id BIGINT REFERENCES office_ads(id) ON DELETE SET NULL,
  payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
  description VARCHAR(240),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_office ON wallet_transactions(office_id, created_at DESC);
CREATE TABLE IF NOT EXISTS ad_invoices (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  ad_id BIGINT REFERENCES office_ads(id) ON DELETE SET NULL,
  wallet_transaction_id BIGINT REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  invoice_no VARCHAR(60) NOT NULL UNIQUE,
  description VARCHAR(240),
  amount NUMERIC(14,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  billing_model VARCHAR(10),
  units NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_price NUMERIC(14,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_invoices_office ON ad_invoices(office_id, created_at DESC);

ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS target_lat NUMERIC(10,7);
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS target_lng NUMERIC(10,7);
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS target_radius_km NUMERIC(8,2);
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS target_label VARCHAR(180);
CREATE INDEX IF NOT EXISTS idx_office_ads_target_geo ON office_ads(target_lat,target_lng,target_radius_km) WHERE target_lat IS NOT NULL AND target_lng IS NOT NULL;

ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS billing_model VARCHAR(10) NOT NULL DEFAULT 'cpc';
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS bid NUMERIC(14,6) NOT NULL DEFAULT 0;
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS spent NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE office_ads ADD COLUMN IF NOT EXISTS last_charge_at TIMESTAMPTZ;
ALTER TABLE office_ads DROP CONSTRAINT IF EXISTS office_ads_billing_model_check;
ALTER TABLE office_ads ADD CONSTRAINT office_ads_billing_model_check CHECK (billing_model IN ('cpc','cpm'));
CREATE INDEX IF NOT EXISTS idx_wallet_tx_ad ON wallet_transactions(ad_id, created_at DESC);


-- Multi-currency FX rates and cached conversions
CREATE TABLE IF NOT EXISTS currency_rates (
  base_currency VARCHAR(10) NOT NULL,
  quote_currency VARCHAR(10) NOT NULL,
  rate NUMERIC(20,10) NOT NULL CHECK (rate > 0),
  source VARCHAR(60) NOT NULL DEFAULT 'manual',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_currency, quote_currency)
);
CREATE INDEX IF NOT EXISTS idx_currency_rates_fetched ON currency_rates(fetched_at DESC);


-- Saved searches and in-app property alerts
CREATE TABLE IF NOT EXISTS saved_searches (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL DEFAULT 'property_match',
  title VARCHAR(220) NOT NULL,
  body TEXT NOT NULL,
  property_id BIGINT REFERENCES properties(id) ON DELETE CASCADE,
  saved_search_id BIGINT REFERENCES saved_searches(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON user_notifications(user_id, is_read, created_at DESC);


-- Multi-channel saved-search notification preferences and push subscriptions
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS notification_channels JSONB NOT NULL DEFAULT '{"in_app":true,"push":false,"email":false,"whatsapp":false}'::jsonb;
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  saved_search_id BIGINT REFERENCES saved_searches(id) ON DELETE SET NULL,
  property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  provider VARCHAR(40),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON notification_deliveries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_sources (
  id BIGSERIAL PRIMARY KEY,
  platform VARCHAR(30) NOT NULL CHECK (platform IN ('facebook','instagram')),
  name VARCHAR(180) NOT NULL,
  page_id VARCHAR(120),
  account_id VARCHAR(120),
  page_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_sources_platform_id ON market_sources(platform, COALESCE(page_id, account_id, page_url));

CREATE TABLE IF NOT EXISTS market_listings (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT REFERENCES market_sources(id) ON DELETE SET NULL,
  platform VARCHAR(30) NOT NULL,
  external_id VARCHAR(180) NOT NULL,
  external_url TEXT,
  advertiser_name VARCHAR(180),
  title VARCHAR(300),
  description TEXT,
  phone VARCHAR(80),
  whatsapp VARCHAR(80),
  city VARCHAR(120),
  district VARCHAR(120),
  property_type VARCHAR(80),
  listing_mode VARCHAR(30),
  price NUMERIC(18,2),
  currency VARCHAR(10),
  area NUMERIC(12,2),
  rooms INTEGER,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','published','duplicate')),
  property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_market_listings_status ON market_listings(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_source ON market_listings(source_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS market_ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT REFERENCES market_sources(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'running',
  fetched_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

-- V18 Hotel booking engine
CREATE TABLE IF NOT EXISTS hotels (
  id BIGSERIAL PRIMARY KEY,
  office_id BIGINT REFERENCES offices(id) ON DELETE SET NULL,
  owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(220) NOT NULL,
  slug VARCHAR(240) UNIQUE NOT NULL,
  city VARCHAR(120) NOT NULL,
  district VARCHAR(120),
  address TEXT,
  description TEXT,
  star_rating NUMERIC(2,1) NOT NULL DEFAULT 0,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  check_in_time VARCHAR(10) DEFAULT '14:00',
  check_out_time VARCHAR(10) DEFAULT '12:00',
  cancellation_policy TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','inactive','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotels_city_status ON hotels(city,status);
CREATE TABLE IF NOT EXISTS hotel_rooms (
  id BIGSERIAL PRIMARY KEY,
  hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  room_type VARCHAR(80) NOT NULL,
  description TEXT,
  max_guests INTEGER NOT NULL DEFAULT 2,
  bed_type VARCHAR(120),
  size_m2 NUMERIC(10,2),
  price NUMERIC(18,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  quantity INTEGER NOT NULL DEFAULT 1,
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_rooms_hotel ON hotel_rooms(hotel_id,status);
CREATE TABLE IF NOT EXISTS hotel_bookings (
  id BIGSERIAL PRIMARY KEY,
  booking_code VARCHAR(40) UNIQUE NOT NULL,
  hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE RESTRICT,
  room_id BIGINT NOT NULL REFERENCES hotel_rooms(id) ON DELETE RESTRICT,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  guest_name VARCHAR(180) NOT NULL,
  guest_email VARCHAR(220),
  guest_phone VARCHAR(80) NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  rooms_count INTEGER NOT NULL DEFAULT 1,
  nights INTEGER NOT NULL,
  unit_price NUMERIC(18,2) NOT NULL,
  subtotal NUMERIC(18,2) NOT NULL,
  service_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  total NUMERIC(18,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  payment_method VARCHAR(40) NOT NULL DEFAULT 'pay_at_hotel',
  payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  status VARCHAR(30) NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','cancelled','completed','no_show')),
  cancellation_deadline DATE,
  special_requests TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(check_out > check_in), CHECK(adults >= 1), CHECK(children >= 0), CHECK(rooms_count >= 1), CHECK(nights >= 1)
);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_room_dates ON hotel_bookings(room_id,check_in,check_out,status);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_user ON hotel_bookings(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS hotel_reviews (
  id BIGSERIAL PRIMARY KEY,
  hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  booking_id BIGINT REFERENCES hotel_bookings(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  guest_name VARCHAR(180),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title VARCHAR(180),
  body TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK(status IN ('pending','published','hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_reviews_hotel ON hotel_reviews(hotel_id,status,created_at DESC);

-- V19 Hotel partner dashboard
CREATE TABLE IF NOT EXISTS hotel_room_rates (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES hotel_rooms(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  price NUMERIC(18,2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  min_nights INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(end_date > start_date), CHECK(price >= 0), CHECK(min_nights >= 1)
);
CREATE INDEX IF NOT EXISTS idx_hotel_room_rates_room_dates ON hotel_room_rates(room_id,start_date,end_date);
CREATE TABLE IF NOT EXISTS hotel_promotions (
  id BIGSERIAL PRIMARY KEY,
  hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(end_date > start_date), CHECK(discount_percent >= 0 AND discount_percent <= 100)
);
CREATE INDEX IF NOT EXISTS idx_hotel_promotions_hotel_dates ON hotel_promotions(hotel_id,start_date,end_date,active);
CREATE TABLE IF NOT EXISTS hotel_availability_blocks (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES hotel_rooms(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  reason VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(end_date > start_date), CHECK(quantity >= 1)
);
CREATE INDEX IF NOT EXISTS idx_hotel_blocks_room_dates ON hotel_availability_blocks(room_id,start_date,end_date);

-- V20 hotel finance, cancellation and booking audit
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS platform_commission_rate NUMERIC(6,3) NOT NULL DEFAULT 0;
ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS net_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
CREATE TABLE IF NOT EXISTS hotel_booking_events (
 id BIGSERIAL PRIMARY KEY, booking_id BIGINT NOT NULL REFERENCES hotel_bookings(id) ON DELETE CASCADE,
 event_type VARCHAR(40) NOT NULL, note TEXT, actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_booking_events_booking ON hotel_booking_events(booking_id,created_at DESC);
CREATE TABLE IF NOT EXISTS hotel_invoices (
 id BIGSERIAL PRIMARY KEY, booking_id BIGINT NOT NULL REFERENCES hotel_bookings(id) ON DELETE CASCADE,
 invoice_number VARCHAR(80) UNIQUE NOT NULL, gross_amount NUMERIC(14,2) NOT NULL, commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
 net_amount NUMERIC(14,2) NOT NULL, currency VARCHAR(8) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'issued', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_invoices_booking ON hotel_invoices(booking_id);

-- V22 Official OTA Channel Manager
CREATE TABLE IF NOT EXISTS hotel_channel_mappings (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
 room_id BIGINT NOT NULL REFERENCES hotel_rooms(id) ON DELETE CASCADE,
 provider VARCHAR(30) NOT NULL CHECK(provider IN ('booking','agoda','expedia')),
 external_hotel_id VARCHAR(120) NOT NULL, external_room_id VARCHAR(120) NOT NULL, external_rate_plan_id VARCHAR(120) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, last_synced_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(provider,external_hotel_id,external_room_id,external_rate_plan_id)
);
CREATE INDEX IF NOT EXISTS idx_hotel_channel_mappings_hotel ON hotel_channel_mappings(hotel_id,provider,is_active);
CREATE TABLE IF NOT EXISTS hotel_external_reservations (
 id BIGSERIAL PRIMARY KEY, provider VARCHAR(30) NOT NULL CHECK(provider IN ('booking','agoda','expedia')),
 external_booking_id VARCHAR(180) NOT NULL, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE, room_id BIGINT REFERENCES hotel_rooms(id) ON DELETE SET NULL,
 local_booking_id BIGINT REFERENCES hotel_bookings(id) ON DELETE SET NULL, status VARCHAR(40) NOT NULL DEFAULT 'confirmed', payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(provider,external_booking_id)
);
CREATE INDEX IF NOT EXISTS idx_hotel_external_reservations_hotel ON hotel_external_reservations(hotel_id,provider,status);
CREATE TABLE IF NOT EXISTS hotel_channel_sync_runs (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE, run_type VARCHAR(30) NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'running', started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ,
 sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, error_message TEXT
);
CREATE TABLE IF NOT EXISTS hotel_channel_sync_items (
 id BIGSERIAL PRIMARY KEY, run_id BIGINT NOT NULL REFERENCES hotel_channel_sync_runs(id) ON DELETE CASCADE,
 mapping_id BIGINT NOT NULL REFERENCES hotel_channel_mappings(id) ON DELETE CASCADE, start_date DATE NOT NULL, end_date DATE NOT NULL,
 inventory INTEGER NOT NULL DEFAULT 0, price NUMERIC(18,2) NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL, error_message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_channel_sync_runs_hotel ON hotel_channel_sync_runs(hotel_id,started_at DESC);

-- V23 Automatic OTA catalog discovery and mapping suggestions
CREATE TABLE IF NOT EXISTS hotel_channel_catalog (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
 provider VARCHAR(30) NOT NULL CHECK(provider IN ('booking','agoda','expedia')),
 external_hotel_id VARCHAR(120) NOT NULL, external_room_id VARCHAR(120), external_rate_plan_id VARCHAR(120),
 room_name VARCHAR(255), rate_plan_name VARCHAR(255), max_guests INTEGER, raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(provider,external_hotel_id,external_room_id,external_rate_plan_id)
);
CREATE INDEX IF NOT EXISTS idx_hotel_channel_catalog_hotel ON hotel_channel_catalog(hotel_id,provider);


-- V24 Full Hotel OTA Onboarding
CREATE TABLE IF NOT EXISTS hotel_channel_onboardings (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
 provider VARCHAR(30) NOT NULL CHECK(provider IN ('booking','agoda','expedia')),
 external_hotel_id VARCHAR(120), status VARCHAR(40) NOT NULL DEFAULT 'not_started',
 credentials_ok BOOLEAN NOT NULL DEFAULT FALSE, property_ok BOOLEAN NOT NULL DEFAULT FALSE, catalog_ok BOOLEAN NOT NULL DEFAULT FALSE, mappings_ok BOOLEAN NOT NULL DEFAULT FALSE, initial_sync_ok BOOLEAN NOT NULL DEFAULT FALSE,
 discovered_count INTEGER NOT NULL DEFAULT 0, mapped_count INTEGER NOT NULL DEFAULT 0, warning_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_result JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(hotel_id,provider)
);
CREATE INDEX IF NOT EXISTS idx_hotel_channel_onboardings_hotel ON hotel_channel_onboardings(hotel_id,provider);
CREATE TABLE IF NOT EXISTS hotel_channel_onboarding_runs (
 id BIGSERIAL PRIMARY KEY, onboarding_id BIGINT NOT NULL REFERENCES hotel_channel_onboardings(id) ON DELETE CASCADE,
 status VARCHAR(30) NOT NULL DEFAULT 'running', current_step VARCHAR(60), total_items INTEGER NOT NULL DEFAULT 0, completed_items INTEGER NOT NULL DEFAULT 0, failed_items INTEGER NOT NULL DEFAULT 0,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ, error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_hotel_channel_onboarding_runs ON hotel_channel_onboarding_runs(onboarding_id,started_at DESC);


-- V26 OTA financial reconciliation and settlement ledger
CREATE TABLE IF NOT EXISTS hotel_ota_financials (
 id BIGSERIAL PRIMARY KEY, provider VARCHAR(30) NOT NULL CHECK(provider IN ('booking','agoda','expedia')),
 hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE, external_booking_id VARCHAR(180) NOT NULL,
 local_booking_id BIGINT REFERENCES hotel_bookings(id) ON DELETE SET NULL, currency VARCHAR(10) NOT NULL DEFAULT 'USD',
 gross_amount NUMERIC(18,2) NOT NULL DEFAULT 0, commission_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 charges_amount NUMERIC(18,2) NOT NULL DEFAULT 0, taxes_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 payout_amount NUMERIC(18,2) NOT NULL DEFAULT 0, amount_to_collect NUMERIC(18,2) NOT NULL DEFAULT 0,
 payout_status VARCHAR(40) NOT NULL DEFAULT 'unknown', payment_method VARCHAR(60),
 source_payload JSONB NOT NULL DEFAULT '{}'::jsonb, last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(provider,external_booking_id)
);
CREATE INDEX IF NOT EXISTS idx_hotel_ota_financials_hotel ON hotel_ota_financials(hotel_id,provider,last_synced_at DESC);
CREATE TABLE IF NOT EXISTS hotel_ota_settlements (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE, provider VARCHAR(30) NOT NULL,
 period_start DATE NOT NULL, period_end DATE NOT NULL, currency VARCHAR(10) NOT NULL, gross_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 commission_amount NUMERIC(18,2) NOT NULL DEFAULT 0, charges_amount NUMERIC(18,2) NOT NULL DEFAULT 0, taxes_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 payout_amount NUMERIC(18,2) NOT NULL DEFAULT 0, amount_to_collect NUMERIC(18,2) NOT NULL DEFAULT 0, status VARCHAR(30) NOT NULL DEFAULT 'open',
 notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(hotel_id,provider,period_start,period_end,currency)
);
CREATE TABLE IF NOT EXISTS hotel_ota_financial_events (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE, provider VARCHAR(30) NOT NULL,
 external_booking_id VARCHAR(180), event_type VARCHAR(50) NOT NULL, amount NUMERIC(18,2), currency VARCHAR(10), payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_ota_fin_events_hotel ON hotel_ota_financial_events(hotel_id,created_at DESC);


-- V27 hotel payment collection, invoice and payout reconciliation
CREATE TABLE IF NOT EXISTS hotel_payment_ledger (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
 local_booking_id BIGINT REFERENCES hotel_bookings(id) ON DELETE SET NULL,
 ota_financial_id BIGINT REFERENCES hotel_ota_financials(id) ON DELETE SET NULL,
 provider VARCHAR(30) NOT NULL DEFAULT 'direct', external_booking_id VARCHAR(180),
 entry_type VARCHAR(40) NOT NULL CHECK(entry_type IN ('guest_charge','guest_payment','ota_payout_expected','ota_payout_received','commission','fee','tax','refund','adjustment')),
 direction VARCHAR(10) NOT NULL CHECK(direction IN ('debit','credit')), amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 currency VARCHAR(10) NOT NULL DEFAULT 'USD', reference VARCHAR(180), payment_method VARCHAR(60), status VARCHAR(30) NOT NULL DEFAULT 'posted',
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), notes TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_payment_ledger_hotel ON hotel_payment_ledger(hotel_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS hotel_payment_invoices (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
 local_booking_id BIGINT REFERENCES hotel_bookings(id) ON DELETE SET NULL, ota_financial_id BIGINT REFERENCES hotel_ota_financials(id) ON DELETE SET NULL,
 invoice_number VARCHAR(60) NOT NULL UNIQUE, provider VARCHAR(30) NOT NULL DEFAULT 'direct', external_booking_id VARCHAR(180),
 currency VARCHAR(10) NOT NULL DEFAULT 'USD', gross_amount NUMERIC(18,2) NOT NULL DEFAULT 0, commission_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 fees_amount NUMERIC(18,2) NOT NULL DEFAULT 0, taxes_amount NUMERIC(18,2) NOT NULL DEFAULT 0, expected_payout NUMERIC(18,2) NOT NULL DEFAULT 0,
 received_payout NUMERIC(18,2) NOT NULL DEFAULT 0, guest_collect_expected NUMERIC(18,2) NOT NULL DEFAULT 0, guest_collected NUMERIC(18,2) NOT NULL DEFAULT 0,
 payout_variance NUMERIC(18,2) NOT NULL DEFAULT 0, collection_variance NUMERIC(18,2) NOT NULL DEFAULT 0,
 status VARCHAR(30) NOT NULL DEFAULT 'open', due_date DATE, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(provider,external_booking_id)
);
CREATE INDEX IF NOT EXISTS idx_hotel_payment_invoices_hotel ON hotel_payment_invoices(hotel_id,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS hotel_payment_alerts (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE, invoice_id BIGINT REFERENCES hotel_payment_invoices(id) ON DELETE CASCADE,
 alert_type VARCHAR(40) NOT NULL, severity VARCHAR(20) NOT NULL DEFAULT 'warning', message TEXT NOT NULL, amount NUMERIC(18,2), currency VARCHAR(10),
 resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(invoice_id,alert_type)
);

-- V29 hotel payouts and settlement cycles
CREATE TABLE IF NOT EXISTS hotel_payout_cycles (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
 period_start DATE NOT NULL, period_end DATE NOT NULL, currency VARCHAR(10) NOT NULL DEFAULT 'USD',
 gross_amount NUMERIC(18,2) NOT NULL DEFAULT 0, platform_commission NUMERIC(18,2) NOT NULL DEFAULT 0,
 adjustments NUMERIC(18,2) NOT NULL DEFAULT 0, payout_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','processing','paid','rejected','cancelled')),
 frequency VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK(frequency IN ('weekly','monthly','manual')),
 bank_reference VARCHAR(180), payment_method VARCHAR(60), notes TEXT,
 approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ,
 paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(hotel_id,period_start,period_end,currency)
);
CREATE INDEX IF NOT EXISTS idx_hotel_payout_cycles_status ON hotel_payout_cycles(status,period_end DESC);
CREATE TABLE IF NOT EXISTS hotel_payout_events (
 id BIGSERIAL PRIMARY KEY, payout_id BIGINT NOT NULL REFERENCES hotel_payout_cycles(id) ON DELETE CASCADE,
 event_type VARCHAR(40) NOT NULL, actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- V30 automatic payout scheduling, batch payments and central accounting
CREATE TABLE IF NOT EXISTS hotel_payout_settings (
 hotel_id BIGINT PRIMARY KEY REFERENCES hotels(id) ON DELETE CASCADE,
 frequency VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK(frequency IN ('weekly','monthly')),
 weekday SMALLINT NOT NULL DEFAULT 1 CHECK(weekday BETWEEN 0 AND 6),
 month_day SMALLINT NOT NULL DEFAULT 1 CHECK(month_day BETWEEN 1 AND 28),
 auto_generate BOOLEAN NOT NULL DEFAULT TRUE, require_clean_reconciliation BOOLEAN NOT NULL DEFAULT TRUE,
 variance_tolerance NUMERIC(18,2) NOT NULL DEFAULT 0.01, hold_days INTEGER NOT NULL DEFAULT 0,
 last_generated_through DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hotel_payout_batches (
 id BIGSERIAL PRIMARY KEY, batch_code VARCHAR(60) NOT NULL UNIQUE, currency VARCHAR(10) NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','processing','paid','failed','cancelled')),
 total_amount NUMERIC(18,2) NOT NULL DEFAULT 0, payout_count INTEGER NOT NULL DEFAULT 0,
 approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ, paid_at TIMESTAMPTZ,
 bank_reference VARCHAR(180), notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hotel_payout_batch_items (
 batch_id BIGINT NOT NULL REFERENCES hotel_payout_batches(id) ON DELETE CASCADE,
 payout_id BIGINT NOT NULL UNIQUE REFERENCES hotel_payout_cycles(id) ON DELETE RESTRICT,
 amount NUMERIC(18,2) NOT NULL, PRIMARY KEY(batch_id,payout_id)
);
CREATE TABLE IF NOT EXISTS hotel_accounting_ledger (
 id BIGSERIAL PRIMARY KEY, hotel_id BIGINT REFERENCES hotels(id) ON DELETE SET NULL,
 payout_id BIGINT REFERENCES hotel_payout_cycles(id) ON DELETE SET NULL, batch_id BIGINT REFERENCES hotel_payout_batches(id) ON DELETE SET NULL,
 entry_type VARCHAR(40) NOT NULL, direction VARCHAR(10) NOT NULL CHECK(direction IN ('debit','credit')),
 amount NUMERIC(18,2) NOT NULL, currency VARCHAR(10) NOT NULL, reference VARCHAR(180), metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_accounting_ledger_created ON hotel_accounting_ledger(created_at DESC);


-- V31 integrated platform accounting
CREATE TABLE IF NOT EXISTS platform_expenses (
 id BIGSERIAL PRIMARY KEY, expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
 category VARCHAR(80) NOT NULL DEFAULT 'تشغيل', vendor VARCHAR(180), description TEXT,
 amount NUMERIC(18,2) NOT NULL CHECK(amount>=0), tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(tax_amount>=0),
 currency VARCHAR(10) NOT NULL DEFAULT 'USD', payment_method VARCHAR(60), reference VARCHAR(180),
 status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK(status IN ('draft','posted','void')),
 created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_expenses_date ON platform_expenses(expense_date DESC);

-- V32 electronic invoicing
CREATE TABLE IF NOT EXISTS electronic_invoices (
 id BIGSERIAL PRIMARY KEY, invoice_number VARCHAR(60) NOT NULL UNIQUE,
 document_type VARCHAR(20) NOT NULL DEFAULT 'invoice' CHECK(document_type IN ('invoice','credit_note','debit_note')),
 source_type VARCHAR(30) NOT NULL DEFAULT 'manual', source_id BIGINT,
 customer_type VARCHAR(30) NOT NULL DEFAULT 'customer', customer_id BIGINT,
 customer_name VARCHAR(180) NOT NULL, customer_tax_number VARCHAR(80), customer_email VARCHAR(180),
 currency VARCHAR(10) NOT NULL DEFAULT 'SAR', subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
 tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0, total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'issued' CHECK(status IN ('draft','issued','partially_paid','paid','void')),
 issue_date DATE NOT NULL DEFAULT CURRENT_DATE, due_date DATE, parent_invoice_id BIGINT REFERENCES electronic_invoices(id) ON DELETE SET NULL,
 notes TEXT, qr_payload TEXT, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_electronic_invoices_date ON electronic_invoices(issue_date DESC,status);
CREATE TABLE IF NOT EXISTS electronic_invoice_items (
 id BIGSERIAL PRIMARY KEY, invoice_id BIGINT NOT NULL REFERENCES electronic_invoices(id) ON DELETE CASCADE,
 description TEXT NOT NULL, quantity NUMERIC(12,3) NOT NULL DEFAULT 1, unit_price NUMERIC(18,2) NOT NULL DEFAULT 0,
 tax_rate NUMERIC(8,4) NOT NULL DEFAULT 0, line_subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
 line_tax NUMERIC(18,2) NOT NULL DEFAULT 0, line_total NUMERIC(18,2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS electronic_invoice_payments (
 id BIGSERIAL PRIMARY KEY, invoice_id BIGINT NOT NULL REFERENCES electronic_invoices(id) ON DELETE CASCADE,
 amount NUMERIC(18,2) NOT NULL CHECK(amount>0), payment_method VARCHAR(50), reference VARCHAR(180),
 paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- V33 automatic invoicing for platform operations
ALTER TABLE electronic_invoices ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE electronic_invoices ADD COLUMN IF NOT EXISTS source_reference VARCHAR(180);
CREATE UNIQUE INDEX IF NOT EXISTS uq_electronic_invoice_source ON electronic_invoices(source_type,source_id) WHERE source_id IS NOT NULL AND document_type='invoice';
CREATE TABLE IF NOT EXISTS automatic_invoice_runs (
 id BIGSERIAL PRIMARY KEY, trigger_type VARCHAR(40) NOT NULL DEFAULT 'manual',
 scanned_count INTEGER NOT NULL DEFAULT 0, created_count INTEGER NOT NULL DEFAULT 0,
 skipped_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
 details JSONB NOT NULL DEFAULT '{}'::jsonb, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- V35 property intelligence / AI-assisted analytics
CREATE TABLE IF NOT EXISTS property_ai_scores (
 property_id BIGINT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
 estimated_price NUMERIC(18,2), price_per_sqm NUMERIC(18,2), market_price_per_sqm NUMERIC(18,2),
 price_gap_pct NUMERIC(10,2), valuation_confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
 pricing_label VARCHAR(30), duplicate_risk NUMERIC(5,2) NOT NULL DEFAULT 0,
 duplicate_property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
 recommendation_score NUMERIC(8,2) NOT NULL DEFAULT 0, signals JSONB NOT NULL DEFAULT '{}'::jsonb,
 calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_ai_pricing ON property_ai_scores(pricing_label,price_gap_pct);
CREATE INDEX IF NOT EXISTS idx_property_ai_duplicate ON property_ai_scores(duplicate_risk DESC);

-- V36 market intelligence snapshots
CREATE TABLE IF NOT EXISTS property_market_snapshots (
 id BIGSERIAL PRIMARY KEY, scope_type VARCHAR(20) NOT NULL CHECK(scope_type IN ('city','district')),
 city VARCHAR(100) NOT NULL, district VARCHAR(150), mode VARCHAR(30) NOT NULL,
 property_type VARCHAR(80), listings_count INTEGER NOT NULL DEFAULT 0,
 median_price_per_sqm NUMERIC(16,2), avg_price_per_sqm NUMERIC(16,2),
 demand_score NUMERIC(6,2), investment_score NUMERIC(6,2),
 price_trend_pct NUMERIC(9,2), snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
 UNIQUE(scope_type,city,district,mode,property_type,snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_area ON property_market_snapshots(city,district,snapshot_date DESC);

-- V38 automatic geocoding and map coverage
CREATE TABLE IF NOT EXISTS property_geocoding_jobs (
 id BIGSERIAL PRIMARY KEY, property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
 query_text TEXT NOT NULL, provider VARCHAR(40) NOT NULL DEFAULT 'nominatim',
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','success','failed','manual')),
 latitude NUMERIC(10,7), longitude NUMERIC(10,7), confidence NUMERIC(5,2),
 provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb, error_message TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, processed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_geocoding_latest ON property_geocoding_jobs(property_id);
CREATE INDEX IF NOT EXISTS idx_property_geocoding_status ON property_geocoding_jobs(status,updated_at DESC);

-- V39 advanced geographic property search
CREATE TABLE IF NOT EXISTS property_search_areas (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name VARCHAR(160) NOT NULL, polygon JSONB, center_lat NUMERIC(10,7), center_lng NUMERIC(10,7),
 radius_km NUMERIC(8,2), commute_minutes INTEGER, commute_mode VARCHAR(20), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_search_areas_user ON property_search_areas(user_id,created_at DESC);

-- V40 Personal property recommendation engine
CREATE TABLE IF NOT EXISTS user_property_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('view','favorite','inquiry','recommendation_click','dismiss')),
  weight NUMERIC(8,2) NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_property_events_user ON user_property_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_property_events_property ON user_property_events(property_id, event_type);

CREATE TABLE IF NOT EXISTS user_recommendation_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  signal_count INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 0,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_recommendation_impressions (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  score NUMERIC(8,2) NOT NULL DEFAULT 0,
  reason TEXT,
  shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clicked_at TIMESTAMPTZ,
  PRIMARY KEY(user_id, property_id)
);

-- V41 conversational property assistant
CREATE TABLE IF NOT EXISTS property_assistant_sessions (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 session_token VARCHAR(80), last_query TEXT, parsed_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
 result_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_assistant_user ON property_assistant_sessions(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS property_assistant_messages (
 id BIGSERIAL PRIMARY KEY, session_id BIGINT NOT NULL REFERENCES property_assistant_sessions(id) ON DELETE CASCADE,
 role VARCHAR(12) NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- V42 full property advisor
CREATE TABLE IF NOT EXISTS property_advisor_comparisons (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 property_ids JSONB NOT NULL DEFAULT '[]'::jsonb, assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
 result JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_advisor_user ON property_advisor_comparisons(user_id,created_at DESC);

-- V43 ChatGPT-managed platform audit/usage
CREATE TABLE IF NOT EXISTS chatgpt_requests (
 id BIGSERIAL PRIMARY KEY,
 actor_key VARCHAR(120) NOT NULL,
 user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 user_role VARCHAR(30) NOT NULL DEFAULT 'guest',
 model VARCHAR(100), input_chars INTEGER NOT NULL DEFAULT 0,
 tool_names TEXT[] NOT NULL DEFAULT '{}',
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
 latency_ms INTEGER NOT NULL DEFAULT 0,
 status VARCHAR(20) NOT NULL DEFAULT 'ok', error_message TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chatgpt_requests_actor_day ON chatgpt_requests(actor_key,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatgpt_requests_created ON chatgpt_requests(created_at DESC);

-- V44 ChatGPT operational manager
CREATE TABLE IF NOT EXISTS ai_operations_runs (
 id BIGSERIAL PRIMARY KEY, trigger_type VARCHAR(30) NOT NULL DEFAULT 'manual',
 summary JSONB NOT NULL DEFAULT '{}'::jsonb, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ai_operations_alerts (
 id BIGSERIAL PRIMARY KEY, category VARCHAR(30) NOT NULL, severity VARCHAR(20) NOT NULL DEFAULT 'info',
 entity_type VARCHAR(40), entity_id BIGINT, title VARCHAR(220) NOT NULL, message TEXT NOT NULL,
 suggested_action VARCHAR(80), payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved','dismissed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_ops_alerts_status ON ai_operations_alerts(status,severity,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_ops_open_entity ON ai_operations_alerts(category,entity_type,entity_id,suggested_action) WHERE status='open' AND entity_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS ai_operations_audit_log (
 id BIGSERIAL PRIMARY KEY, actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 actor_type VARCHAR(30) NOT NULL DEFAULT 'admin', action VARCHAR(100) NOT NULL,
 entity_type VARCHAR(40), entity_id BIGINT, before_state JSONB, after_state JSONB,
 confirmation_text TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_ops_audit_created ON ai_operations_audit_log(created_at DESC);

-- V45 AI sales agent 24/7
CREATE TABLE IF NOT EXISTS ai_sales_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  visitor_key VARCHAR(180),
  name VARCHAR(140), phone VARCHAR(40), email VARCHAR(255),
  intent JSONB NOT NULL DEFAULT '{}'::jsonb,
  qualification_score INTEGER NOT NULL DEFAULT 0,
  qualification_label VARCHAR(30) NOT NULL DEFAULT 'new',
  lead_id BIGINT REFERENCES office_leads(id) ON DELETE SET NULL,
  office_id BIGINT REFERENCES offices(id) ON DELETE SET NULL,
  assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_sales_sessions_status ON ai_sales_sessions(status,last_message_at DESC);
CREATE TABLE IF NOT EXISTS ai_sales_messages (
 id BIGSERIAL PRIMARY KEY, session_id BIGINT NOT NULL REFERENCES ai_sales_sessions(id) ON DELETE CASCADE,
 role VARCHAR(20) NOT NULL, content TEXT NOT NULL, metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_sales_messages_session ON ai_sales_messages(session_id,created_at);
CREATE TABLE IF NOT EXISTS ai_sales_handoffs (
 id BIGSERIAL PRIMARY KEY, session_id BIGINT NOT NULL REFERENCES ai_sales_sessions(id) ON DELETE CASCADE,
 lead_id BIGINT REFERENCES office_leads(id) ON DELETE SET NULL, office_id BIGINT REFERENCES offices(id) ON DELETE SET NULL,
 assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL, reason TEXT, score INTEGER, status VARCHAR(30) NOT NULL DEFAULT 'assigned',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- V46 omnichannel AI sales / WhatsApp
CREATE TABLE IF NOT EXISTS ai_sales_channels (
 id BIGSERIAL PRIMARY KEY, channel VARCHAR(30) NOT NULL, external_user_id VARCHAR(180) NOT NULL,
 sales_session_id BIGINT REFERENCES ai_sales_sessions(id) ON DELETE SET NULL, display_name VARCHAR(180),
 last_inbound_at TIMESTAMPTZ, last_outbound_at TIMESTAMPTZ, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(channel,external_user_id)
);
CREATE TABLE IF NOT EXISTS ai_channel_events (
 id BIGSERIAL PRIMARY KEY, channel VARCHAR(30) NOT NULL, external_event_id VARCHAR(255) NOT NULL,
 event_type VARCHAR(60), payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(channel,external_event_id)
);


-- V47 automatic AI customer follow-up
CREATE TABLE IF NOT EXISTS ai_followup_jobs (
 id BIGSERIAL PRIMARY KEY, session_id BIGINT NOT NULL REFERENCES ai_sales_sessions(id) ON DELETE CASCADE,
 job_type VARCHAR(40) NOT NULL, property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
 run_at TIMESTAMPTZ NOT NULL, reason TEXT, status VARCHAR(30) NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 result JSONB, last_error TEXT, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_followup_pending ON ai_followup_jobs(session_id,job_type,property_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_ai_followup_due ON ai_followup_jobs(status,run_at);

-- V48 AI viewing appointments
ALTER TABLE office_appointments ADD COLUMN IF NOT EXISTS ai_sales_session_id BIGINT REFERENCES ai_sales_sessions(id) ON DELETE SET NULL;
ALTER TABLE office_appointments ADD COLUMN IF NOT EXISTS confirmation_token VARCHAR(80);
ALTER TABLE office_appointments ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(30) NOT NULL DEFAULT 'pending';
ALTER TABLE office_appointments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE office_appointments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE office_appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_office_appointments_confirmation_token ON office_appointments(confirmation_token) WHERE confirmation_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_viewing_appointments ON office_appointments(ai_sales_session_id,starts_at DESC) WHERE ai_sales_session_id IS NOT NULL;

-- V49 AI post-viewing feedback, objections and negotiation pipeline
CREATE TABLE IF NOT EXISTS ai_viewing_feedback (
 id BIGSERIAL PRIMARY KEY,
 appointment_id BIGINT NOT NULL REFERENCES office_appointments(id) ON DELETE CASCADE,
 session_id BIGINT REFERENCES ai_sales_sessions(id) ON DELETE SET NULL,
 lead_id BIGINT REFERENCES office_leads(id) ON DELETE SET NULL,
 property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
 rating INTEGER CHECK (rating BETWEEN 1 AND 5),
 interest_level VARCHAR(30) NOT NULL DEFAULT 'unknown',
 liked TEXT[] NOT NULL DEFAULT '{}', objections TEXT[] NOT NULL DEFAULT '{}', notes TEXT,
 wants_alternatives BOOLEAN NOT NULL DEFAULT FALSE, ready_to_negotiate BOOLEAN NOT NULL DEFAULT FALSE,
 proposed_amount NUMERIC(18,2), currency VARCHAR(10), source VARCHAR(30) NOT NULL DEFAULT 'ai',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(appointment_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_viewing_feedback_lead ON ai_viewing_feedback(lead_id,created_at DESC);
CREATE TABLE IF NOT EXISTS ai_post_viewing_jobs (
 id BIGSERIAL PRIMARY KEY, appointment_id BIGINT NOT NULL REFERENCES office_appointments(id) ON DELETE CASCADE,
 job_type VARCHAR(40) NOT NULL DEFAULT 'request_feedback', run_at TIMESTAMPTZ NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 result JSONB, last_error TEXT, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_post_viewing_pending ON ai_post_viewing_jobs(appointment_id,job_type) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_ai_post_viewing_due ON ai_post_viewing_jobs(status,run_at);

-- V50 AI negotiation manager: offers, counteroffers and approval-ready deal drafts
CREATE TABLE IF NOT EXISTS negotiation_offers (
 id BIGSERIAL PRIMARY KEY, deal_id BIGINT NOT NULL REFERENCES office_deals(id) ON DELETE CASCADE,
 offered_by VARCHAR(20) NOT NULL CHECK (offered_by IN ('buyer','seller','office')),
 amount NUMERIC(18,2) NOT NULL CHECK (amount>0), currency VARCHAR(10) NOT NULL DEFAULT 'USD',
 offer_type VARCHAR(20) NOT NULL DEFAULT 'offer' CHECK (offer_type IN ('offer','counteroffer')),
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','withdrawn','superseded')),
 terms JSONB NOT NULL DEFAULT '{}'::jsonb, notes TEXT, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), responded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_negotiation_offers_deal ON negotiation_offers(deal_id,created_at DESC);
CREATE TABLE IF NOT EXISTS negotiation_agreements (
 id BIGSERIAL PRIMARY KEY, deal_id BIGINT NOT NULL UNIQUE REFERENCES office_deals(id) ON DELETE CASCADE,
 accepted_offer_id BIGINT REFERENCES negotiation_offers(id) ON DELETE SET NULL,
 agreed_amount NUMERIC(18,2) NOT NULL, currency VARCHAR(10) NOT NULL DEFAULT 'USD', terms JSONB NOT NULL DEFAULT '{}'::jsonb,
 platform_commission_rate NUMERIC(5,2) NOT NULL, platform_commission NUMERIC(18,2) NOT NULL,
 commission_payer VARCHAR(20) NOT NULL DEFAULT 'seller', approval_status VARCHAR(30) NOT NULL DEFAULT 'awaiting_approval',
 approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ, contract_snapshot JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS negotiation_events (
 id BIGSERIAL PRIMARY KEY, deal_id BIGINT NOT NULL REFERENCES office_deals(id) ON DELETE CASCADE,
 actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, event_type VARCHAR(60) NOT NULL, payload JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_negotiation_events_deal ON negotiation_events(deal_id,created_at DESC);

-- V51 electronic contracts and consent-signature audit trail
CREATE TABLE IF NOT EXISTS electronic_contracts (
 id BIGSERIAL PRIMARY KEY, contract_number VARCHAR(80) NOT NULL UNIQUE,
 deal_id BIGINT NOT NULL UNIQUE REFERENCES office_deals(id) ON DELETE CASCADE,
 agreement_id BIGINT REFERENCES negotiation_agreements(id) ON DELETE SET NULL,
 office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
 lead_id BIGINT REFERENCES office_leads(id) ON DELETE SET NULL, property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
 contract_type VARCHAR(20) NOT NULL CHECK(contract_type IN ('sale','lease')), currency VARCHAR(10) NOT NULL,
 amount NUMERIC(18,2) NOT NULL, platform_commission_rate NUMERIC(5,2) NOT NULL, platform_commission NUMERIC(18,2) NOT NULL,
 commission_payer VARCHAR(20) NOT NULL DEFAULT 'seller' CHECK(commission_payer='seller'), terms JSONB NOT NULL DEFAULT '{}'::jsonb,
 contract_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
 status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','partially_signed','signed','finalized','void')),
 sent_at TIMESTAMPTZ, fully_signed_at TIMESTAMPTZ, finalized_at TIMESTAMPTZ, finalized_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_econtracts_office ON electronic_contracts(office_id,created_at DESC);
CREATE TABLE IF NOT EXISTS electronic_contract_parties (
 id BIGSERIAL PRIMARY KEY, contract_id BIGINT NOT NULL REFERENCES electronic_contracts(id) ON DELETE CASCADE,
 party_role VARCHAR(20) NOT NULL CHECK(party_role IN ('buyer','seller','tenant','landlord','office')), name VARCHAR(180) NOT NULL,
 email VARCHAR(255), phone VARCHAR(50), status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','signed','declined')),
 sign_token VARCHAR(80) NOT NULL UNIQUE, reviewed_at TIMESTAMPTZ, signed_at TIMESTAMPTZ, signature_name VARCHAR(180), signature_ip VARCHAR(100), signature_user_agent TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_econtract_parties_contract ON electronic_contract_parties(contract_id);
CREATE TABLE IF NOT EXISTS electronic_contract_events (
 id BIGSERIAL PRIMARY KEY, contract_id BIGINT NOT NULL REFERENCES electronic_contracts(id) ON DELETE CASCADE,
 actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, event_type VARCHAR(60) NOT NULL, payload JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_econtract_events_contract ON electronic_contract_events(contract_id,created_at DESC);

-- V52 automated deal closing after finalized electronic contract
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_status_check;
ALTER TABLE properties ADD CONSTRAINT properties_status_check CHECK (status IN ('pending','active','rejected','sold','rented'));
CREATE TABLE IF NOT EXISTS deal_closures (
 id BIGSERIAL PRIMARY KEY,
 deal_id BIGINT NOT NULL UNIQUE REFERENCES office_deals(id) ON DELETE CASCADE,
 contract_id BIGINT NOT NULL UNIQUE REFERENCES electronic_contracts(id) ON DELETE CASCADE,
 office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
 lead_id BIGINT REFERENCES office_leads(id) ON DELETE SET NULL,
 property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
 invoice_id BIGINT REFERENCES electronic_invoices(id) ON DELETE SET NULL,
 final_amount NUMERIC(18,2) NOT NULL,
 currency VARCHAR(10) NOT NULL,
 platform_commission_rate NUMERIC(5,2) NOT NULL,
 platform_commission NUMERIC(18,2) NOT NULL,
 commission_payer VARCHAR(20) NOT NULL DEFAULT 'seller' CHECK(commission_payer='seller'),
 property_final_status VARCHAR(20) NOT NULL CHECK(property_final_status IN ('sold','rented')),
 closure_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
 closed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deal_closures_office ON deal_closures(office_id,closed_at DESC);
CREATE TABLE IF NOT EXISTS deal_closure_events (
 id BIGSERIAL PRIMARY KEY, closure_id BIGINT NOT NULL REFERENCES deal_closures(id) ON DELETE CASCADE,
 actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, event_type VARCHAR(60) NOT NULL,
 payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deal_closure_events ON deal_closure_events(closure_id,created_at DESC);

-- V53 owner command center audit
CREATE TABLE IF NOT EXISTS owner_command_center_events (
 id BIGSERIAL PRIMARY KEY,
 admin_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 event_type VARCHAR(60) NOT NULL DEFAULT 'view',
 payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_owner_command_center_events_created ON owner_command_center_events(created_at DESC);

-- Fields used by geocoding and property updates.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Membership follows the existing owner/user office assignment model.
CREATE OR REPLACE VIEW office_members AS
SELECT id AS user_id,office_id,'active'::text AS status FROM users
WHERE is_active AND office_id IS NOT NULL AND role IN ('agent','admin')
UNION
SELECT o.owner_id AS user_id,o.id AS office_id,'active'::text AS status
FROM offices o JOIN users u ON u.id=o.owner_id WHERE u.is_active;

CREATE TABLE IF NOT EXISTS hotel_channel_reservation_runs (
 id BIGSERIAL PRIMARY KEY,
 hotel_id BIGINT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
 provider VARCHAR(30) NOT NULL CHECK(provider IN ('booking','agoda','expedia')),
 status VARCHAR(30) NOT NULL DEFAULT 'running',
 processed_count INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 finished_at TIMESTAMPTZ
);

-- Android booking retry protection; existing web bookings keep NULL keys.
ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS idempotency_key UUID;
ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_booking_idempotency ON hotel_bookings(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Manual Sham Cash hotel payments. No payment is approved by a guest submission.
CREATE TABLE IF NOT EXISTS manual_shamcash_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled BOOLEAN NOT NULL DEFAULT FALSE,
 recipient TEXT NOT NULL DEFAULT '', recipient_label VARCHAR(180) NOT NULL DEFAULT '',
 qr_url TEXT NOT NULL DEFAULT '', currency VARCHAR(3) NOT NULL DEFAULT 'SYP' CHECK(currency IN ('SYP','USD')),
 usd_to_syp_rate NUMERIC(18,6), version INTEGER NOT NULL DEFAULT 1,
 updated_by BIGINT REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO manual_shamcash_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS manual_shamcash_settings_audit (
 id BIGSERIAL PRIMARY KEY, actor_user_id BIGINT REFERENCES users(id),
 settings JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hotel_manual_payments (
 id BIGSERIAL PRIMARY KEY, booking_id BIGINT NOT NULL UNIQUE REFERENCES hotel_bookings(id),
 access_token_hash VARCHAR(64) NOT NULL, amount NUMERIC(18,2) NOT NULL CHECK(amount>0),
 currency VARCHAR(3) NOT NULL, recipient TEXT NOT NULL, recipient_label TEXT NOT NULL,
 qr_url TEXT NOT NULL DEFAULT '', settings_version INTEGER NOT NULL, exchange_rate NUMERIC(18,6),
 status VARCHAR(30) NOT NULL DEFAULT 'awaiting_transfer' CHECK(status IN ('awaiting_transfer','pending_review','approved','rejected')),
 transaction_reference VARCHAR(80), submitted_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ,
 reviewed_by BIGINT REFERENCES users(id), review_note VARCHAR(1000), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_shamcash_reference ON hotel_manual_payments(transaction_reference)
 WHERE transaction_reference IS NOT NULL AND status IN ('pending_review','approved');

ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions JSONB;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS videos JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS videos JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS admin_access_events (
 id BIGSERIAL PRIMARY KEY, actor_user_id BIGINT REFERENCES users(id), target_user_id BIGINT REFERENCES users(id),
 permissions JSONB NOT NULL, is_active BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
