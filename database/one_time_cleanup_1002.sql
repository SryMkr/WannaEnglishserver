-- One-time cleanup for the local forgeti test database.
-- Preview only by default. Execute the DELETE section only after:
-- 1. stopping the backend;
-- 2. creating a full mysqldump backup;
-- 3. reviewing the preview counts;
-- 4. setting @confirm_cleanup = 1.
--
-- Protected vocabulary tables are never modified by this script.

SET @confirm_cleanup = 0;

SELECT 'PREVIEW' AS phase, table_name, table_rows
FROM (
    SELECT 'user_profile' AS table_name, COUNT(*) AS table_rows FROM user_profile
    UNION ALL SELECT 'action_log', COUNT(*) FROM action_log
    UNION ALL SELECT 'user_study_session_summary', COUNT(*) FROM user_study_session_summary
    UNION ALL SELECT 'matchmaking_ticket', COUNT(*) FROM matchmaking_ticket
    UNION ALL SELECT 'matchmaking_room', COUNT(*) FROM matchmaking_room
    UNION ALL SELECT 'friend_room', COUNT(*) FROM friend_room
    UNION ALL SELECT 'user_device_info', COUNT(*) FROM user_device_info
    UNION ALL SELECT 'user_daily_summary', COUNT(*) FROM user_daily_summary
    UNION ALL SELECT 'user_game_data', COUNT(*) FROM user_game_data
    UNION ALL SELECT 'user_word_progress', COUNT(*) FROM user_word_progress
    UNION ALL SELECT 'user_custom_training_word', COUNT(*) FROM user_custom_training_word
    UNION ALL SELECT 'user_mode_entry_event', COUNT(*) FROM user_mode_entry_event
    UNION ALL SELECT 'user_tutorial_state', COUNT(*) FROM user_tutorial_state
    UNION ALL SELECT 'remote_config_event', COUNT(*) FROM remote_config_event
    UNION ALL SELECT 'vocabulary_contribution_review', COUNT(*) FROM vocabulary_contribution_review
    UNION ALL SELECT 'vocabulary_contribution', COUNT(*) FROM vocabulary_contribution
    UNION ALL SELECT 'wechat_customer_service_reply_log', COUNT(*) FROM wechat_customer_service_reply_log
) counts
ORDER BY table_name;

SELECT 'PROTECTED' AS phase, table_name, table_rows
FROM (
    SELECT 'vocabulary', COUNT(*) AS table_rows FROM vocabulary
    UNION ALL SELECT 'vocabulary_language_relation', COUNT(*) FROM vocabulary_language_relation
    UNION ALL SELECT 'language_level_code', COUNT(*) FROM language_level_code
    UNION ALL SELECT 'prefix_code', COUNT(*) FROM prefix_code
    UNION ALL SELECT 'root_code', COUNT(*) FROM root_code
    UNION ALL SELECT 'suffix_code', COUNT(*) FROM suffix_code
    UNION ALL SELECT 'vocabulary_prefix_relation', COUNT(*) FROM vocabulary_prefix_relation
    UNION ALL SELECT 'vocabulary_root_relation', COUNT(*) FROM vocabulary_root_relation
    UNION ALL SELECT 'vocabulary_suffix_relation', COUNT(*) FROM vocabulary_suffix_relation
) counts
ORDER BY table_name;

SELECT 'USER_1002' AS phase, user_id, open_id
FROM user_profile
WHERE user_id = 1002;

SET @cleanup_sql = IF(
    @confirm_cleanup = 1,
    'START TRANSACTION',
    'DO 0'
);
PREPARE cleanup_stmt FROM @cleanup_sql;
EXECUTE cleanup_stmt;
DEALLOCATE PREPARE cleanup_stmt;

SET @cleanup_sql = IF(
    @confirm_cleanup = 1,
    'DELETE FROM action_log',
    'DO 0'
);
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;

SET @cleanup_sql = IF(
    @confirm_cleanup = 1,
    'DELETE FROM user_study_session_summary',
    'DO 0'
);
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;

SET @cleanup_sql = IF(
    @confirm_cleanup = 1,
    'DELETE FROM survey_suggestion WHERE response_id IN (SELECT response_id FROM survey_response WHERE user_id <> 1002 OR user_id IS NULL)',
    'DO 0'
);
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;

SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM survey_response WHERE user_id <> 1002 OR user_id IS NULL', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM matchmaking_ticket WHERE user_id <> 1002 OR user_id IS NULL', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM friend_room WHERE host_user_id <> 1002 OR (guest_user_id IS NOT NULL AND guest_user_id <> 1002)', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM matchmaking_room WHERE user1_id <> 1002 OR (user2_id IS NOT NULL AND user2_id <> 1002)', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM user_device_info', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM user_daily_summary', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM user_game_data', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM user_word_progress', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM user_custom_training_word', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM user_mode_entry_event', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM user_tutorial_state', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM remote_config_event', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM vocabulary_contribution_review', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM vocabulary_contribution', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM wechat_customer_service_reply_log', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;
SET @cleanup_sql = IF(@confirm_cleanup = 1, 'DELETE FROM user_profile WHERE user_id <> 1002', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;

SET @cleanup_sql = IF(@confirm_cleanup = 1, 'COMMIT', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;

SET @cleanup_sql = IF(@confirm_cleanup = 1, 'ALTER TABLE user_profile AUTO_INCREMENT = 1003', 'DO 0');
PREPARE cleanup_stmt FROM @cleanup_sql; EXECUTE cleanup_stmt; DEALLOCATE PREPARE cleanup_stmt;

SELECT 'VERIFY_USERS' AS check_name, COUNT(*) AS row_count
FROM user_profile
WHERE user_id <> 1002;

SELECT 'VERIFY_1002' AS check_name, COUNT(*) AS row_count
FROM user_profile
WHERE user_id = 1002;

SELECT 'VERIFY_ORPHANS' AS check_name, COUNT(*) AS row_count
FROM user_study_session_summary s
LEFT JOIN user_profile u1 ON u1.user_id = s.user1_id
LEFT JOIN user_profile u2 ON u2.user_id = s.user2_id
WHERE u1.user_id IS NULL OR (s.user2_id IS NOT NULL AND u2.user_id IS NULL);
