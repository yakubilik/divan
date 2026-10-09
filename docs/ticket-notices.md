# Ticket notices

When a ticket filed from a chat ends, the daemon (`follow_tickets` in
`daemon/remote_ai_chat/server.py`) sends `ustabasi.follow_message(f)` into that
chat through `sessions.send`. It is stored and replayed as an ordinary
`message.user` event (`{text, attachments: []}`, plus `queued: true` when it
arrived during a running turn). That is what wakes the agent, and the stored
text is not changed. The text is the only marker, so clients pick out a notice
by its fixed shape and draw it differently.

## The format

```
🔔 ustabasi #<N> <state words>: <title>

<report: one or more lines>
<fact lines, optional>

You filed this ticket from this chat and … `ustabasi show <N>` has the details.
<anything the person added to the same message, optional>
```

- `<state words>` maps to a state: `is done` means **done**, `is asking something` means **blocked** (the report is the question), and `failed` means **failed** (the report is the error).
- The head must be the first line. The title runs to the end of that line.
- The last paragraph is the **agent instruction**. It starts with `You filed this ticket from this chat and ` and ends with `` `ustabasi show <N>` has the details. ``. Older notices say "Yakup is waiting … Tell him" in the middle, so only the start and the end are matched. The `<N>` here must match the head's `<N>`. If it doesn't, or the paragraph is missing, the message is **not** a notice.
- **Fact lines** are the trailing lines of the report that the queue appends: `🔀 ` (merge result), `⏳ ` (merge waited), `🤝 ` (conflict settled), and `branch <name> · ` (branch, commit count, worktree).
- Text after the instruction is the person's own words (a note steered into the same turn). It is shown as their bubble.
- A message with attachments is never a notice.

The reference parser is `web/src/lib/notice.ts` (`ticketNotice`). Its fixtures
in `web/scripts/notice-fixture.js` are copied from stored events (#157, #139,
#152), along with the controls that must stay plain messages.

## The presentation

`Notice` in `web/src/components/Timeline.tsx`:

- **Collapsed:** a single line that spans the width of the conversation. It holds a state icon, a state word (Done / Needs an answer / Failed, in the ok / warn / danger tone), the mono `#N`, the title (one line, ellipsis), `queued` when queued, and a chevron. The whole line is one native `button` with `aria-expanded` and `aria-controls`, so Enter and Space work.
- **Expanded:** an inline region under the same line holds the report as plain text with line breaks kept, then the fact lines in mono. Activating the line again collapses it.
- The agent instruction is never drawn in either state.

The native client should read the same format and keep the same rules:
recognize a notice only when both ends match, never show the instruction, and
show the person's trailing words.

## The phone

`app/src/notice.ts` is the same reader, and `scripts/test-notice.cjs` (in the
app's `npm test`) holds it to the web's answers on the fixtures above.
`UserBubble` in `app/src/components/chat.tsx` draws a recognized notice with
`TicketNoticeRow`:

- **Collapsed:** one full-width row: state icon, state word (same words and tones as the web), mono `#N`, the title on one truncated line, `queued` when queued, and a chevron. The row is one `Pressable` with `accessibilityState.expanded`.
- **Expanded:** under the row, the report as selectable text, then the fact lines in mono. A second tap collapses it. Each mount starts collapsed.
- The agent instruction is never drawn; the person's trailing words are their own bubble; a message with attachments stays a plain bubble.

### Tickets the chat filed

The chip under a tool call that filed a ticket (`#N queued: …`, `CardLink`)
and an opened notice behave the same way on the phone: the first tap opens the
ticket inline in the chat (number, column, title, the card's latest detail), and
only its **Go details** button navigates — to the card on the board when there
is one, otherwise to the bare ticket (`ticketRoute`).
