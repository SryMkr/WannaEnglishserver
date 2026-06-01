const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { formatChinaDate, formatChinaIsoDateTime } = require("./timeService");

const DEFAULT_UPLOAD_ROOT = path.join(__dirname, "..", "logs", "profiler");
const MAX_STORED_BYTES = Number(process.env.PROFILER_MAX_STORED_BYTES) || 4 * 1024 * 1024;

function normalizeText(value, maxLength = 128) {
    if (value == null) {
        return null;
    }

    const text = String(value).trim();
    if (!text) {
        return null;
    }

    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function safeSegment(value, fallback) {
    const text = normalizeText(value, 80);
    if (!text) {
        return fallback;
    }

    return text.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getBodyBuffer(body) {
    if (Buffer.isBuffer(body)) {
        return body;
    }

    if (typeof body === "string") {
        return Buffer.from(body, "utf8");
    }

    if (body && typeof body === "object") {
        return Buffer.from(JSON.stringify(body), "utf8");
    }

    return Buffer.alloc(0);
}

function tryParseJson(buffer, contentType) {
    if (!buffer.length) {
        return null;
    }

    const looksJson = String(contentType || "").includes("json") || ["{", "["].includes(buffer.toString("utf8", 0, 1));
    if (!looksJson) {
        return null;
    }

    try {
        return JSON.parse(buffer.toString("utf8"));
    } catch (err) {
        return null;
    }
}

function buildMetadata({ uploadId, buffer, headers, query, ip, parsed }) {
    const now = new Date();

    return {
        upload_id: uploadId,
        received_at: formatChinaIsoDateTime(now, 3),
        ip: normalizeText(ip, 64),
        content_type: normalizeText(headers["content-type"], 128),
        user_agent: normalizeText(headers["user-agent"], 256),
        byte_length: buffer.length,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        query: {
            appid: normalizeText(query.appid, 64),
            release_id: normalizeText(query.release_id, 64),
            code_md5: normalizeText(query.code_md5, 64),
            platform: normalizeText(query.platform, 64)
        },
        summary: parsed && typeof parsed === "object"
            ? {
                top_level_keys: Array.isArray(parsed) ? [] : Object.keys(parsed).slice(0, 40),
                item_count: Array.isArray(parsed) ? parsed.length : null
            }
            : null
    };
}

async function saveProfilerUpload({ body, headers = {}, query = {}, ip = "" }) {
    const buffer = getBodyBuffer(body);
    if (buffer.length > MAX_STORED_BYTES) {
        return {
            success: false,
            stored: false,
            reason: "payload_too_large",
            max_bytes: MAX_STORED_BYTES,
            byte_length: buffer.length
        };
    }

    const now = new Date();
    const uploadId = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
    const appSegment = safeSegment(query.appid, "unknown_app");
    const daySegment = formatChinaDate(now) || "unknown_day";
    const uploadRoot = process.env.PROFILER_UPLOAD_DIR || DEFAULT_UPLOAD_ROOT;
    const targetDir = path.join(uploadRoot, daySegment, appSegment);
    const contentType = headers["content-type"];
    const parsed = tryParseJson(buffer, contentType);
    const payloadExt = parsed ? "json" : "bin";
    const payloadPath = path.join(targetDir, `${uploadId}.${payloadExt}`);
    const metadataPath = path.join(targetDir, `${uploadId}.meta.json`);
    const metadata = buildMetadata({ uploadId, buffer, headers, query, ip, parsed });

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(payloadPath, parsed ? JSON.stringify(parsed, null, 2) : buffer);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    return {
        success: true,
        stored: true,
        upload_id: uploadId,
        byte_length: buffer.length
    };
}

module.exports = {
    saveProfilerUpload
};
