/**
 * Kamus bahasa Indonesia — sekaligus sumber kebenaran bentuk kunci.
 *
 * Berkas ini yang menentukan tipe `Messages`; kamus lain wajib mengisi kunci
 * yang sama persis, jadi terjemahan yang tertinggal ketahuan lewat
 * `npm run typecheck`, bukan lewat teks kosong di layar.
 *
 * Kunci sengaja datar dan bertitik, bukan objek bersarang: `keyof` pada objek
 * datar langsung memberi daftar kunci yang lengkap dan bisa diperiksa.
 *
 * CATATAN: yang diterjemahkan hanya teks yang dibaca pemain. Nilai protokol
 * ('buat-room', 'penonton', 'kondisi', 'galat', …) adalah bagian dari kontrak
 * jaringan dan tidak pernah ikut diterjemahkan.
 */
export const id = {
  // Kepala halaman
  'app.subtitle': 'Vue 3 · TypeScript · aturan lengkap FIDE',
  'app.modeLocal': 'Lokal',
  'app.modeOnline': 'Online',
  'app.language': 'Bahasa',

  // Warna dan bidak
  'color.w': 'Putih',
  'color.b': 'Hitam',
  'piece.k': 'Raja',
  'piece.q': 'Menteri',
  'piece.r': 'Benteng',
  'piece.b': 'Gajah',
  'piece.n': 'Kuda',
  'piece.p': 'Pion',
  /** Urutan kata beda per bahasa: "Menteri Putih" vs "White Queen". */
  'piece.ariaLabel': '{piece} {color}',

  // Baris status
  'status.noRoom': 'Belum berada di room mana pun',
  'status.waitingOpponent': 'Menunggu lawan bergabung…',
  'status.resigned': '{loser} menyerah — {winner} menang',
  'status.checkmateWin': 'Skakmat — {winner} menang',
  'status.spectating': 'Menonton — giliran {color}',
  'status.youInCheck': 'Anda sedang skak!',
  'status.opponentInCheck': 'Lawan sedang skak!',
  'status.yourTurn': 'Giliran Anda',
  'status.waitingMove': 'Menunggu langkah lawan…',
  'status.thinking': '{name} sedang berpikir…',
  'status.sideInCheck': '{color} sedang skak!',
  'status.sideTurn': 'Giliran {color}',

  // Akhir permainan
  'end.checkmate': 'Skakmat',
  'end.stalemate': 'Remis — raja terkunci (stalemate)',
  'end.insufficient-material': 'Remis — materi tidak cukup untuk menang',
  'end.threefold': 'Remis — posisi berulang tiga kali',
  'end.fifty-move': 'Remis — aturan 50 langkah',

  // Papan nama pemain
  'player.empty': '{color} — kosong',
  'player.you': 'Anda',
  'player.disconnected': 'terputus',
  'player.human': 'Anda ({color})',
  /* Sisi mesin diberi nama karakternya; strukturnya tetap bisa diatur per bahasa. */
  'player.computer': '{name} ({color})',
  'player.turnBadge': 'giliran',

  // Papan
  'board.ariaLabel': 'Papan catur',
  'board.flip': 'Putar papan',

  // Panel kendali permainan lokal
  'controls.mode': 'Mode',
  'controls.vsComputer': 'Lawan komputer',
  'controls.twoPlayers': 'Dua pemain',
  'controls.strength': 'Kekuatan lawan',
  'controls.eloNote': 'Angka Elo ini perkiraan, belum dikalibrasi lewat pertandingan.',
  'controls.setupLocked':
    'Lawan dan warna terkunci selama pertandingan berjalan. Mulai permainan baru untuk menggantinya.',
  'controls.playAs': 'Anda bermain sebagai',
  'controls.showHints': 'Tampilkan petunjuk langkah',
  'controls.newGame': 'Permainan baru',
  'controls.undo': 'Batalkan langkah',

  /*
   * Keterangan tingkat, BUKAN nama lawannya. Nama karakter adalah nama diri —
   * tidak diterjemahkan — dan tinggal di `src/opponents.ts`.
   */
  'level.400': 'Pemula',
  'level.800': 'Kasual',
  'level.1200': 'Menengah',
  'level.1600': 'Kuat',
  'level.2000': 'Maksimal',

  // Lobi online
  'lobby.title': 'Main online',
  'lobby.subtitle': 'Buat room lalu bagikan kodenya, atau masuk dengan kode dari teman.',
  'lobby.yourName': 'Nama Anda',
  'lobby.namePlaceholder': 'Pemain',
  'lobby.createHeading': 'Buat room baru',
  'lobby.createButton': 'Buat room',
  'lobby.seatRandom': 'Acak',
  'lobby.or': 'atau',
  'lobby.joinHeading': 'Masuk dengan kode',
  'lobby.joinButton': 'Gabung',
  'lobby.connecting': 'Menyambung ke server…',
  /** Diikuti elemen <code> berisi perintahnya, lalu titik — lihat OnlineLobby.vue. */
  'lobby.serverUnreachable': 'Server tidak bisa dihubungi. Pastikan sudah dijalankan dengan',

  // Panel room
  'room.codeLabel': 'Kode room',
  'room.copy': 'Salin',
  'room.copied': 'Tersalin',
  'room.waiting': 'Menunggu lawan bergabung. Bagikan kode di atas.',
  'room.rematch': 'Main lagi',
  'room.resign': 'Menyerah',
  'room.leave': 'Keluar room',
  'seat.penonton': 'Penonton',

  // Keadaan sambungan
  'conn.terputus': 'Terputus',
  'conn.menyambung': 'Menyambung…',
  'conn.tersambung': 'Tersambung',
  'conn.gagal': 'Gagal tersambung',

  // Galat dari server — dipetakan dari `ServerErrorCode`, bukan dari teks
  // kiriman server, supaya bahasanya ikut pilihan pemain.
  'error.room-tidak-ada': 'Room tidak ditemukan.',
  'error.room-penuh': 'Room ini sudah penuh.',
  'error.bukan-giliran': 'Belum giliran Anda.',
  'error.langkah-tidak-sah': 'Langkah itu tidak sah.',
  'error.bukan-pemain': 'Anda belum berada di room mana pun.',
  'error.permainan-usai': 'Permainan sudah selesai.',
  'error.pesan-tidak-dikenal': 'Pesan tidak dikenali.',
  'error.versi-protokol': 'Versi protokol berbeda — muat ulang halaman.',
  'error.connect': 'Tidak bisa menyambung ke {url}.',

  // Daftar langkah
  'history.title': 'Daftar langkah',
  'history.empty': 'Belum ada langkah.',

  // Dialog promosi
  'promotion.title': 'Promosi pion',
  'promotion.hint': 'Pilih bidak pengganti.',
  'promotion.ariaLabel': 'Pilih bidak promosi',
  'promotion.cancel': 'Batal',

  // Keterangan di kaki panel
  'meta.lastSearch': 'Pencarian terakhir:',
  'meta.searchInfo': 'kedalaman {depth} · {nodes} simpul · {ms} ms',
  'meta.shortcuts': 'Pintasan:',
  'meta.keyUndo': 'batalkan',
  'meta.keyFlip': 'putar papan',
  'meta.keyDeselect': 'batal pilih',

  // Tautan repositori
  'repo.title': 'Open source',
  'repo.subtitle': 'Ikut ngoprek di GitHub — issue dan PR dibuka'
}
