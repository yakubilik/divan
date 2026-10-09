/** Ticket notices as the daemon stored them (`follow_message`), copied from
 *  the events table, plus the messages that must not be read as one. */

export const DONE_157 = "🔔 ustabasi #157 is done: Match mobile chat grouping to the web\n\nThe phone now groups chats the way the web sidebar does: explicit group, then a group with the same name, then saved project (looked up by id through the board if needed), then folder or Daily. Rendered and driven checks cover every criterion, and the mechanical check passes. The voice-call deletions in the diff are not part of this ticket: main gained the #149/#150 merges after this branch was cut, and a normal merge keeps them. Note: the delivered .ipa was built before those merges, so it does not contain the #150 voice work. It was delivered but not installed because the phone was unreachable.\n🔀 merged into main (1664073)\nbranch ustabasi/157-match-mobile-chat-grouping-to-the-web · 1 commit · worktree silindi, dal duruyor\n\nYou filed this ticket from this chat and the person is waiting here for it. Tell them what came of it in a few plain lines, in their language. `ustabasi show 157` has the details.";

export const BLOCKED_139 = "🔔 ustabasi #139 is asking something: Private notes and personal paths out of the public tree\n\nBu iş bitti ve kontrolden geçti ama ana koda eklenemedi: projede kaydedilmemiş başka değişiklikler vardı. Ben ekleyeyim mi?\n\nYou filed this ticket from this chat and Yakup is waiting here for it. Tell him what came of it in a few plain lines, in his language; put its question to him simply. `ustabasi show 139` has the details.";

/** No failed notice has reached a chat yet; this is `follow_message` for one. */
export const FAILED = "🔔 ustabasi #161 failed: Rebuild the panel bundle\n\nnpm test exited 1: 3 failing in scripts/test-drive.mjs\n\nYou filed this ticket from this chat and the person is waiting here for it. Tell them what came of it in a few plain lines, in their language. `ustabasi show 161` has the details.";

export const STEERED_152 = "🔔 ustabasi #152 is done: Practice policy and tool outcome checks on retail tasks\n\nAll five criteria are met.\n🔀 merged into main (e5cf477)\nbranch ustabasi/152-practice-policy-and-tool-outcome-checks- · 5 commit · worktree silindi, dal duruyor\n\nYou filed this ticket from this chat and the person is waiting here for it. Tell them what came of it in a few plain lines, in their language. `ustabasi show 152` has the details.\n bunun senle ne alakası var";

export const CONTROL = 'Ticket #157 is done, can you check the build?';

export const QUOTED = '🔔 ustabasi #157 is done: Match mobile chat grouping to the web\n\nwhat does this mean?';
