const db = require("../config/db");
const { getWordBankLevelCode, normalizeWordBank } = require("./wordBankService");

const RANDOM_ID_ATTEMPTS = Math.max(1, Number(process.env.WORD_SELECTION_RANDOM_ID_ATTEMPTS) || 8);

function buildVocabularySelectSql(selectColumns) {
    return `SELECT ${selectColumns}
            FROM vocabulary v
            WHERE v.word_id >= ?
            ORDER BY v.word_id
            LIMIT 1`;
}

function buildLevelSelectSql(selectColumns, comparator) {
    return `SELECT ${selectColumns}
            FROM vocabulary v
            INNER JOIN vocabulary_level_relation vlr ON vlr.word_id = v.word_id
            WHERE JSON_CONTAINS(vlr.language_level_codes, ?, '$')
              AND v.word_id ${comparator} ?
            ORDER BY v.word_id ${comparator === ">=" ? "ASC" : "DESC"}
            LIMIT 1`;
}

async function queryMinMaxWordId(executor, levelCode) {
    if (levelCode != null) {
        const [rows] = await executor.execute(
            `SELECT MIN(v.word_id) AS min_id, MAX(v.word_id) AS max_id
             FROM vocabulary v
             INNER JOIN vocabulary_level_relation vlr ON vlr.word_id = v.word_id
             WHERE JSON_CONTAINS(vlr.language_level_codes, ?, '$')`,
            [String(levelCode)]
        );
        return rows[0] || null;
    }

    const [rows] = await executor.execute(
        "SELECT MIN(word_id) AS min_id, MAX(word_id) AS max_id FROM vocabulary"
    );
    return rows[0] || null;
}

function randomIntInclusive(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function queryNearestWord(executor, selectColumns, levelCode, targetId) {
    if (levelCode != null) {
        const [forwardRows] = await executor.execute(
            buildLevelSelectSql(selectColumns, ">="),
            [String(levelCode), targetId]
        );
        if (forwardRows.length > 0) {
            return forwardRows[0];
        }

        const [backwardRows] = await executor.execute(
            buildLevelSelectSql(selectColumns, "<="),
            [String(levelCode), targetId]
        );
        return backwardRows[0] || null;
    }

    const [rows] = await executor.execute(
        buildVocabularySelectSql(selectColumns),
        [targetId]
    );
    return rows[0] || null;
}

async function pickRandomWordRow(options = {}) {
    const {
        wordBank = null,
        executor = db,
        selectColumns = "word_id, word_form"
    } = options;

    const normalizedWordBank = normalizeWordBank(wordBank);
    const levelCode = getWordBankLevelCode(normalizedWordBank);
    const bounds = await queryMinMaxWordId(executor, levelCode);
    const minId = Number(bounds?.min_id || 0);
    const maxId = Number(bounds?.max_id || 0);

    if (!Number.isInteger(minId) || !Number.isInteger(maxId) || minId <= 0 || maxId < minId) {
        return null;
    }

    let selectedRow = null;
    for (let attempt = 0; attempt < RANDOM_ID_ATTEMPTS && selectedRow == null; attempt++) {
        selectedRow = await queryNearestWord(
            executor,
            selectColumns,
            levelCode,
            randomIntInclusive(minId, maxId)
        );
    }

    return selectedRow || await queryNearestWord(executor, selectColumns, levelCode, minId);
}

async function pickRandomWordForm(wordBank, executor = db) {
    const row = await pickRandomWordRow({
        wordBank,
        executor,
        selectColumns: "v.word_form"
    });
    return row?.word_form || null;
}

async function pickRandomStudyWord(wordBank, executor = db) {
    return await pickRandomWordRow({
        wordBank,
        executor,
        selectColumns: "v.word_id, v.word_form, v.phonetic, v.detail, v.origin, v.word_type, v.structure"
    });
}

module.exports = {
    pickRandomStudyWord,
    pickRandomWordForm
};
