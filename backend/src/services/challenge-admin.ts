import type { Transaction } from 'sequelize';
import { caseFold } from 'unicode-case-folding';
import type { Database } from '../database.js';
import { HttpError, StateConflict } from '../errors.js';
import { record } from '../schemas.js';
import { validateFiles } from './challenges.js';

interface ChallengeInput {
  position?: number;
  title: string;
  description: string;
  expected_output?: string | null;
  public_files: Record<string, string>;
}
export function challengeInput(body: unknown, creating: boolean): ChallengeInput {
  const fields = creating
    ? ['position', 'title', 'description', 'public_files', 'expected_output']
    : ['title', 'description', 'public_files', 'expected_output'];
  if (!record(body) || Object.keys(body).some((k) => !fields.includes(k)))
    throw new HttpError(422, 'Campos de reto no válidos.');
  if (typeof body.title !== 'string' || !body.title.trim() || [...body.title.trim()].length > 200)
    throw new HttpError(422, 'El título es obligatorio y admite hasta 200 caracteres.');
  if (typeof body.description !== 'string' || Buffer.byteLength(body.description, 'utf8') > 60_000)
    throw new HttpError(422, 'La descripción debe ser texto de hasta 60.000 bytes.');
  if (
    creating &&
    (typeof body.position !== 'number' ||
      !Number.isSafeInteger(body.position) ||
      body.position < 1 ||
      body.position > 2147483647)
  )
    throw new HttpError(422, 'La posición debe ser un entero positivo.');
  if (
    !record(body.public_files) ||
    (creating && !Object.keys(body.public_files).length) ||
    Object.values(body.public_files).some((v) => typeof v !== 'string')
  )
    throw new HttpError(422, 'Incluye al menos un archivo público de texto.');
  if (
    Object.hasOwn(body, 'expected_output') &&
    body.expected_output !== null &&
    (typeof body.expected_output !== 'string' ||
      Buffer.byteLength(body.expected_output, 'utf8') > 60_000)
  )
    throw new HttpError(422, 'El resultado esperado debe ser texto de hasta 60.000 bytes o null.');
  const files = body.public_files as Record<string, string>;
  validateFiles(files);
  const seen = new Set<string>();
  for (const name of Object.keys(files)) {
    if (
      name
        .split('/')
        .some(
          (p) =>
            /[. ]$/.test(p) ||
            /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(p.replace(/\.[^.]*$/, '')),
        )
    )
      throw new HttpError(422, 'El nombre de archivo no es compatible con el cliente.');
    const folded = caseFold(name);
    if (
      seen.has(folded) ||
      [...seen].some((other) => folded.startsWith(other + '/') || other.startsWith(folded + '/'))
    )
      throw new HttpError(422, 'Hay archivos duplicados o rutas incompatibles.');
    seen.add(folded);
  }
  return {
    ...(creating ? { position: body.position as number } : {}),
    title: body.title.trim(),
    description: body.description,
    ...(Object.hasOwn(body, 'expected_output')
      ? { expected_output: body.expected_output as string | null }
      : {}),
    public_files: files,
  };
}
async function activity(db: Database, id: number, transaction?: Transaction) {
  return (
    (await db.models.Progress.count({ where: { challenge_id: id }, transaction })) > 0 ||
    (await db.models.Submission.count({ where: { challenge_id: id }, transaction })) > 0
  );
}
async function lockCatalog(db: Database, transaction: Transaction) {
  const state = await db.models.CompetitionState.findByPk(1, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!state) throw new StateConflict('No existe un estado de competición.');
  return state;
}
export async function listChallenges(db: Database) {
  const challenges = await db.models.Challenge.findAll({
    attributes: ['id', 'position', 'title', 'description'],
    order: [['position', 'ASC']],
  });
  const positions = new Set(challenges.map((c) => c.position));
  let next_position = 1;
  while (positions.has(next_position)) next_position++;
  const last = challenges.at(-1)?.id;
  const items = [];
  for (const c of challenges) {
    const in_use = await activity(db, c.id);
    items.push({
      id: c.id,
      position: c.position,
      title: c.title,
      description: c.description,
      in_use,
      can_delete: !in_use && c.id === last,
    });
  }
  return { items, next_position };
}
export async function readChallenge(db: Database, id: number) {
  const c = await db.models.Challenge.findByPk(id);
  if (!c) throw new HttpError(404, 'Reto no encontrado.');
  return {
    id: c.id,
    position: c.position,
    title: c.title,
    description: c.description,
    public_files: c.public_files,
    expected_output: c.expected_output,
    in_use: await activity(db, id),
  };
}
export async function createChallenge(db: Database, input: ChallengeInput) {
  return db.sequelize.transaction(async (transaction) => {
    await lockCatalog(db, transaction);
    const positions = new Set(
      (await db.models.Challenge.findAll({ attributes: ['position'], transaction })).map(
        (c) => c.position,
      ),
    );
    let next = 1;
    while (positions.has(next)) next++;
    if (input.position !== next)
      throw new StateConflict(`La siguiente posición disponible es ${next}. Actualiza la lista.`);
    const c = await db.models.Challenge.create({ ...input }, { transaction });
    return {
      id: c.id,
      position: c.position,
      title: c.title,
      description: c.description,
      public_files: c.public_files,
      expected_output: c.expected_output,
      in_use: false,
    };
  });
}
export async function updateChallenge(db: Database, id: number, input: ChallengeInput) {
  return db.sequelize.transaction(async (transaction) => {
    await lockCatalog(db, transaction);
    const c = await db.models.Challenge.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!c) throw new HttpError(404, 'Reto no encontrado.');
    const in_use = await activity(db, id, transaction);
    if (!in_use && !Object.keys(input.public_files).length)
      throw new HttpError(422, 'Incluye al menos un archivo público de texto.');
    const sameNames =
      Object.keys(c.public_files).length === Object.keys(input.public_files).length &&
      Object.keys(c.public_files).every((name) => Object.hasOwn(input.public_files, name));
    if (in_use && !sameNames)
      throw new StateConflict(
        'No se pueden añadir, quitar ni renombrar archivos de un reto que ya tiene actividad.',
      );
    await c.update(
      {
        title: input.title,
        description: input.description,
        public_files: input.public_files,
        ...(input.expected_output !== undefined ? { expected_output: input.expected_output } : {}),
      },
      { transaction },
    );
    return {
      id: c.id,
      position: c.position,
      title: c.title,
      description: c.description,
      public_files: c.public_files,
      expected_output: c.expected_output,
      in_use,
    };
  });
}
export async function deleteChallenge(db: Database, id: number) {
  await db.sequelize.transaction(async (transaction) => {
    const state = await lockCatalog(db, transaction);
    const c = await db.models.Challenge.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!c) throw new HttpError(404, 'Reto no encontrado.');
    if (await activity(db, id, transaction))
      throw new StateConflict('No se puede eliminar un reto que ya tiene actividad.');
    const last = await db.models.Challenge.findOne({ order: [['position', 'DESC']], transaction });
    if (last?.id !== id)
      throw new StateConflict(
        'Solo se puede eliminar el último reto para no dejar huecos en la secuencia.',
      );
    await c.destroy({ transaction });
    if (state.current_challenge >= c.position)
      await state.update({ current_challenge: Math.max(1, c.position - 1) }, { transaction });
  });
}
