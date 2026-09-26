import type { Env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { FocusRepository, type FocusIdentity, type FocusSession } from './repository.js';
import { calculateStreak } from './streak.js';

export type FocusStats = { sessions: number; minutes: number; currentStreak: number; bestStreak: number };
export type FocusStartResult =
  | { kind: 'started'; session: FocusSession }
  | { kind: 'already_active' }
  | { kind: 'invalid_duration' };

export class FocusService {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly repository: FocusRepository,
    private readonly env: Env,
    private readonly notify: (session: FocusSession) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly onCompleted?: (session: FocusSession) => Promise<void>
  ) {}

  start(identity: FocusIdentity, channelId: string, durationMinutes: number): FocusStartResult {
    if (!Number.isInteger(durationMinutes) || durationMinutes < this.env.FOCUS_MIN_DURATION_MINUTES || durationMinutes > this.env.FOCUS_MAX_DURATION_MINUTES) {
      return { kind: 'invalid_duration' };
    }
    this.settleUser(identity);
    if (this.repository.getActive(identity)) return { kind: 'already_active' };
    const session = this.repository.start(identity, channelId, durationMinutes, this.now());
    if (!session) return { kind: 'already_active' };
    this.schedule(session);
    logger.info({ focusSessionId: session.id }, 'Focus session started');
    return { kind: 'started', session };
  }

  stop(identity: FocusIdentity): FocusSession | undefined {
    this.settleUser(identity);
    const session = this.repository.getActive(identity);
    if (!session || !this.repository.stop(session.id, this.now())) return undefined;
    this.clearTimer(session.id);
    logger.info({ focusSessionId: session.id }, 'Focus session stopped');
    return session;
  }

  status(identity: FocusIdentity): FocusSession | undefined {
    this.settleUser(identity);
    return this.repository.getActive(identity);
  }

  stats(identity: FocusIdentity): FocusStats {
    this.settleUser(identity);
    const { sessions, minutes, completedAt } = this.repository.completedStats(identity);
    const streak = calculateStreak(completedAt, this.now(), this.env.APP_TIMEZONE);
    return { sessions, minutes, currentStreak: streak.current, bestStreak: streak.best };
  }

  async recover(): Promise<void> {
    const active = this.repository.listActive();
    let restored = 0;
    let expired = 0;
    for (const session of active) {
      if (session.endsAt <= this.now()) {
        expired++;
        await this.finish(session.id);
        logger.info({ focusSessionId: session.id }, 'Focus expired during downtime');
      } else {
        this.schedule(session);
        restored++;
        logger.info({ focusSessionId: session.id }, 'Focus timer restored');
      }
    }
    logger.info({ restored, expired }, 'Focus recovery completed');
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private settleUser(identity: FocusIdentity): void {
    const session = this.repository.getActive(identity);
    if (session && session.endsAt <= this.now()) {
      void this.finish(session.id).catch((error: unknown) => {
        logger.error({ focusSessionId: session.id, type: error instanceof Error ? error.name : 'Unknown' }, 'Focus completion failed');
      });
    }
  }

  private schedule(session: FocusSession): void {
    this.clearTimer(session.id);
    const delay = Math.max(0, session.endsAt - this.now());
    const timer = setTimeout(() => {
      this.timers.delete(session.id);
      void this.finish(session.id).catch((error: unknown) => {
        logger.error({ focusSessionId: session.id, type: error instanceof Error ? error.name : 'Unknown' }, 'Focus completion failed');
      });
    }, delay);
    timer.unref();
    this.timers.set(session.id, timer);
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  private async finish(id: number): Promise<void> {
    const session = this.repository.getById(id);
    if (!session || session.status !== 'ACTIVE') return;
    if (session.endsAt > this.now()) {
      this.schedule(session);
      return;
    }
    if (!this.repository.complete(id, this.now())) return;
    this.clearTimer(id);
    logger.info({ focusSessionId: id }, 'Focus session completed');
    try {
      await this.notify(session);
    } catch (error) {
      logger.warn({ focusSessionId: id, type: error instanceof Error ? error.name : 'Unknown' }, 'Focus notification failed');
    }
    try { await this.onCompleted?.(session); }
    catch (error) { logger.warn({ focusSessionId: id, message: error instanceof Error ? error.message : String(error) }, 'Focus music cleanup failed'); }
  }
}
