import { randomInt } from 'node:crypto';

// No 0/O/1/I so codes are easy to read aloud.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Normalizes user input to a valid room code, or null. */
export function normalizeRoomCode(input) {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}
