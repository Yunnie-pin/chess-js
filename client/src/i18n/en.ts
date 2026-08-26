/**
 * Kamus bahasa Inggris.
 *
 * Bertipe `Messages`, jadi kunci yang tertinggal atau salah ketik langsung
 * ditolak `npm run typecheck` — tidak perlu memeriksa manual satu per satu.
 */
import type { Messages } from './index.ts'

export const en: Messages = {
  'app.subtitle': 'Vue 3 · TypeScript · full FIDE rules',
  'app.modeLocal': 'Local',
  'app.modeOnline': 'Online',
  'app.language': 'Language',
  'settings.title': 'Settings',

  'color.w': 'White',
  'color.b': 'Black',
  'piece.k': 'King',
  'piece.q': 'Queen',
  'piece.r': 'Rook',
  'piece.b': 'Bishop',
  'piece.n': 'Knight',
  'piece.p': 'Pawn',
  'piece.ariaLabel': '{color} {piece}',

  'status.noRoom': 'Not in a room yet',
  'status.waitingOpponent': 'Waiting for an opponent to join…',
  'status.resigned': '{loser} resigned — {winner} wins',
  'status.checkmateWin': 'Checkmate — {winner} wins',
  'status.spectating': 'Spectating — {color} to move',
  'status.youInCheck': 'You are in check!',
  'status.opponentInCheck': 'Your opponent is in check!',
  'status.yourTurn': 'Your turn',
  'status.waitingMove': 'Waiting for their move…',
  'status.thinking': '{name} is thinking…',
  'status.sideInCheck': '{color} is in check!',
  'status.sideTurn': '{color} to move',

  'end.checkmate': 'Checkmate',
  'end.stalemate': 'Draw — stalemate',
  'end.insufficient-material': 'Draw — insufficient material',
  'end.threefold': 'Draw — threefold repetition',
  'end.fifty-move': 'Draw — fifty-move rule',

  'player.empty': '{color} — empty',
  'player.you': 'you',
  'player.disconnected': 'disconnected',
  'player.human': 'You ({color})',
  'player.computer': '{name} ({color})',
  'player.turnBadge': 'to move',

  'board.ariaLabel': 'Chess board',
  'board.flip': 'Flip board',

  'controls.mode': 'Mode',
  'controls.vsComputer': 'Vs computer',
  'controls.twoPlayers': 'Two players',
  'controls.strength': 'Opponent strength',
  'controls.eloNote':
    "The opponent is Stockfish, and these Elo numbers are its own UCI_Elo — not a free-floating scale. The range is pinned to what Stockfish itself supports (1320-3190), so even Beginner is well past average human play.",
  'controls.setupLocked':
    'Opponent and colour are locked while a game is in progress. Start a new game to change them.',
  'controls.playAs': 'You play as',
  'controls.playAids': 'Play aids',
  'controls.showHints': 'Show move hints',
  'controls.premove': 'Enable premove',
  'controls.undoEnabled': 'Enable undo',
  'premove.queued': 'Premove queued',
  'premove.cancel': 'Cancel',
  'controls.newGame': 'New game',
  'controls.undo': 'Undo move',

  'level.1320': 'Beginner',
  'level.1800': 'Casual',
  'level.2200': 'Intermediate',
  'level.2600': 'Strong',
  'level.3190': 'Maximum',

  'lobby.title': 'Play online',
  'lobby.subtitle': 'Create a room and share the code, or join with a code from a friend.',
  'lobby.yourName': 'Your name',
  'lobby.namePlaceholder': 'Player',
  'lobby.createHeading': 'Create a new room',
  'lobby.createButton': 'Create room',
  'lobby.seatRandom': 'Random',
  'lobby.or': 'or',
  'lobby.joinHeading': 'Join with a code',
  'lobby.joinButton': 'Join',
  'lobby.connecting': 'Connecting to the server…',
  'lobby.serverUnreachable': 'Cannot reach the server. Make sure it is running with',

  'room.codeLabel': 'Room code',
  'room.copy': 'Copy',
  'room.copied': 'Copied',
  'room.waiting': 'Waiting for an opponent. Share the code above.',
  'room.rematch': 'Rematch',
  'room.resign': 'Resign',
  'room.leave': 'Leave room',
  'seat.penonton': 'Spectator',

  'conn.terputus': 'Disconnected',
  'conn.menyambung': 'Connecting…',
  'conn.tersambung': 'Connected',
  'conn.gagal': 'Connection failed',

  'error.room-tidak-ada': 'Room not found.',
  'error.room-penuh': 'This room is already full.',
  'error.bukan-giliran': "It is not your turn yet.",
  'error.langkah-tidak-sah': 'That move is not legal.',
  'error.bukan-pemain': 'You are not in a room yet.',
  'error.permainan-usai': 'The game is already over.',
  'error.pesan-tidak-dikenal': 'Unrecognised message.',
  'error.versi-protokol': 'Protocol version mismatch — reload the page.',
  'error.connect': 'Cannot connect to {url}.',

  'history.title': 'Moves',
  'history.empty': 'No moves yet.',

  'promotion.title': 'Pawn promotion',
  'promotion.hint': 'Choose a replacement piece.',
  'promotion.ariaLabel': 'Choose promotion piece',
  'promotion.cancel': 'Cancel',

  'meta.poweredBy': 'Computer opponent powered by Stockfish 18',
  'meta.lastSearch': 'Last search:',
  'meta.searchInfo': 'depth {depth} · {nodes} nodes · {ms} ms',
  'meta.shortcuts': 'Shortcuts:',
  'meta.keyBrowse': 'browse moves',
  'meta.keyFlip': 'flip board',
  'meta.keyDeselect': 'clear selection',

  'history.viewing': 'Viewing move {ply} of {total}',
  'history.backToCurrent': 'Back to current position',

  'repo.title': 'Open source',
  'repo.subtitle': 'Come tinker on GitHub — issues and PRs welcome'
}
