import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from '../database.js';
import type { Participant } from '../models.js';
export function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
// Caller persists and delivers the token privately, exactly as in the original.
export function issueToken(participant: Participant) {
  const token = randomBytes(32).toString('base64url');
  participant.token_hash = hashToken(token);
  return token;
}
export function authenticate(db: Database, token: string) {
  return db.models.Participant.findOne({ where: { token_hash: hashToken(token) } });
}
export function organizerMatches(token: string, expected: string) {
  return (
    expected.length > 0 &&
    timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(hashToken(expected), 'hex'))
  );
}
