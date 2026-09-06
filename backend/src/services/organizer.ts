import type { Transaction } from 'sequelize';
import type { Database } from '../database.js';
import { StateConflict } from '../errors.js';
import { stateRead } from '../schemas.js';
export async function dashboard(db: Database, transaction?: Transaction) {
  const { CompetitionState, Challenge, Participant, Progress } = db.models;
  const state = await CompetitionState.findByPk(1, { transaction });
  if (!state) throw new StateConflict('No existe un estado de competición.');
  const challenges = await Challenge.findAll({ transaction });
  const byId = new Map(challenges.map((c) => [c.id, c]));
  const rows = await Progress.findAll({ transaction });
  const participants = (
    await Participant.findAll({
      order: [
        ['name', 'ASC'],
        ['id', 'ASC'],
      ],
      transaction,
    })
  ).map((p) => {
    const progress = rows.filter((r) => r.participant_id === p.id);
    const current = progress.sort(
      (a, b) => byId.get(b.challenge_id)!.position - byId.get(a.challenge_id)!.position,
    )[0];
    const challenge = current ? byId.get(current.challenge_id) : undefined;
    return {
      id: p.id,
      name: p.name,
      challenge_position: challenge?.position ?? null,
      challenge_title: challenge?.title ?? null,
      status: current ? (current.completed ? 'completed' : 'working') : 'not_started',
      score: progress.reduce((n, r) => n + r.score, 0),
    };
  });
  return {
    state: stateRead(state),
    global_challenge_title:
      challenges.find((c) => c.position === state.current_challenge)?.title ?? null,
    can_advance: challenges.some((c) => c.position === state.current_challenge + 1),
    participants,
  };
}
export async function advance(db: Database) {
  await db.sequelize.transaction(async (transaction) => {
    const state = await db.models.CompetitionState.findByPk(1, { transaction });
    if (!state) throw new StateConflict('No existe un estado de competición.');
    if (
      !(await db.models.Challenge.findOne({
        where: { position: state.current_challenge + 1 },
        transaction,
      }))
    )
      throw new StateConflict('No existe el siguiente reto global.');
    const [count] = await db.models.CompetitionState.update(
      { current_challenge: state.current_challenge + 1 },
      { where: { id: 1, current_challenge: state.current_challenge }, transaction },
    );
    if (count !== 1) throw new StateConflict('El estado ha cambiado. Actualiza el panel.');
  });
  return dashboard(db);
}
export async function changeState(
  db: Database,
  patch: Partial<{ paused: boolean; individual_progress_enabled: boolean }>,
) {
  if (!Object.keys(patch).length)
    throw new StateConflict('Indica al menos un control que actualizar.');
  await db.sequelize.transaction(async (transaction) => {
    const state = await db.models.CompetitionState.findByPk(1, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!state) throw new StateConflict('No existe un estado de competición.');
    await state.update(patch, { transaction });
  });
  return dashboard(db);
}
