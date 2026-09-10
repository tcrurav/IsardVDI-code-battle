import { Op, type Transaction } from 'sequelize';
import type { Database } from '../database.js';
import { AuthorizationDenied } from '../errors.js';

export async function authorizeChallenge(
  db: Database,
  participantId: number,
  challengeId: number,
  transaction: Transaction,
) {
  const { Participant, Challenge, Progress, CompetitionState } = db.models;
  // Serialize unlocks for a participant; the unique constraint remains the final guard.
  if (!(await Participant.findByPk(participantId, { transaction, lock: transaction.LOCK.UPDATE })))
    throw new AuthorizationDenied();
  // Use the same catalog lock order as organizer mutations. A manifest cannot
  // change or disappear between authorization and recording the durable unlock.
  const state = await CompetitionState.findByPk(1, { transaction, lock: transaction.LOCK.SHARE });
  const challenge = await Challenge.findByPk(challengeId, {
    transaction,
    lock: transaction.LOCK.SHARE,
  });
  if (!challenge) throw new AuthorizationDenied();
  if (
    await Progress.findOne({
      where: { participant_id: participantId, challenge_id: challengeId },
      transaction,
    })
  )
    return challenge;
  if (
    !state ||
    state.paused ||
    (!state.individual_progress_enabled && challenge.position > state.current_challenge)
  )
    throw new AuthorizationDenied();
  const previous = await Challenge.findAll({
    where: { position: { [Op.lt]: challenge.position } },
    attributes: ['id'],
    transaction,
  });
  const completed = previous.length
    ? await Progress.count({
        where: {
          participant_id: participantId,
          completed: true,
          challenge_id: { [Op.in]: previous.map((c) => c.id) },
        },
        transaction,
      })
    : 0;
  if (completed !== challenge.position - 1) throw new AuthorizationDenied();
  await Progress.create(
    { participant_id: participantId, challenge_id: challengeId },
    { transaction },
  );
  return challenge;
}
