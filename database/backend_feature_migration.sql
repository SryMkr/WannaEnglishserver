-- WannaEnglishserver backend feature migration
-- Usage: mysql -u <user> -p <database> < database/backend_feature_migration.sql
--
-- Scope:
-- 1. Business tables only: matchmaking, custom training words, mode entry, tutorial state, remote config events.
-- 2. Protected word-base tables are not deleted, rebuilt, or rewritten:
--    vocabulary, vocabulary_level_relation, prefix_code, root_code, suffix_code, language_level_code.
-- 3. Idempotent for production: safe to run more than once.

CREATE TABLE IF NOT EXISTS matchmaking_room (
    room_id VARCHAR(64) PRIMARY KEY,
    room_status VARCHAR(16) NOT NULL DEFAULT 'matched',
    word_bank VARCHAR(32) NULL,
    matched_word VARCHAR(64) NOT NULL,
    match_round_no INT NOT NULL DEFAULT 1,
    opponent_type VARCHAR(16) NOT NULL,
    user1_id BIGINT NOT NULL,
    user2_id BIGINT NULL,
    user1_last_seen_at DATETIME(3) NULL,
    user2_last_seen_at DATETIME(3) NULL,
    user1_rematch_round_no INT NOT NULL DEFAULT 0,
    user2_rematch_round_no INT NOT NULL DEFAULT 0,
    rematch_requested_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    matched_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NULL,
    KEY idx_matchmaking_room_status_time (room_status, matched_at),
    KEY idx_matchmaking_room_user1_time (user1_id, matched_at),
    KEY idx_matchmaking_room_user2_time (user2_id, matched_at),
    CONSTRAINT fk_matchmaking_room_user1 FOREIGN KEY (user1_id) REFERENCES user_profile(user_id),
    CONSTRAINT fk_matchmaking_room_user2 FOREIGN KEY (user2_id) REFERENCES user_profile(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matchmaking_ticket (
    ticket_id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    word_bank VARCHAR(32) NULL,
    matched_word_bank VARCHAR(32) NULL,
    allow_bot_fallback TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL,
    fallback_at DATETIME(3) NOT NULL,
    room_id VARCHAR(64) NULL,
    opponent_type VARCHAR(16) NULL,
    opponent_user_id BIGINT NULL,
    opponent_nickname VARCHAR(64) NULL,
    matched_word VARCHAR(64) NULL,
    match_round_no INT NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    resolved_at DATETIME(3) NULL,
    cancelled_at DATETIME(3) NULL,
    KEY idx_matchmaking_ticket_user_status (user_id, status, created_at),
    KEY idx_matchmaking_ticket_status_time (status, fallback_at, created_at),
    KEY idx_matchmaking_ticket_room (room_id),
    CONSTRAINT fk_matchmaking_ticket_user FOREIGN KEY (user_id) REFERENCES user_profile(user_id),
    CONSTRAINT fk_matchmaking_ticket_opponent_user FOREIGN KEY (opponent_user_id) REFERENCES user_profile(user_id),
    CONSTRAINT fk_matchmaking_ticket_room FOREIGN KEY (room_id) REFERENCES matchmaking_room(room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS friend_room (
    invite_id VARCHAR(64) PRIMARY KEY,
    room_code VARCHAR(8) NOT NULL,
    host_user_id BIGINT NOT NULL,
    guest_user_id BIGINT NULL,
    word_bank VARCHAR(32) NULL,
    language_level_code INT NOT NULL DEFAULT 0,
    host_ready TINYINT(1) NOT NULL DEFAULT 0,
    guest_ready TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'waiting',
    match_room_id VARCHAR(64) NULL,
    match_round_no INT NOT NULL DEFAULT 1,
    host_ticket_id VARCHAR(64) NULL,
    guest_ticket_id VARCHAR(64) NULL,
    matched_word VARCHAR(64) NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_friend_room_code (room_code),
    KEY idx_friend_room_host_status (host_user_id, status, created_at),
    KEY idx_friend_room_guest_status (guest_user_id, status, created_at),
    KEY idx_friend_room_status_expires (status, expires_at),
    CONSTRAINT fk_friend_room_host FOREIGN KEY (host_user_id) REFERENCES user_profile(user_id),
    CONSTRAINT fk_friend_room_guest FOREIGN KEY (guest_user_id) REFERENCES user_profile(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_custom_training_word (
    user_id BIGINT NOT NULL,
    word_id INT NOT NULL,
    sort_order TINYINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, word_id),
    UNIQUE KEY uk_user_custom_training_word_order (user_id, sort_order),
    CONSTRAINT user_custom_training_word_fk_user FOREIGN KEY (user_id) REFERENCES user_profile(user_id),
    CONSTRAINT user_custom_training_word_fk_word FOREIGN KEY (word_id) REFERENCES vocabulary(word_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_mode_entry_event (
    event_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    entry_mode VARCHAR(32) NOT NULL,
    word_bank VARCHAR(32) NULL,
    source VARCHAR(64) NULL,
    client_time DATETIME(6) NULL,
    detail_json JSON NULL,
    created_at DATETIME(6) NOT NULL,
    KEY idx_user_mode_entry_user_time (user_id, created_at),
    KEY idx_user_mode_entry_mode_time (entry_mode, created_at),
    CONSTRAINT fk_user_mode_entry_user FOREIGN KEY (user_id) REFERENCES user_profile(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_tutorial_state (
    user_id BIGINT NOT NULL,
    tutorial_key VARCHAR(96) NOT NULL,
    status VARCHAR(16) NOT NULL,
    version VARCHAR(32) NULL,
    updated_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (user_id, tutorial_key),
    KEY idx_user_tutorial_state_status (status, updated_at),
    CONSTRAINT fk_user_tutorial_state_user FOREIGN KEY (user_id) REFERENCES user_profile(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS remote_config_event (
    event_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NULL,
    event_name VARCHAR(64) NOT NULL,
    resource_badge VARCHAR(32) NOT NULL DEFAULT 'prod',
    fallback TINYINT(1) NOT NULL DEFAULT 0,
    source VARCHAR(32) NULL,
    reason VARCHAR(255) NULL,
    app_version VARCHAR(64) NULL,
    release_id VARCHAR(64) NULL,
    platform VARCHAR(64) NULL,
    device_model VARCHAR(128) NULL,
    os_version VARCHAR(64) NULL,
    duration_ms INT NULL,
    detail_json JSON NULL,
    created_at DATETIME(6) NOT NULL,
    KEY idx_remote_config_event_badge_time (resource_badge, created_at),
    KEY idx_remote_config_event_user_time (user_id, created_at),
    KEY idx_remote_config_event_name_time (event_name, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_study_session_summary (
    session_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user1_id BIGINT NOT NULL,
    user2_id BIGINT NULL,
    word_id INT NOT NULL,
    play_mode VARCHAR(32) NULL,
    match_ticket_id VARCHAR(64) NULL,
    match_room_id VARCHAR(64) NULL,
    match_round_no INT NOT NULL DEFAULT 1,
    matchmaking_opponent_user_id BIGINT NULL,
    matchmaking_opponent_type VARCHAR(16) NULL,
    matchmaking_opponent_name VARCHAR(64) NULL,
    actual_word_bank VARCHAR(32) NULL,
    player1_card VARCHAR(50) NULL,
    player2_card VARCHAR(50) NULL,
    first_player INT NULL,
    winner_user_id BIGINT NULL,
    duration INT NULL,
    game_status TINYINT NULL,
    played_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_user_study_session_user_time (user1_id, played_at),
    KEY idx_user_study_session_word_time (word_id, played_at),
    KEY idx_user_study_session_match_room (match_room_id, played_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Older friend_room tables may be missing either linkage or base lifecycle
-- fields. CREATE TABLE IF NOT EXISTS does not add missing columns.
SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'invite_id'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN invite_id VARCHAR(64) NULL FIRST')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'room_code'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN room_code VARCHAR(8) NULL AFTER invite_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'host_user_id'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN host_user_id BIGINT NULL AFTER room_code')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'guest_user_id'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN guest_user_id BIGINT NULL AFTER host_user_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'word_bank'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN word_bank VARCHAR(32) NULL AFTER guest_user_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'language_level_code'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN language_level_code INT NOT NULL DEFAULT 0 AFTER word_bank')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'host_ready'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN host_ready TINYINT(1) NOT NULL DEFAULT 0 AFTER language_level_code')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'guest_ready'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN guest_ready TINYINT(1) NOT NULL DEFAULT 0 AFTER host_ready')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'status'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT ''waiting'' AFTER guest_ready')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'friend_room'
          AND COLUMN_NAME = 'match_room_id'
    ),
        'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN match_room_id VARCHAR(64) NULL AFTER status')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'friend_room'
          AND COLUMN_NAME = 'match_round_no'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN match_round_no INT NOT NULL DEFAULT 1 AFTER match_room_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'friend_room'
          AND COLUMN_NAME = 'host_ticket_id'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN host_ticket_id VARCHAR(64) NULL AFTER match_round_no')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'friend_room'
          AND COLUMN_NAME = 'guest_ticket_id'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN guest_ticket_id VARCHAR(64) NULL AFTER host_ticket_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'friend_room'
          AND COLUMN_NAME = 'matched_word'
    ),
        'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN matched_word VARCHAR(64) NULL AFTER guest_ticket_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'expires_at'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN expires_at DATETIME(3) NULL AFTER matched_word')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'created_at'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER expires_at')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND COLUMN_NAME = 'updated_at'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD COLUMN updated_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'friend_room' AND INDEX_NAME = 'uk_friend_room_invite'
    ), 'SELECT 1',
        'ALTER TABLE friend_room ADD UNIQUE INDEX uk_friend_room_invite (invite_id)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'friend_room'
          AND INDEX_NAME = 'uk_friend_room_code'
    ),
        'SELECT 1',
        'ALTER TABLE friend_room ADD UNIQUE INDEX uk_friend_room_code (room_code)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'friend_room'
          AND INDEX_NAME = 'idx_friend_room_host_status'
    ),
        'SELECT 1',
        'ALTER TABLE friend_room ADD INDEX idx_friend_room_host_status (host_user_id, status, created_at)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'friend_room'
          AND INDEX_NAME = 'idx_friend_room_guest_status'
    ),
        'SELECT 1',
        'ALTER TABLE friend_room ADD INDEX idx_friend_room_guest_status (guest_user_id, status, created_at)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'friend_room'
          AND INDEX_NAME = 'idx_friend_room_status_expires'
    ),
        'SELECT 1',
        'ALTER TABLE friend_room ADD INDEX idx_friend_room_status_expires (status, expires_at)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Existing-table column backfill. CREATE TABLE IF NOT EXISTS does not add missing columns.
SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_room' AND COLUMN_NAME = 'match_round_no'),
        'SELECT 1',
        'ALTER TABLE matchmaking_room ADD COLUMN match_round_no INT NOT NULL DEFAULT 1 AFTER matched_word')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_study_session_summary'
              AND COLUMN_NAME = 'user2_id'
              AND IS_NULLABLE = 'YES'
        ),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary MODIFY COLUMN user2_id BIGINT NULL'
    )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_room' AND COLUMN_NAME = 'user1_last_seen_at'),
        'SELECT 1',
        'ALTER TABLE matchmaking_room ADD COLUMN user1_last_seen_at DATETIME(3) NULL AFTER user2_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_room' AND COLUMN_NAME = 'user2_last_seen_at'),
        'SELECT 1',
        'ALTER TABLE matchmaking_room ADD COLUMN user2_last_seen_at DATETIME(3) NULL AFTER user1_last_seen_at')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_room' AND COLUMN_NAME = 'user1_rematch_round_no'),
        'SELECT 1',
        'ALTER TABLE matchmaking_room ADD COLUMN user1_rematch_round_no INT NOT NULL DEFAULT 0 AFTER user2_last_seen_at')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_room' AND COLUMN_NAME = 'user2_rematch_round_no'),
        'SELECT 1',
        'ALTER TABLE matchmaking_room ADD COLUMN user2_rematch_round_no INT NOT NULL DEFAULT 0 AFTER user1_rematch_round_no')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_room' AND COLUMN_NAME = 'rematch_requested_at'),
        'SELECT 1',
        'ALTER TABLE matchmaking_room ADD COLUMN rematch_requested_at DATETIME(3) NULL AFTER user2_rematch_round_no')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_ticket' AND COLUMN_NAME = 'matched_word_bank'),
        'SELECT 1',
        'ALTER TABLE matchmaking_ticket ADD COLUMN matched_word_bank VARCHAR(32) NULL AFTER word_bank')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_ticket' AND COLUMN_NAME = 'allow_bot_fallback'),
        'SELECT 1',
        'ALTER TABLE matchmaking_ticket ADD COLUMN allow_bot_fallback TINYINT(1) NOT NULL DEFAULT 0 AFTER matched_word_bank')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_ticket' AND COLUMN_NAME = 'match_round_no'),
        'SELECT 1',
        'ALTER TABLE matchmaking_ticket ADD COLUMN match_round_no INT NOT NULL DEFAULT 1 AFTER matched_word')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND COLUMN_NAME = 'play_mode'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN play_mode VARCHAR(32) NULL AFTER word_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND COLUMN_NAME = 'match_ticket_id'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN match_ticket_id VARCHAR(64) NULL AFTER play_mode')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND COLUMN_NAME = 'match_room_id'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN match_room_id VARCHAR(64) NULL AFTER match_ticket_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND COLUMN_NAME = 'match_round_no'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN match_round_no INT NOT NULL DEFAULT 1 AFTER match_room_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND COLUMN_NAME = 'matchmaking_opponent_user_id'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN matchmaking_opponent_user_id BIGINT NULL AFTER match_room_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND COLUMN_NAME = 'matchmaking_opponent_type'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN matchmaking_opponent_type VARCHAR(16) NULL AFTER matchmaking_opponent_user_id')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND COLUMN_NAME = 'matchmaking_opponent_name'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN matchmaking_opponent_name VARCHAR(64) NULL AFTER matchmaking_opponent_type')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND COLUMN_NAME = 'actual_word_bank'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN actual_word_bank VARCHAR(32) NULL AFTER matchmaking_opponent_name')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND COLUMN_NAME = 'winner_user_id'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN winner_user_id BIGINT NULL AFTER first_player')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Keep the fallback flag default disabled without rewriting existing tickets.
SET @sql = (
    SELECT IF(
        COLUMN_DEFAULT = '0',
        'SELECT 1',
        'ALTER TABLE matchmaking_ticket ALTER COLUMN allow_bot_fallback SET DEFAULT 0'
    )
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'matchmaking_ticket'
      AND COLUMN_NAME = 'allow_bot_fallback'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Indexes for human waiting queue and existing lookup paths.
SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_ticket' AND INDEX_NAME = 'idx_matchmaking_ticket_waiting_order'),
        'SELECT 1',
        'ALTER TABLE matchmaking_ticket ADD INDEX idx_matchmaking_ticket_waiting_order (status, created_at, user_id, word_bank)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_ticket' AND INDEX_NAME = 'idx_matchmaking_ticket_status_time'),
        'SELECT 1',
        'ALTER TABLE matchmaking_ticket ADD INDEX idx_matchmaking_ticket_status_time (status, fallback_at, created_at)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matchmaking_ticket' AND INDEX_NAME = 'idx_matchmaking_ticket_user_status'),
        'SELECT 1',
        'ALTER TABLE matchmaking_ticket ADD INDEX idx_matchmaking_ticket_user_status (user_id, status, created_at)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND INDEX_NAME = 'idx_competitive_leaderboard_filter'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD INDEX idx_competitive_leaderboard_filter (play_mode, game_status, actual_word_bank, played_at, winner_user_id)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_study_session_summary' AND INDEX_NAME = 'idx_competitive_leaderboard_room'),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD INDEX idx_competitive_leaderboard_room (match_room_id, played_at)')
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'after:matchmaking_ticket' AS table_name, COUNT(*) AS row_count FROM matchmaking_ticket;
SELECT 'after:matchmaking_room' AS table_name, COUNT(*) AS row_count FROM matchmaking_room;
SELECT 'after:friend_room' AS table_name, COUNT(*) AS row_count FROM friend_room;
SELECT 'after:user_custom_training_word' AS table_name, COUNT(*) AS row_count FROM user_custom_training_word;
SELECT 'after:user_mode_entry_event' AS table_name, COUNT(*) AS row_count FROM user_mode_entry_event;
SELECT 'after:user_tutorial_state' AS table_name, COUNT(*) AS row_count FROM user_tutorial_state;
SELECT 'after:remote_config_event' AS table_name, COUNT(*) AS row_count FROM remote_config_event;
