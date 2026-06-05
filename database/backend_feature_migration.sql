-- 后端功能优化结构脚本
-- 只处理业务表：匹配、自选词、模式进入、教程状态、远程配置事件。
-- 不删除、不重建、不改写单词基础表：
-- vocabulary, vocabulary_level_relation, prefix_code, root_code, suffix_code, language_level_code

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

SELECT 'matchmaking_ticket' AS table_name, COUNT(*) AS row_count FROM matchmaking_ticket;
SELECT 'matchmaking_room' AS table_name, COUNT(*) AS row_count FROM matchmaking_room;
SELECT 'user_custom_training_word' AS table_name, COUNT(*) AS row_count FROM user_custom_training_word;
SELECT 'user_mode_entry_event' AS table_name, COUNT(*) AS row_count FROM user_mode_entry_event;
SELECT 'user_tutorial_state' AS table_name, COUNT(*) AS row_count FROM user_tutorial_state;
SELECT 'remote_config_event' AS table_name, COUNT(*) AS row_count FROM remote_config_event;

UPDATE matchmaking_ticket
SET allow_bot_fallback = 0
WHERE status = 'waiting'
  AND allow_bot_fallback <> 0;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'matchmaking_ticket'
              AND INDEX_NAME = 'idx_matchmaking_ticket_waiting_order'
        ),
        'SELECT 1',
        'ALTER TABLE matchmaking_ticket ADD INDEX idx_matchmaking_ticket_waiting_order (status, created_at, user_id, word_bank)'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DELETE uctw
FROM user_custom_training_word uctw
INNER JOIN (
    SELECT user_id, word_id
    FROM (
        SELECT user_id,
               word_id,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY sort_order ASC, updated_at DESC, word_id ASC) AS row_no
        FROM user_custom_training_word
    ) ranked_words
    WHERE row_no > 7
) over_limit
    ON over_limit.user_id = uctw.user_id
   AND over_limit.word_id = uctw.word_id;
