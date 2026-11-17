import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { TeamId } from '../shared/types.ts';

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

export interface SessionPayload {
  userId: string;
  username: string;
  isGuest: boolean;
  purpose: 'session';
}

export interface MatchTicketPayload {
  userId: string;
  username: string;
  isGuest: boolean;
  roomId: string;
  team: TeamId;
  mmr: number;
  purpose: 'match_ticket';
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSessionToken(payload: Omit<SessionPayload, 'purpose'>): string {
  return jwt.sign({ ...payload, purpose: 'session' }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionPayload;
    if (decoded && decoded.purpose === 'session' && decoded.userId && decoded.username) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

export function signMatchTicket(payload: Omit<MatchTicketPayload, 'purpose'>): string {
  return jwt.sign({ ...payload, purpose: 'match_ticket' }, JWT_SECRET, { expiresIn: '10m' });
}

export function verifyMatchTicket(ticket: string): MatchTicketPayload | null {
  try {
    const decoded = jwt.verify(ticket, JWT_SECRET) as MatchTicketPayload;
    if (decoded && decoded.purpose === 'match_ticket' && decoded.userId && decoded.roomId && decoded.team) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}
