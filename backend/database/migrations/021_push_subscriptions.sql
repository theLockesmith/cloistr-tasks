-- 021_push_subscriptions.sql
--
-- Browser push subscriptions for board activity notifications (card
-- created, card moved, comment added). One row per browser/device
-- subscription; a user can have several (multiple browsers/devices).
--
-- endpoint is UNIQUE and doubles as the natural upsert key: re-subscribing
-- the same browser (e.g. after a permission re-grant) updates the existing
-- row's keys instead of creating a duplicate.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id            SERIAL PRIMARY KEY,
    user_pubkey   VARCHAR(64) NOT NULL,
    endpoint      TEXT NOT NULL UNIQUE,
    p256dh        TEXT NOT NULL,
    auth          TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON push_subscriptions (user_pubkey);

COMMENT ON TABLE push_subscriptions IS 'Browser push subscriptions (Web Push API) keyed by endpoint, one row per browser/device';
COMMENT ON COLUMN push_subscriptions.endpoint IS 'Push service endpoint URL — unique per browser subscription, used as the upsert key';
COMMENT ON COLUMN push_subscriptions.p256dh IS 'Subscription public key (base64url), from PushSubscription.getKey("p256dh")';
COMMENT ON COLUMN push_subscriptions.auth IS 'Subscription auth secret (base64url), from PushSubscription.getKey("auth")';
