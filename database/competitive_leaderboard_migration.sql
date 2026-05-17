-- 竞技模式排行榜结构升级脚本
-- 目标：不新增排行榜结果表，直接从真实对局汇总表聚合排行。
-- 需要字段：真人竞技模式、实际词库、胜者、对局时间、用户昵称/头像。

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_profile'
              AND COLUMN_NAME = 'wechat_nickname'
        ),
        'SELECT 1',
        'ALTER TABLE user_profile ADD COLUMN wechat_nickname VARCHAR(64) NULL AFTER session_key'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_profile'
              AND COLUMN_NAME = 'avatar_url'
        ),
        'SELECT 1',
        'ALTER TABLE user_profile ADD COLUMN avatar_url VARCHAR(512) NULL AFTER wechat_nickname'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'matchmaking_ticket'
              AND COLUMN_NAME = 'matched_word_bank'
        ),
        'SELECT 1',
        'ALTER TABLE matchmaking_ticket ADD COLUMN matched_word_bank VARCHAR(32) NULL AFTER word_bank'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_study_session_summary'
              AND COLUMN_NAME = 'play_mode'
        ),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN play_mode VARCHAR(32) NULL AFTER word_id'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_study_session_summary'
              AND COLUMN_NAME = 'match_room_id'
        ),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN match_room_id VARCHAR(64) NULL AFTER play_mode'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_study_session_summary'
              AND COLUMN_NAME = 'actual_word_bank'
        ),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN actual_word_bank VARCHAR(32) NULL AFTER match_room_id'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_study_session_summary'
              AND COLUMN_NAME = 'winner_user_id'
        ),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD COLUMN winner_user_id BIGINT NULL AFTER first_player'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_study_session_summary'
              AND INDEX_NAME = 'idx_competitive_leaderboard_filter'
        ),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD INDEX idx_competitive_leaderboard_filter (play_mode, game_status, actual_word_bank, played_at, winner_user_id)'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        EXISTS(
            SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_study_session_summary'
              AND INDEX_NAME = 'idx_competitive_leaderboard_room'
        ),
        'SELECT 1',
        'ALTER TABLE user_study_session_summary ADD INDEX idx_competitive_leaderboard_room (match_room_id, played_at)'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

