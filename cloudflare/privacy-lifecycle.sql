-- Additive lifecycle guard; account/content deletion occurs only after user confirmation.
CREATE TABLE IF NOT EXISTS account_lifecycle(user_id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS loox_deleting_profiles BEFORE INSERT ON profiles WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_account_display_names BEFORE INSERT ON account_display_names WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_posts BEFORE INSERT ON posts WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.creator_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_collections BEFORE INSERT ON collections WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_comments BEFORE INSERT ON comments WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_post_likes BEFORE INSERT ON post_likes WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_saved_posts BEFORE INSERT ON saved_posts WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_image_uploads BEFORE INSERT ON image_uploads WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_action_windows BEFORE INSERT ON action_windows WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_follows BEFORE INSERT ON follows WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.follower_id OR user_id=NEW.creator_id) BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER IF NOT EXISTS loox_deleting_notifications BEFORE INSERT ON notifications WHEN EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=NEW.user_id OR user_id=NEW.actor_id) BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS loox_missing_post_post_likes BEFORE INSERT ON post_likes WHEN NOT EXISTS(SELECT 1 FROM posts WHERE id=NEW.post_id) BEGIN SELECT RAISE(ABORT,'post_unavailable'); END;
CREATE TRIGGER IF NOT EXISTS loox_missing_post_saved_posts BEFORE INSERT ON saved_posts WHEN NOT EXISTS(SELECT 1 FROM posts WHERE id=NEW.post_id) BEGIN SELECT RAISE(ABORT,'post_unavailable'); END;
CREATE TRIGGER IF NOT EXISTS loox_missing_post_comments BEFORE INSERT ON comments WHEN NOT EXISTS(SELECT 1 FROM posts WHERE id=NEW.post_id) BEGIN SELECT RAISE(ABORT,'post_unavailable'); END;
CREATE TRIGGER IF NOT EXISTS loox_missing_post_collection_items BEFORE INSERT ON collection_items WHEN NOT EXISTS(SELECT 1 FROM posts WHERE id=NEW.post_id) BEGIN SELECT RAISE(ABORT,'post_unavailable'); END;
