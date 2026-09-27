# Changelog

Every release, newest first. The entries are the commit subjects, which is why
this project asks for subjects that say what is now true that was not true
before.

The tag is the version. `scripts/release.py` writes this file, the three places
the number is copied to, and the tag itself, in one commit; the release
workflow refuses a tag whose copies disagree with it.

<!-- releases -->

## v0.2.0 — 2026-09-27

- Your computer's coding agent, from your phone: a daemon on the machine, an iOS app, and a desktop panel that talks to every paired computer at once.
- Claude Code and Codex both run through one protocol, on the account already signed in on that computer.
- macOS, Linux and Windows each install with one script, and the daemon registers itself to start at login.
- A voice call to the computer, answered by a concierge that can see every chat on it; the phone rings through CallKit whether or not the app is open.
- The computer's screen on the phone and in the panel, with a pointer that can click it — macOS and Windows, every monitor, and nothing moves until the switch in config.toml is on.
- Terminal mode in the panel: every chat as a window on a wall you arrange yourself, with approvals answered from the tile.
- Agents defined on the computer are listed on both clients, and a card can start a chat with one.
- Both of a chat's ids, in full and copyable, in the panel's inspector and the phone's chat settings.
- A turn survives the daemon: a restart picks up the turns that were in flight and the messages nobody answered, in order.
- A message sent into a running turn reaches the model at its next step rather than waiting behind it.
- The phone app drawn again from the design, light and dark, with its own menus, sheets, gallery and folded tool runs.
- A chat row swipes aside to archive or delete it, and chats can be grouped by hand or by the folder they run in.
- A file dragged onto a chat in the panel reaches the computer that chat runs on, not the one that served the panel.
- Voice messages are transcribed on the computer — mlx-whisper on Apple silicon, faster-whisper everywhere else.
- Every computer's chats in one list, and the panel remembers per computer how a new chat was last opened.
- A tapped notification opens the chat it is about, on the computer it came from, and stops deleting the chat it was opening.
- Copy buttons work on the address the panel is actually opened at, where `navigator.clipboard` does not exist.
- The remote screen stops freezing two frames in, and a tap lands where the finger did when the picture is zoomed.
- Both clients walk to the end of a chat and notice a socket that died quietly; only the line that changed redraws.
- The panel build carries no pairing token, and says which commit it came from.
