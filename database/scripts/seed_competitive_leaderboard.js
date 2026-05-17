const path = require("path");
const dotenv = require("/Users/jianshuqiao/Applications/MiniGame/WannaEnglishserver/node_modules/dotenv");
const mysql = require("/Users/jianshuqiao/Applications/MiniGame/WannaEnglishserver/node_modules/mysql2/promise");

dotenv.config({ path: "/Users/jianshuqiao/Applications/MiniGame/WannaEnglishserver/.env" });

async function ensureColumn(db, tableName, columnName, definition) {
  const [columns] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  if (columns.length === 0) {
    await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const prefix = "codex_leaderboard_seed";
  const wordBanks = ["小学", "初中", "高中", "四级", "六级"];

  await ensureColumn(db, "user_profile", "wechat_nickname", "wechat_nickname VARCHAR(64) NULL AFTER session_key");
  await ensureColumn(db, "user_profile", "avatar_url", "avatar_url VARCHAR(512) NULL AFTER wechat_nickname");

  const [wordRows] = await db.execute("SELECT word_id FROM vocabulary ORDER BY word_id LIMIT 1");
  if (!wordRows.length) {
    throw new Error("No vocabulary rows found; cannot create study sessions.");
  }

  const wordId = wordRows[0].word_id;

  await db.beginTransaction();
  try {
    const [oldUsers] = await db.execute(
      "SELECT user_id FROM user_profile WHERE open_id LIKE ?",
      [`${prefix}:%`]
    );
    const oldUserIds = oldUsers.map(row => row.user_id);

    await db.execute(
      "DELETE FROM user_study_session_summary WHERE match_room_id LIKE ?",
      [`${prefix}:%`]
    );

    if (oldUserIds.length > 0) {
      await db.execute(
        `DELETE FROM user_profile WHERE user_id IN (${oldUserIds.map(() => "?").join(",")})`,
        oldUserIds
      );
    }

    const userIds = [];
    for (let i = 1; i <= 50; i++) {
      const [result] = await db.execute(
        "INSERT INTO user_profile (open_id, session_key, wechat_nickname) VALUES (?, ?, ?)",
        [`${prefix}:user:${i}`, `${prefix}:session`, `编${i}`]
      );
      userIds.push(result.insertId);
    }

    let roomIndex = 1;
    const insertSession = async (wordBank, winnerIndex, loserIndex, duration, daysAgo = 0) => {
      const winnerId = userIds[winnerIndex - 1];
      const loserId = userIds[loserIndex - 1];
      await db.execute(
        `INSERT INTO user_study_session_summary
          (user1_id, user2_id, word_id, play_mode, match_room_id, actual_word_bank,
           player1_card, player2_card, first_player, winner_user_id, duration, game_status, played_at)
         VALUES (?, ?, ?, 'match_human', ?, ?, 'seed-a', 'seed-b', ?, ?, ?, 1, UTC_TIMESTAMP() - INTERVAL ? DAY)`,
        [
          winnerId,
          loserId,
          wordId,
          `${prefix}:${wordBank}:room:${roomIndex++}`,
          wordBank,
          winnerId,
          winnerId,
          duration,
          daysAgo,
        ]
      );
    };

    for (let bankIndex = 0; bankIndex < wordBanks.length; bankIndex++) {
      const wordBank = wordBanks[bankIndex];
      const bankOffset = bankIndex * 3;

      for (let rank = 1; rank <= 50; rank++) {
        const weeklyWins = Math.max(1, 51 - rank);
        const totalWins = weeklyWins + 15;
        const loserIndex = (rank % 50) + 1;

        for (let win = 0; win < weeklyWins; win++) {
          await insertSession(wordBank, rank, loserIndex, 30 + bankOffset + rank + (win % 7), 0);
        }

        for (let win = 0; win < totalWins - weeklyWins; win++) {
          await insertSession(wordBank, rank, loserIndex, 40 + bankOffset + rank + (win % 9), 14);
        }
      }
    }

    await db.commit();
    console.log(JSON.stringify({ insertedUsers: userIds.length, insertedRooms: roomIndex - 1, wordBanks, wordId }, null, 2));
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
