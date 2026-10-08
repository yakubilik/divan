# The screenshots

Every picture in the README lives here. They are taken from a throwaway daemon
with demo projects in it, never from a real one: a screenshot is published
forever, and a real chat list is a list of what somebody is working on.

## What is here

| file | screen | taken on |
|---|---|---|
| `chats.png` | the chat list, grouped by project | iPhone 17 Pro Max simulator, 1320×2868 |
| `chat.png` | a turn mid-stream, with the stop button | same |
| `approval.png` | `rm -rf build` waiting for a decision | same |
| `new-chat.png` | the new-chat sheet | same |
| `settings.png` | settings: computers, software, defaults | same |
| `call.png` | the concierge call, listening | same |
| `agents.png` | the agents tab | same |
| `pair.png` | adding a computer | same |
| `panel-dashboard.png` | the panel's dashboard: what needs you, projects, what is running | headless Chrome, 1440 wide, from `web/scripts/shot-dashboard.mjs` |
| `panel-chat.png` | a chat in the panel | same, from `web/scripts/shot-machine.mjs` |
| `panel-machine.png` | Machines: two computers, the quota, the executors | same |
| `panel-terminal.png` | terminal mode: five chats on the wall | the earlier panel, 1600×900 |
| `film.png` | the last frame of the film, with a play button drawn on it | 1280×720 |

The film itself is not on `main`: 8 MB of video does not belong in every
clone. It is the only file on the `media` branch, and the README links to it
there.

## What is not here, and why

**The computer's screen.** There is no screenshot of screen share, the second
monitor or the remote pointer, on the phone or in the panel. Taking one means
photographing whatever is actually on the desk at that moment — windows, tabs,
file names, other people's messages — and there is no crop that makes that
safe to publish. The feature is described in words in the README instead.

## How to take them again

A separate daemon, so nothing real is in the frame:

```bash
mkdir -p ~/demo-projects && cd ~/demo-projects
git clone https://github.com/yakubilik/divan.git      # a project to talk about

cd <this checkout>/daemon
RAC_HOME=/tmp/rac-demo .venv312/bin/remote-ai-chat pair --name iPhone
```

Then edit `/tmp/rac-demo/config.toml` so nothing personal can reach a picture:

```toml
host_name = "MacBook"                        # not the machine's real name
port = 8791                                  # leave the real daemon alone
bind = ["127.0.0.1"]
allowed_roots = ["/Users/<you>/demo-projects"]
```

```bash
RAC_HOME=/tmp/rac-demo .venv312/bin/remote-ai-chat serve
```

The phone:

```bash
cd app && npm install --legacy-peer-deps
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios \
  --configuration Release --device "iPhone 17 Pro Max"
```

Release rather than the default debug build: no Metro banner, no dev overlay,
and the bundle is in the app, so the pictures do not depend on a server that
is still running.

```bash
UDID=$(xcrun simctl list devices | awk '/iPhone 17 Pro Max/{print $NF}' | tr -d '()' | head -1)
xcrun simctl ui $UDID appearance dark
xcrun simctl status_bar $UDID override --time "09:41" --wifiBars 3 \
  --cellularBars 4 --batteryState charged --batteryLevel 100
xcrun simctl openurl $UDID "remoteaichat://pair?host=127.0.0.1&port=8791&token=<token>&name=MacBook"
xcrun simctl io $UDID screenshot docs/screenshots/chats.png
```

`remoteaichat:///new-chat`, `remoteaichat:///settings`, `remoteaichat:///call`
and `remoteaichat:///agents` open those screens without hunting for the button.

The panel is the same daemon, built and served by it:

```bash
cd web && npm install && npm run build
RAC_HOME=/tmp/rac-demo .venv312/bin/remote-ai-chat web     # prints a URL with a token in the fragment
```

The dashboard, chat and Machines pictures do not need a daemon at all: the
`shot-*.mjs` scripts in `web/scripts` draw the screens from made-up data and
leave the pictures in the folder they are given. For anything else, open that
URL at 1600×900 and screenshot the page. The token rides in the
fragment and the panel wipes it out of the address bar, but check the picture
anyway before committing it.

## Before committing one

- No real host name, no tailnet name, no IP that is not `127.0.0.1`.
- No token, no e-mail, no account name. The plan-limit percentages are fine.
- No absolute path with a home directory in it. The phone prints `~`, and the
  panel's live-event rows do not — capture those before a tool call lands.
- Read the actual words in the bubbles. A demo prompt that quotes something
  real is still something real.
