const axios = require("axios");
const db = require("../config/db");
const { formatChinaDateTime } = require("./timeService");

const UOS_BASE_URL = process.env.UOS_REMOTE_CONFIG_BASE_URL || "https://c.unity.cn";
const UOS_SETTINGS_OVERRIDES_PATH = process.env.UOS_REMOTE_CONFIG_SETTINGS_PATH || "/v1/settings/overrides";
const DEFAULT_RESOURCE_BADGE = "prod";
const RESOURCE_BADGE_KEY = "resource_badge";
const ALLOWED_RESOURCE_BADGES = new Set(["prod", "test", "rollback", "ABTest", "gray"]);
const REQUEST_TIMEOUT_MS = Number(process.env.UOS_REMOTE_CONFIG_TIMEOUT_MS) || 2500;

let schemaReady = false;

function normalizeOptionalString(value, maxLength = 255) {
    if (value == null) {
        return null;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
        return null;
    }

    return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeUserId(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeBadge(value) {
    const badge = normalizeOptionalString(value, 32);
    return badge && ALLOWED_RESOURCE_BADGES.has(badge) ? badge : DEFAULT_RESOURCE_BADGE;
}

function buildFallbackResponse(source = "fallback") {
    return {
        success: true,
        resource_badge: DEFAULT_RESOURCE_BADGE,
        source,
        fallback: true
    };
}

function buildBasicAuthHeader() {
    const appId = normalizeOptionalString(process.env.UOS_APP_ID, 128);
    const secret = normalizeOptionalString(process.env.UOS_APP_SERVICE_SECRET, 256);
    if (!appId || !secret) {
        return null;
    }

    return `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`;
}

function buildUosPayload(payload) {
    const userId = normalizeUserId(payload.user_id);
    const userIdString = userId == null ? normalizeOptionalString(payload.user_id, 64) || "anonymous" : String(userId);

    return {
        userId: userIdString,
        keys: [RESOURCE_BADGE_KEY],
        types: ["STRING"],
        attributes: {
            unity: {
                platform: normalizeOptionalString(payload.platform, 64) || "WeChat",
                osVersion: normalizeOptionalString(payload.os_version, 64),
                model: normalizeOptionalString(payload.device_model, 128)
            },
            app: {
                packageVersion: normalizeOptionalString(payload.app_version, 64),
                releaseId: normalizeOptionalString(payload.release_id, 64)
            },
            user: {
                userId: userIdString
            }
        }
    };
}

function extractBadge(responseData) {
    if (!responseData || typeof responseData !== "object") {
        return null;
    }

    const settings = responseData.settings || responseData.data?.settings || responseData.result?.settings;
    if (settings && typeof settings === "object") {
        const setting = settings[RESOURCE_BADGE_KEY];
        if (typeof setting === "string") {
            return setting;
        }

        if (setting && typeof setting === "object") {
            return setting.value ?? setting.Value ?? setting.val;
        }
    }

    const configs = responseData.configs || responseData.data?.configs || responseData.result?.configs;
    if (Array.isArray(configs)) {
        const match = configs.find((item) => item && (item.key === RESOURCE_BADGE_KEY || item.name === RESOURCE_BADGE_KEY));
        return match?.value ?? match?.Value ?? null;
    }

    return responseData[RESOURCE_BADGE_KEY] ?? null;
}

async function ensureSchema() {
    if (schemaReady) {
        return;
    }

    await db.execute(
        `CREATE TABLE IF NOT EXISTS remote_config_event (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    schemaReady = true;
}

async function insertEvent(payload) {
    await ensureSchema();

    const userId = normalizeUserId(payload.user_id);
    const durationMs = payload.duration_ms == null ? null : Number(payload.duration_ms);
    const detail = payload.detail && typeof payload.detail === "object" ? payload.detail : {};

    await db.execute(
        `INSERT INTO remote_config_event
            (user_id, event_name, resource_badge, fallback, source, reason,
             app_version, release_id, platform, device_model, os_version, duration_ms, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
        [
            userId,
            normalizeOptionalString(payload.event_name, 64) || "remote_config_event",
            normalizeBadge(payload.resource_badge),
            payload.fallback ? 1 : 0,
            normalizeOptionalString(payload.source, 32),
            normalizeOptionalString(payload.reason, 255),
            normalizeOptionalString(payload.app_version, 64),
            normalizeOptionalString(payload.release_id, 64),
            normalizeOptionalString(payload.platform, 64),
            normalizeOptionalString(payload.device_model, 128),
            normalizeOptionalString(payload.os_version, 64),
            Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : null,
            JSON.stringify(detail),
            formatChinaDateTime(new Date(), 6)
        ]
    );
}

async function resolveResourceBadge(payload) {
    const authHeader = buildBasicAuthHeader();
    if (!authHeader) {
        const fallback = buildFallbackResponse("missing_uos_credentials");
        await insertEvent({ ...payload, event_name: "remote_config_fetch_failed", resource_badge: fallback.resource_badge, fallback: true, source: fallback.source, reason: fallback.source });
        return fallback;
    }

    const startedAt = Date.now();
    try {
        const response = await axios.post(
            `${UOS_BASE_URL}${UOS_SETTINGS_OVERRIDES_PATH}`,
            buildUosPayload(payload),
            {
                timeout: REQUEST_TIMEOUT_MS,
                headers: {
                    Authorization: authHeader,
                    "Content-Type": "application/json"
                }
            }
        );

        const rawBadge = extractBadge(response.data);
        const resourceBadge = normalizeBadge(rawBadge);
        const fallback = !rawBadge || resourceBadge !== rawBadge;
        const result = {
            success: true,
            resource_badge: resourceBadge,
            source: "uos",
            fallback,
            reason: fallback ? "invalid_or_missing_badge" : null
        };

        await insertEvent({
            ...payload,
            event_name: fallback ? "remote_config_fetch_fallback" : "remote_config_fetch_success",
            resource_badge: resourceBadge,
            fallback,
            source: result.source,
            reason: result.reason,
            duration_ms: Date.now() - startedAt
        });

        return result;
    } catch (err) {
        const reason = err.response?.status ? `uos_http_${err.response.status}` : err.code || "uos_request_failed";
        const fallback = buildFallbackResponse(reason);
        await insertEvent({
            ...payload,
            event_name: "remote_config_fetch_failed",
            resource_badge: fallback.resource_badge,
            fallback: true,
            source: fallback.source,
            reason,
            duration_ms: Date.now() - startedAt
        });

        return fallback;
    }
}

async function recordRemoteConfigEvent(payload) {
    await insertEvent({
        ...payload,
        event_name: normalizeOptionalString(payload.event_name, 64) || "client_remote_config_event"
    });

    return { success: true };
}

module.exports = {
    resolveResourceBadge,
    recordRemoteConfigEvent,
    buildFallbackResponse
};
