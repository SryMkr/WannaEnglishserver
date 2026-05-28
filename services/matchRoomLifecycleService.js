async function abandonMatchedRoom(executor, roomId, selfLastSeenColumn = null) {
    if (!roomId) {
        return;
    }

    const lastSeenAssignment = selfLastSeenColumn
        ? `,\n             ${selfLastSeenColumn} = UTC_TIMESTAMP(3)`
        : "";

    await executor.execute(
        `UPDATE matchmaking_room
         SET room_status = 'abandoned',
             finished_at = COALESCE(finished_at, UTC_TIMESTAMP(3))${lastSeenAssignment}
         WHERE room_id = ? AND room_status = 'matched'`,
        [roomId]
    );

    await executor.execute(
        `UPDATE matchmaking_ticket
         SET status = 'cancelled',
             cancelled_at = COALESCE(cancelled_at, UTC_TIMESTAMP(3))
         WHERE room_id = ? AND status = 'matched'`,
        [roomId]
    );

    await executor.execute(
        "UPDATE friend_room SET status = 'cancelled' WHERE match_room_id = ? AND status = 'matched'",
        [roomId]
    );
}

module.exports = {
    abandonMatchedRoom
};
