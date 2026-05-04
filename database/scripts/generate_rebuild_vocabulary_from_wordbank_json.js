const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const defaultWordbankDir = path.resolve(repoRoot, "..", "WannaEnglishPlay", "Document", "词库");
const defaultOutput = path.resolve(repoRoot, "database", "generated", "rebuild_vocabulary_from_wordbank_json.sql");

const levels = [
    { code: 1, name: "小学", file: "小学词库.json" },
    { code: 2, name: "初中", file: "初中单词.json" },
    { code: 3, name: "高中", file: "高中词汇.json" },
    { code: 4, name: "四级", file: "四级.json" },
    { code: 5, name: "六级", file: "六级.json" }
];

const languageLevels = [
    ...levels,
    { code: 6, name: "雅思" },
    { code: 7, name: "托福" },
    { code: 8, name: "随机" }
];

function argValue(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sqlLiteral(value) {
    if (value == null) {
        return "NULL";
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? String(value) : "NULL";
    }
    if (typeof value === "boolean") {
        return value ? "1" : "0";
    }

    return `'${String(value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "''")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")}'`;
}

function sqlJson(value) {
    return sqlLiteral(JSON.stringify(value ?? null));
}

function normalizeWord(word) {
    return String(word || "").trim().toLowerCase();
}

function chunked(rows, size) {
    const chunks = [];
    for (let index = 0; index < rows.length; index += size) {
        chunks.push(rows.slice(index, index + size));
    }
    return chunks;
}

function emitInsert(lines, table, columns, rows, chunkSize = 400) {
    if (rows.length === 0) {
        return;
    }

    for (const chunk of chunked(rows, chunkSize)) {
        lines.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES`);
        lines.push(chunk.map(row => `  (${row.join(", ")})`).join(",\n") + ";");
        lines.push("");
    }
}

function main() {
    const wordbankDir = path.resolve(argValue("--wordbank-dir", defaultWordbankDir));
    const output = path.resolve(argValue("--output", defaultOutput));

    const prefixes = loadJson(path.join(wordbankDir, "prefixes.json"));
    const roots = loadJson(path.join(wordbankDir, "roots.json"));
    const suffixes = loadJson(path.join(wordbankDir, "suffixes.json"));

    const wordsByForm = new Map();
    const skippedDuplicateWords = [];
    for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
        const level = levels[levelIndex];
        const entries = loadJson(path.join(wordbankDir, level.file));
        for (const entry of entries) {
            const word = normalizeWord(entry.word);
            if (!word) {
                continue;
            }
            const languageLevelCodes = levels
                .slice(levelIndex)
                .map(item => item.code);

            if (wordsByForm.has(word)) {
                skippedDuplicateWords.push({
                    word,
                    skippedLevel: level.name,
                    keptFromLevelCode: wordsByForm.get(word).sourceLevelCode
                });
            } else {
                wordsByForm.set(word, {
                    ...entry,
                    word,
                    sourceLevelCode: level.code,
                    languageLevelCodes
                });
            }
        }
    }

    const words = Array.from(wordsByForm.values()).sort((left, right) => left.word.localeCompare(right.word));
    const wordIdByForm = new Map(words.map((entry, index) => [entry.word, index + 1]));

    const vocabularyRows = [];
    const levelRows = [];

    for (const entry of words) {
        const wordId = wordIdByForm.get(entry.word);

        vocabularyRows.push([
            sqlLiteral(wordId),
            sqlLiteral(entry.word),
            sqlJson({ ipa: entry.ipa || "" }),
            "NULL",
            sqlJson(entry.meanings || []),
            sqlLiteral(entry.etymology || null),
            sqlLiteral(entry.wordType || "independent"),
            sqlJson(entry.structure || [])
        ]);

        levelRows.push([
            sqlLiteral(wordId),
            sqlJson(entry.languageLevelCodes)
        ]);
    }

    const lines = [];
    lines.push("SET NAMES utf8mb4;");
    lines.push("SET FOREIGN_KEY_CHECKS = 0;");
    lines.push("");

    for (const table of [
        "action_log",
        "user_study_session_summary",
        "user_test_daily_summary",
        "user_word_progress"
    ]) {
        lines.push(`TRUNCATE TABLE ${table};`);
    }
    lines.push("");

    for (const table of [
        "vocabulary_suffix_relation",
        "vocabulary_root_relation",
        "vocabulary_prefix_relation",
        "vocabulary_level_relation",
        "vocabulary_language_relation",
        "vocabulary",
        "suffix_code",
        "root_code",
        "prefix_code"
    ]) {
        lines.push(`DROP TABLE IF EXISTS ${table};`);
    }
    lines.push("");

    lines.push("DELETE FROM language_level_code WHERE language_level_code IN (1, 2, 3, 4, 5, 6, 7, 8);");
    lines.push("INSERT INTO language_level_code (language_level_code, language_level_name) VALUES");
    lines.push(languageLevels.map(item => `  (${item.code}, ${sqlLiteral(item.name)})`).join(",\n") + ";");
    lines.push("");

    lines.push(`CREATE TABLE prefix_code (
    prefix_code INT PRIMARY KEY,
    prefix_form VARCHAR(64) NOT NULL,
    prefix_cn_mean VARCHAR(255) NOT NULL,
    prefix_en_mean VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE root_code (
    root_code INT PRIMARY KEY,
    root_form VARCHAR(64) NOT NULL,
    root_cn_mean VARCHAR(255) NOT NULL,
    root_en_mean VARCHAR(255) NOT NULL,
    root_origin TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suffix_code (
    suffix_code INT PRIMARY KEY,
    suffix_form VARCHAR(64) NOT NULL,
    suffix_cn_mean VARCHAR(255) NOT NULL,
    suffix_en_mean VARCHAR(255) NOT NULL,
    suffix_func VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vocabulary (
    word_id INT NOT NULL AUTO_INCREMENT,
    word_form VARCHAR(96) NOT NULL,
    phonetic JSON DEFAULT NULL,
    audio_url VARCHAR(512) DEFAULT NULL,
    detail JSON NOT NULL,
    origin TEXT,
    word_type VARCHAR(32) NOT NULL DEFAULT 'independent',
    structure JSON DEFAULT NULL,
    PRIMARY KEY (word_id),
    UNIQUE KEY uk_vocabulary_word_form (word_form)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vocabulary_level_relation (
    word_id INT NOT NULL,
    language_level_codes JSON NOT NULL,
    PRIMARY KEY (word_id),
    CONSTRAINT vocabulary_level_relation_fk_word FOREIGN KEY (word_id) REFERENCES vocabulary (word_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    lines.push("");

    emitInsert(lines, "prefix_code", ["prefix_code", "prefix_form", "prefix_cn_mean", "prefix_en_mean"], prefixes.map(item => [
        sqlLiteral(item.id),
        sqlLiteral(item.prefix),
        sqlLiteral(item.prefixCNMeaning),
        sqlLiteral(item.prefixENMeaning)
    ]));
    emitInsert(lines, "root_code", ["root_code", "root_form", "root_cn_mean", "root_en_mean", "root_origin"], roots.map(item => [
        sqlLiteral(item.id),
        sqlLiteral(item.root),
        sqlLiteral(item.rootCNMeaning),
        sqlLiteral(item.rootENMeaning),
        sqlLiteral(item.source || null)
    ]));
    emitInsert(lines, "suffix_code", ["suffix_code", "suffix_form", "suffix_cn_mean", "suffix_en_mean", "suffix_func"], suffixes.map(item => [
        sqlLiteral(item.id),
        sqlLiteral(item.suffix),
        sqlLiteral(item.suffixCNMeaning),
        sqlLiteral(item.suffixENMeaning),
        sqlLiteral(item.function)
    ]));
    emitInsert(lines, "vocabulary", [
        "word_id",
        "word_form",
        "phonetic",
        "audio_url",
        "detail",
        "origin",
        "word_type",
        "structure"
    ], vocabularyRows);
    emitInsert(lines, "vocabulary_level_relation", ["word_id", "language_level_codes"], levelRows);

    lines.push("SET FOREIGN_KEY_CHECKS = 1;");
    lines.push("");
    lines.push(`-- vocabulary words: ${words.length}`);
    lines.push(`-- skipped duplicate words: ${skippedDuplicateWords.length}`);
    for (const item of skippedDuplicateWords) {
        lines.push(`-- skipped duplicate: ${item.word} from ${item.skippedLevel}`);
    }
    for (const level of levels) {
        const count = words.filter(item => item.languageLevelCodes.includes(level.code)).length;
        lines.push(`-- ${level.name}: ${count}`);
    }
    lines.push("");

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, lines.join("\n"), "utf8");
    console.log(`Generated ${output}`);
    console.log(`words=${words.length}`);
}

main();
