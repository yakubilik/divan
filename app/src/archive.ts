// Archiving a chat that has gone quiet is the computer's job (the daemon's
// `archive_quiet`); the phone only shows and sets how long "quiet" is.
import type { Key } from './i18n';

/** What "archive quiet chats" can be set to, in hours. 0 is off. A value
 *  written into config.toml by hand that is not one of these is offered too. */
export const ARCHIVE_CHOICES = [0, 6, 12, 24, 48, 72, 168];

export function archiveLabel(h: number, T: (k: Key, p?: Record<string, string | number>) => string): string {
  if (h <= 0) return T('autoArchiveOff');
  if (h === 24) return T('autoArchive1D');
  return h % 24 === 0 ? T('autoArchiveD', { n: h / 24 }) : T('autoArchiveH', { n: h });
}
