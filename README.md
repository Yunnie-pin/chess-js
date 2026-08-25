# Chess with Mari

[![CI](https://github.com/Yunnie-pin/chess-js/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Yunnie-pin/chess-js/actions/workflows/ci.yml)

Chess in the browser: play the computer, or play a friend online through a room.
The engine, the AI, and the server are all written from scratch — no chess
library.

![Chess board in a gold and ivory theme, control panel on the right, and a portrait of Mari in the background](https://i.imgur.com/jRiarIT.png)

## Running it

```bash
npm install
npm run dev      # server + client together
```

Client on <http://localhost:5173>, server on <http://localhost:8787>.

For local play only (vs computer / two players) you don't need the server —
`npm run dev:client` is enough.

| Command              | What it does                              |
| -------------------- | ----------------------------------------- |
| `npm run dev`        | Server + client together                  |
| `npm run dev:server` | Multiplayer server only                   |
| `npm run dev:client` | UI only                                   |
| `npm test`           | 124 tests across the three workspaces     |
| `npm run typecheck`  | Strict TypeScript, Vue templates included |
| `npm run build`      | Build the client into `client/dist/`      |
| `npm start`          | Run the server for production             |

The client connects to `/ws` on the same origin, and the Vite dev server proxies
that to the chess server. You only need `VITE_SERVER_URL` if the server actually
lives on a different host, e.g.
`VITE_SERVER_URL=wss://chess.example.com npm run build`.

## Docker

```bash
docker compose up --build      # open http://localhost:8080
```

nginx serves the client and also proxies `/ws` to the server over compose's
internal network. So only one port is exposed, and the server address never gets
baked into the bundle — one image works on any domain.

### Changing the port

The host port comes from `CLIENT_PORT`; no need to edit `docker-compose.yml`.
Three ways, all equivalent:

```bash
CLIENT_PORT=3000 docker compose up      # one-off
```

```bash
cp .env.example .env                    # persistent; .env is gitignored
# set CLIENT_PORT=3000
docker compose up
```

```bash
docker compose --env-file prod.env up   # a separate env file per environment
```

Want to check before running anything? `docker compose config`, look at the
`published` line.

Only the host-side port changes. nginx inside the container stays on 80, and
`/ws` follows along on its own because the client uses the same origin.

The build context for both images is the repo root, not their own folders, since
both depend on the `@chess/shared` workspace.

The server image has no compile step at all — Node 24 runs its TypeScript
directly via type stripping.


## Deploying to a server

The published images run as-is — no repo clone, no build:

```bash
docker network create chess

docker run -d --name chess-server --network chess --restart unless-stopped \
  ghcr.io/yunnie-pin/chess-js/server:1.0.0

docker run -d --name chess-client --network chess --restart unless-stopped \
  -p 80:80 ghcr.io/yunnie-pin/chess-js/client:1.0.0
```

The client container must be able to reach the server container by the hostname
`server`, since that's what nginx proxies `/ws` to. Either name it
`--name server`, or add `--network-alias server`.

Pin a version tag rather than `latest`: on a server, `latest` means you can't
tell what's actually running, and rollbacks turn into guesswork.

If the package is still private, log in once on that machine:

```bash
echo $GHCR_TOKEN | docker login ghcr.io -u <username> --password-stdin
# token: GitHub → Settings → Developer settings → PAT, scope read:packages
```

With a reverse proxy (Caddy/Traefik/nginx) in front for TLS, publish to
`-p 127.0.0.1:8080:80` instead so the container isn't exposed straight to the
internet.

**Important if you're on HTTPS:** a page served over `https://` must use `wss://`,
and the client already handles that itself — it reads
`window.location.protocol`. But your reverse proxy has to forward the `Upgrade`
and `Connection` headers for the `/ws` path, otherwise the WebSocket gets
rejected and online play breaks while local play keeps working — a confusing
symptom to debug.


## Layout

```
shared/     Shared by client and server — owned by neither
  src/chess.ts       Board, move generation, SAN, game status
  src/zobrist.ts     Position hash tables
  src/tt.ts          Transposition table
  src/ai.ts          Negamax + alpha-beta + quiescence + TT
  src/protocol.ts    WebSocket message contract + guards for both directions
  src/types.ts       Core types (Piece, Move, GameStatus, …)

server/     Multiplayer server
  src/room.ts        One match: seats, move validation, resign
  src/rooms.ts       Room registry, random codes, cleanup of dead rooms
  src/index.ts       HTTP + WebSocket, broadcast, heartbeat

client/     Vue 3 UI
  src/composables/useChessGame.ts    Local play (two players / vs computer)
  src/composables/useOnlineGame.ts   Multiplayer client
  src/engine/ai.worker.ts            Web Worker wrapper for the AI
  src/i18n/                          Indonesian and English text
  src/opponents.ts                   Characters and palettes per Elo level
  src/theme.ts                       Applies the active opponent's palette
  src/components/                    Board, lobby, room panel, move list, …
```

## Multiplayer

Create a room, share the four-letter code, your opponent joins with it. A third
person who joins becomes a spectator rather than being turned away.

**The server is the source of truth.** The client never decides on its own
whether a move is legal. It just sends what it wants, the server checks with the
exact same engine, then broadcasts the new state. A client that's behind, on a
different version, or tampered with can't make the two boards disagree — if it
sends a bogus move the server rejects it and immediately sends back the real
state to pull the client back in sync.

**Closing the tab doesn't mean losing.** Every player holds a token stored in
`localStorage`. Reconnecting with the same token reclaims the same seat and the
same board, so a refresh or a brief network drop doesn't throw anyone out of a
running match. The client also reconnects on its own with a backoff delay.

**Room codes** use an alphabet without easily-confused characters (no 0/O, 1/I/L,
5/S, 8/B), because those codes are meant to be read aloud or retyped by hand.

## Rules and local play

Full FIDE rules: castling including the ban on passing through an attacked
square, en passant, promotion with a piece picker, check, checkmate, and every
draw condition (stalemate, insufficient material, threefold repetition, the
fifty-move rule).

Click two squares or drag the piece — both work on desktop and on touch screens.
The computer opponent has five Elo levels, with a 500 ms minimum reply delay so
its moves don't pop in out of nowhere.

Shortcuts: `←` undo, `F` flip the board, `Esc` clear the selection.

## Opponents

Each strength level is a character, and picking one re-dresses the page — accent,
board squares, the glow behind the header, the halo, and the portrait:

| Elo  | Opponent        | Level        |
| ---- | --------------- | ------------ |
| 400  | Iochi Mari      | Beginner     |
| 800  | Toki            | Casual       |
| 1200 | Kisaki          | Intermediate |
| 1600 | Hayase Yuuka    | Strong       |
| 2000 | Akeboshi Himari | Maximum      |

Mari stays the host: two-player and online games use her palette, since neither
has a machine opponent to stand in for.

**Setup happens before the game, not during it.** Both the opponent and the colour
you play lock as soon as you make your move; "New game" unlocks them, and so does
undoing back to an empty board. One rule for both, because both break the same
thing — swapping either mid-game leaves a board that is still legal but no longer
means anything as a match.


## Language

The interface speaks Indonesian and English, switchable with the **ID/EN** toggle
in the header. Your choice is remembered; on a first visit it follows the
browser's language and falls back to Indonesian.

There's no i18n library — key lookup and `{param}` substitution is the whole
requirement, and vue-i18n would bring a message loader, an ICU formatter, and its
own compile mode along with it. What a library normally buys you here, the
compiler already does: `client/src/i18n/id.ts` defines the key set, `en.ts` is
typed against it, so a forgotten translation fails `npm run typecheck` rather
than showing up blank on screen.

What TypeScript *can't* see is inside the strings. A translation that drops
`{winner}` is still a perfectly valid string, and the bug only surfaces as a hole
in a sentence, so `client/test/i18n.test.ts` compares the placeholders in every
pair of strings.

**Only what the player reads is translated.** The protocol values stay Indonesian
in both languages — `buat-room`, `penonton`, `kondisi`, `galat` are the wire
format, not labels. Error text is the interesting case: the server always
describes failures in Indonesian, so the client ignores that prose and looks up
its own text from the error *code*, which is part of the protocol and stable.

## Technical notes

**Board representation.** A 64-element array; index 0 is a8 and 63 is h1, so
`rank = index >> 3` and `file = index & 7`. Moves are generated pseudo-legally
first, then filtered through `makeMove` / `undoMove`.

**Is the engine actually correct?** `shared/test/perft.test.ts` matches node
counts against the chessprogramming.org reference numbers for five standard
positions, Kiwipete included, up to 197,281 positions. That's what catches the
subtle bugs in castling, en passant, and pins — the kind that slip past manual
testing.

**Levels are Elo, not search depth.** Making an engine weak purely by searching
shallower feels wrong — its mistakes are uniform and nothing like a human's. So
each level has two knobs: depth/time, plus `errorMargin`, which is how bad a move
it's still allowed to pick. An engine that searches deep enough but occasionally
takes the second-best move errs much more like a person — it misses tactics
instead of suddenly hanging its queen.

Measured against a fixed reference (depth-4 analysis of the same position),
average loss per move:

```
400   Beginner   depth 1    129.6 cp   <- default
800   Casual     depth 2     69.9 cp
1200  Medium     depth 3     19.4 cp
1600  Strong     depth 4      8.1 cp
2000  Maximum    depth 6      0.0 cp
```

The reference has to be fixed. At first each level was measured against its own
search, and the result was misleading: level 400 looked like it only lost 33 cp —
less than level 800 — even though its moves are clearly worse. A depth-1 search
simply sees a narrow spread of scores, so its relative "loss" comes out small.

**The Elo numbers are estimates**, not calibrated by playing rated engines. The
ordering is guaranteed to go up, but don't read 1200 here as exactly 1200 on
Lichess. Every number lives in one `STRENGTH_PROFILES` table in
[ai.ts](shared/src/ai.ts) if you want to tune it.

**Zobrist hashing.** The position key used to be a string from
`board.join(',')`, rebuilt on every `makeMove`. Measured with perft, that ate
**70% of engine time**. Now the key is an XOR of numbers updated incrementally —
O(1) per move instead of O(64) — which made the engine **2.3x faster**.

Incremental updates are easy to get wrong and the symptoms show up much later, so
`zobrist.test.ts` walks the entire move tree to depth 4 and compares the
incremental hash against a from-scratch recomputation at **every** position,
including after `undoMove`.

**Transposition table.** The same position is often reached through different
move orders; without a table each path is recomputed. Stored in parallel typed
arrays (2^18 entries, ~4.5 MB) to avoid creating hundreds of thousands of objects
per search. Entries are verified against the full 64-bit key, not just the slot
index — two different positions can land in the same slot, and using the wrong
result is far worse than merely missing a cache hit.

Mate scores are stored relative to their own position, not to the search root.
Otherwise a "mate in 3" found at depth 5 would read as "mate in 3" again when the
same position turns up at depth 2.

Together: the top level **went from depth 5 to depth 6**, and finishes faster
than before (2.9 s vs 4.0 s).

**Why the engine lives in `shared/`.** The server has to validate every move, so
the rules of chess don't belong to the client. Copy them into two places and
sooner or later the two will diverge — and you'd only find out during a real
match. `protocol.ts` is there for the same reason: if one side changes a message
shape, what breaks is `npm run typecheck`, not the players.

**Why `Position` isn't reactive.** The AI search calls `makeMove`/`undoMove`
hundreds of thousands of times. Wrapping it in a Vue proxy would slow that down
several times over. So the board is mutated directly and a `version` counter
ticks whenever the position changes — every `computed` hangs off that counter.

**Web Worker.** The AI search blocks whatever thread it runs on, so it lives in a
worker to keep the board responsive. If the environment disallows module workers,
the client falls back to a synchronous path automatically.

## Testing

```
shared/   39 tests   perft, SAN, draws, Zobrist hash consistency, the Elo ladder
server/   28 tests   room rules, seats, tokens; plus real WebSocket integration
client/   57 tests   local game state, dictionaries, opponent palettes, end-to-end
```

The server and client tests both spin up a real server process on their own port
and talk over a real WebSocket — no mocks. That's how the bug where seats didn't
swap after a rematch got caught; it was invisible when each piece was tested on
its own.

## Contributing

Issues and PRs are welcome: <https://github.com/Yunnie-pin/chess-js>

Before opening a PR, run `npm test` and `npm run typecheck` — CI runs exactly
those, so it saves a round trip.
