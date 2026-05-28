const CHINA_TIME_ZONE = "Asia/Shanghai";
const CHINA_TIME_ZONE_OFFSET = "+08:00";

const chinaDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
});

function toValidDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getChinaParts(value = new Date()) {
    const date = toValidDate(value);
    if (!date) {
        return null;
    }

    const parts = {};
    for (const part of chinaDateTimeFormatter.formatToParts(date)) {
        if (part.type !== "literal") {
            parts[part.type] = part.value;
        }
    }
    return parts;
}

function normalizeFractionDigits(fractionDigits) {
    return Math.min(6, Math.max(0, Number(fractionDigits) || 0));
}

function formatFraction(milliseconds, fractionDigits) {
    const digits = normalizeFractionDigits(fractionDigits);
    if (digits === 0) {
        return "";
    }

    const microseconds = String(Math.max(0, Number(milliseconds) || 0) * 1000).padStart(6, "0");
    return `.${microseconds.slice(0, digits)}`;
}

function formatChinaDate(value = new Date()) {
    const parts = getChinaParts(value);
    if (!parts) {
        return null;
    }

    return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatChinaDateTime(value = new Date(), fractionDigits = 0) {
    const date = toValidDate(value);
    if (!date) {
        return null;
    }

    const parts = getChinaParts(date);
    if (!parts) {
        return null;
    }

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}${formatFraction(date.getMilliseconds(), fractionDigits)}`;
}

function formatChinaIsoDateTime(value = new Date(), fractionDigits = 3) {
    const dateTime = formatChinaDateTime(value, fractionDigits);
    return dateTime ? `${dateTime.replace(" ", "T")}${CHINA_TIME_ZONE_OFFSET}` : null;
}

function normalizeLocalDateTimeString(value, fractionDigits = 6) {
    const trimmed = String(value).trim();
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?$/);
    if (!match) {
        return null;
    }

    const digits = normalizeFractionDigits(fractionDigits);
    const fraction = digits > 0
        ? `.${String(match[3] || "0").padEnd(digits, "0").slice(0, digits)}`
        : "";
    return `${match[1]} ${match[2]}${fraction}`;
}

function normalizeToChinaDateTime(value, fractionDigits = 6) {
    if (value == null || value === "") {
        return null;
    }

    if (value instanceof Date) {
        return formatChinaDateTime(value, fractionDigits);
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
            return formatChinaDateTime(trimmed, fractionDigits);
        }

        const localDateTime = normalizeLocalDateTimeString(trimmed, fractionDigits);
        if (localDateTime) {
            return localDateTime;
        }
    }

    return formatChinaDateTime(value, fractionDigits);
}

function addDaysToDateString(dateString, days) {
    const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }

    const date = new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]) + Number(days || 0)
    ));
    return date.toISOString().slice(0, 10);
}

module.exports = {
    CHINA_TIME_ZONE,
    CHINA_TIME_ZONE_OFFSET,
    formatChinaDate,
    formatChinaDateTime,
    formatChinaIsoDateTime,
    normalizeToChinaDateTime,
    addDaysToDateString
};
