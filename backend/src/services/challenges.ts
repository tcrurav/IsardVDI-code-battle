import { ZipFile } from 'yazl';
import type { Database } from '../database.js';
import { AuthorizationDenied, InvalidFiles } from '../errors.js';
import { authorizeChallenge } from './authorization.js';
import { challengeRead, submissionRead } from '../schemas.js';
export function validateFiles(files: Record<string, string>) {
  if (
    Object.keys(files).length > 100 ||
    Object.values(files).some((v) => typeof v !== 'string') ||
    Object.values(files).reduce((n, v) => n + Buffer.byteLength(v, 'utf8'), 0) > 1_000_000
  )
    throw new InvalidFiles('At most 100 files and 1 MB of UTF-8 content are allowed');
  for (const name of Object.keys(files)) {
    if (
      !name ||
      [...name].length > 240 ||
      name.split('/').some((p) => ['', '.', '..'].includes(p)) ||
      /[\\:\x00-\x1f]/.test(name)
    )
      throw new InvalidFiles('File names must be safe relative POSIX paths');
  }
}
export async function availableChallenges(db: Database, participantId: number) {
  return db.sequelize.transaction(async (transaction) => {
    // Acquire the lock before the first consistent read (MySQL repeatable read).
    await db.models.Participant.findByPk(participantId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const available = [];
    for (const c of await db.models.Challenge.findAll({
      order: [['position', 'ASC']],
      transaction,
    })) {
      try {
        available.push(
          challengeRead(await authorizeChallenge(db, participantId, c.id, transaction)),
        );
      } catch (error) {
        if (!(error instanceof AuthorizationDenied)) throw error;
      }
    }
    return available;
  });
}
export async function challengePackage(db: Database, participantId: number, challengeId: number) {
  return db.sequelize.transaction(async (transaction) => {
    const c = await authorizeChallenge(db, participantId, challengeId, transaction);
    validateFiles(c.public_files);
    const zip = new ZipFile();
    const result = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      zip.outputStream.on('data', (chunk) => chunks.push(chunk));
      zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
      zip.outputStream.on('error', reject);
      zip.on('error', reject);
    });
    for (const [name, content] of Object.entries(c.public_files))
      zip.addBuffer(Buffer.from(content, 'utf8'), name);
    zip.end();
    return result;
  });
}
export async function createSubmission(
  db: Database,
  participantId: number,
  payload: { challenge_id: number; files: Record<string, string> },
) {
  return db.sequelize.transaction(async (transaction) => {
    const challenge = await authorizeChallenge(
      db,
      participantId,
      payload.challenge_id,
      transaction,
    );
    validateFiles(payload.files);
    if (Object.keys(payload.files).some((k) => !Object.hasOwn(challenge.public_files, k)))
      throw new InvalidFiles(
        'Only files declared in the challenge public manifest may be submitted',
      );
    const submission = await db.models.Submission.create(
      {
        participant_id: participantId,
        challenge_id: challenge.id,
        files: payload.files,
        status: 'pending',
      },
      { transaction },
    );
    return submissionRead(submission);
  });
}
