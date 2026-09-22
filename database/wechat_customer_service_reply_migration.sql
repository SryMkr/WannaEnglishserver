-- 微信客服自动回复记录
-- 只新增独立记录表，不修改或删除现有用户数据。

CREATE TABLE IF NOT EXISTS wechat_customer_service_reply_log (
    reply_id BIGINT NOT NULL AUTO_INCREMENT,
    open_id VARCHAR(64) NOT NULL,
    reply_date DATE NOT NULL,
    status ENUM('sending', 'sent', 'failed') NOT NULL DEFAULT 'sending',
    claim_token CHAR(36) NOT NULL,
    attempt_count INT NOT NULL DEFAULT 1,
    last_error VARCHAR(500) NULL,
    claimed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    sent_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (reply_id),
    UNIQUE KEY uk_wechat_customer_service_reply_day (open_id, reply_date),
    KEY idx_wechat_customer_service_reply_status (status, claimed_at),
    KEY idx_wechat_customer_service_reply_date (reply_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
