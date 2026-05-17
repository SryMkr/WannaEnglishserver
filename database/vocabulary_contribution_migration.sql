CREATE TABLE IF NOT EXISTS vocabulary_contribution (
    contribution_id BIGINT NOT NULL AUTO_INCREMENT,
    submitter_user_id BIGINT NOT NULL,
    submitter_user_name VARCHAR(64) DEFAULT NULL,
    submission_type ENUM('new_word', 'correction') NOT NULL,
    target_word VARCHAR(64) DEFAULT NULL,
    word_form VARCHAR(64) NOT NULL,
    phonetic JSON NOT NULL,
    language_levels JSON NOT NULL,
    word_type VARCHAR(32) NOT NULL,
    detail JSON NOT NULL,
    structure JSON DEFAULT NULL,
    origin TEXT DEFAULT NULL,
    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    resubmission_count INT NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (contribution_id),
    KEY idx_vocabulary_contribution_submitter_status (submitter_user_id, status, updated_at),
    KEY idx_vocabulary_contribution_status_updated (status, updated_at),
    KEY idx_vocabulary_contribution_word_form (word_form),
    CONSTRAINT fk_vocabulary_contribution_submitter
        FOREIGN KEY (submitter_user_id) REFERENCES user_profile (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS vocabulary_contribution_review (
    review_id BIGINT NOT NULL AUTO_INCREMENT,
    contribution_id BIGINT NOT NULL,
    reviewer_user_id BIGINT NOT NULL,
    reviewer_user_name VARCHAR(64) DEFAULT NULL,
    decision ENUM('approved', 'rejected') NOT NULL,
    note VARCHAR(300) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (review_id),
    KEY idx_vocabulary_contribution_review_contribution (contribution_id, created_at),
    KEY idx_vocabulary_contribution_review_reviewer (reviewer_user_id, created_at),
    CONSTRAINT fk_vocabulary_contribution_review_contribution
        FOREIGN KEY (contribution_id) REFERENCES vocabulary_contribution (contribution_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_vocabulary_contribution_review_reviewer
        FOREIGN KEY (reviewer_user_id) REFERENCES user_profile (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
