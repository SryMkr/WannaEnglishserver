const WORD_BANK_LEVELS = [
    { code: 1, name: "小学", aliases: ["小学", "小学词库", "primary"] },
    { code: 2, name: "初中", aliases: ["初中", "初中单词", "junior"] },
    { code: 3, name: "高中", aliases: ["高中", "高中词汇", "senior", "highschool"] },
    { code: 4, name: "四级", aliases: ["四级", "CET4", "cet4"] },
    { code: 5, name: "六级", aliases: ["六级", "CET6", "cet6"] },
    { code: 6, name: "雅思", aliases: ["雅思", "IELTS", "ielts"] },
    { code: 7, name: "托福", aliases: ["托福", "TOEFL", "toefl"] },
    { code: 8, name: "随机", aliases: ["随机", "随意", "random"] }
];

const RANDOM_WORD_BANK_NAMES = new Set(["", "随意", "随机", "random"]);
const UNPOPULATED_WORD_BANK_NAMES = new Set(["雅思", "托福"]);

const aliasToLevel = new Map();
for (const level of WORD_BANK_LEVELS) {
    for (const alias of level.aliases) {
        aliasToLevel.set(normalizeKey(alias), level);
    }
}

function normalizeKey(value) {
    return value == null ? "" : String(value).trim().toLowerCase();
}

function normalizeWordBank(wordBank) {
    const key = normalizeKey(wordBank);
    if (RANDOM_WORD_BANK_NAMES.has(key)) {
        return null;
    }

    const level = aliasToLevel.get(key);
    return level ? level.name : String(wordBank).trim();
}

function getWordBankLevelCode(wordBank) {
    const key = normalizeKey(wordBank);
    if (RANDOM_WORD_BANK_NAMES.has(key)) {
        return null;
    }

    const level = aliasToLevel.get(key);
    if (level && UNPOPULATED_WORD_BANK_NAMES.has(level.name)) {
        return null;
    }

    return level ? level.code : null;
}

function getWordBankRank(wordBank) {
    const levelCode = getWordBankLevelCode(wordBank);
    return levelCode == null ? -1 : levelCode - 1;
}

function resolveSharedWordBank(leftWordBank, rightWordBank) {
    const left = normalizeWordBank(leftWordBank);
    const right = normalizeWordBank(rightWordBank);

    if (!left && !right) {
        return { compatible: true, matchedWordBank: null };
    }

    if (!left) {
        return { compatible: true, matchedWordBank: right };
    }

    if (!right) {
        return { compatible: true, matchedWordBank: left };
    }

    if (left === right) {
        return { compatible: true, matchedWordBank: left };
    }

    const leftRank = getWordBankRank(left);
    const rightRank = getWordBankRank(right);
    if (leftRank >= 0 && rightRank >= 0) {
        return {
            compatible: true,
            matchedWordBank: WORD_BANK_LEVELS[Math.min(leftRank, rightRank)].name
        };
    }

    return { compatible: false, matchedWordBank: null };
}

module.exports = {
    WORD_BANK_LEVELS,
    getWordBankLevelCode,
    normalizeWordBank,
    resolveSharedWordBank
};
