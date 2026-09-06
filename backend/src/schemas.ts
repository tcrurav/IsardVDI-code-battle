import { HttpError, InvalidFiles } from './errors.js';
import type { Challenge, CompetitionState, Participant, Submission } from './models.js';
export const participantRead = (p: Participant) => ({
  id: p.id,
  name: p.name,
  created_at: p.created_at,
});
export const challengeRead = (c: Challenge) => ({
  id: c.id,
  position: c.position,
  title: c.title,
  description: c.description,
});
export const submissionRead = (s: Submission) => ({
  id: s.id,
  participant_id: s.participant_id,
  challenge_id: s.challenge_id,
  status: s.status,
  feedback: s.feedback ?? null,
  created_at: s.created_at,
});
export const stateRead = (s: CompetitionState) => ({
  current_challenge: s.current_challenge,
  individual_progress_enabled: s.individual_progress_enabled,
  paused: s.paused,
});
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function positiveInteger(value: unknown, requirePositive = true): number {
  // Pydantic int accepts integral numbers, boolean values and numeric strings.
  const n =
    typeof value === 'boolean'
      ? Number(value)
      : typeof value === 'string' && /^[+\-]?\d+(?:\.0+)?$/.test(value.trim())
        ? Number(value)
        : value;
  if (
    typeof n !== 'number' ||
    !Number.isSafeInteger(n) ||
    (requirePositive && n < 1) ||
    n > 2147483647 ||
    n < -2147483648
  )
    throw new HttpError(422, 'Input should be a positive integer');
  return n;
}
export function submissionCreate(body: unknown) {
  if (!record(body) || Object.keys(body).some((k) => !['challenge_id', 'files'].includes(k)))
    throw new HttpError(422, 'Invalid submission fields');
  const challenge_id = positiveInteger(body.challenge_id);
  if (
    !record(body.files) ||
    !Object.keys(body.files).length ||
    Object.keys(body.files).length > 100 ||
    Object.values(body.files).some((v) => typeof v !== 'string')
  )
    throw new InvalidFiles('Provide between 1 and 100 text files');
  return { challenge_id, files: body.files as Record<string, string> };
}
export function statePatch(body: unknown) {
  if (
    !record(body) ||
    Object.keys(body).some((k) => !['paused', 'individual_progress_enabled'].includes(k)) ||
    Object.values(body).some((v) => v !== null && typeof v !== 'boolean')
  )
    throw new HttpError(422, 'Invalid state fields');
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)) as Partial<{
    paused: boolean;
    individual_progress_enabled: boolean;
  }>;
}
