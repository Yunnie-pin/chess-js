# Catur — Vue 3 + TypeScript + server multiplayer

Permainan catur lengkap di browser: main sendiri melawan komputer, atau online
lewat room bersama teman. Engine, AI, dan servernya ditulis sendiri tanpa
pustaka catur pihak ketiga.

## Menjalankan

```bash
npm install
npm run dev      # menyalakan server dan client sekaligus
```

Client di <http://localhost:5173>, server di <http://localhost:8787>.

Untuk mode lokal (lawan komputer / dua pemain) server tidak perlu dijalankan —
`npm run dev:client` saja sudah cukup.

| Perintah              | Kegunaan                                       |
| --------------------- | ---------------------------------------------- |
| `npm run dev`         | Server + client bersamaan                      |
| `npm run dev:server`  | Server multiplayer saja                        |
| `npm run dev:client`  | Antarmuka saja                                 |
| `npm test`            | 73 tes di ketiga workspace                     |
| `npm run typecheck`   | TypeScript mode ketat, termasuk template Vue   |
| `npm run build`       | Build client ke `client/dist/`                 |
| `npm start`           | Menjalankan server untuk produksi              |

Alamat server saat build diatur lewat `VITE_SERVER_URL`, misalnya
`VITE_SERVER_URL=wss://catur.example.com npm run build`.

## Struktur

```
shared/     Dipakai bersama client dan server — bukan milik salah satunya
  src/chess.ts       Papan, pembangkitan langkah, SAN, status permainan
  src/ai.ts          Negamax + alpha-beta + quiescence
  src/protocol.ts    Kontrak pesan WebSocket + penjaga untuk kedua arah
  src/types.ts       Tipe dasar (Piece, Move, GameStatus, …)

server/     Server multiplayer
  src/room.ts        Satu pertandingan: kursi, validasi langkah, menyerah
  src/rooms.ts       Registry room, kode acak, pembersihan room mati
  src/index.ts       HTTP + WebSocket, penyiaran, heartbeat

client/     Antarmuka Vue 3
  src/composables/useChessGame.ts    Permainan lokal (dua pemain / lawan komputer)
  src/composables/useOnlineGame.ts   Klien multiplayer
  src/engine/ai.worker.ts            Pembungkus Web Worker untuk AI
  src/components/                    Papan, lobby, panel room, riwayat, …
```

## Multiplayer

Buat room, bagikan kode empat huruf, lawan masuk dengan kode itu. Orang
berikutnya yang masuk menjadi penonton, bukan ditolak.

**Server yang memegang kebenaran.** Client tidak pernah memutuskan sendiri
apakah sebuah langkah sah. Ia mengirim niat, server memvalidasinya dengan engine
yang sama persis, lalu menyiarkan kondisi baru. Client yang telat, salah versi,
atau sudah dioprek tidak bisa membuat papan kedua pemain berbeda isi — kalau ia
mengirim langkah yang tidak sah, server menolak dan langsung mengirim kondisi
sebenarnya untuk memaksa client kembali sinkron.

**Menutup tab bukan berarti kalah.** Setiap pemain memegang token yang disimpan
di `localStorage`. Menyambung kembali dengan token yang sama akan merebut kursi
dan papan yang sama, jadi muat ulang halaman atau jaringan yang sempat putus
tidak membuang seseorang dari pertandingan yang sedang berjalan. Client juga
menyambung ulang sendiri dengan jeda menaik.

**Kode room** memakai alfabet tanpa karakter yang mudah tertukar (tanpa 0/O,
1/I/L, 5/S, 8/B), karena kode itu memang untuk dibacakan atau diketik ulang.

## Aturan dan permainan lokal

Seluruh aturan FIDE diterapkan: rokade beserta larangan melewati petak terancam,
en passant, promosi dengan pilihan bidak, skak, skakmat, dan semua kondisi remis
(stalemate, materi tidak cukup, pengulangan tiga kali, aturan 50 langkah).

Klik dua petak atau seret bidak — keduanya bekerja di desktop maupun layar
sentuh. Melawan komputer tersedia empat tingkat kesulitan, dengan jeda jawaban
minimum 500 ms supaya langkah lawan tidak muncul mendadak.

Pintasan: `←` batalkan langkah (lokal saja), `F` putar papan, `Esc` batal pilih.

## Catatan teknis

**Representasi papan.** Array 64 elemen; indeks 0 adalah a8 dan 63 adalah h1,
sehingga `rank = index >> 3` dan `file = index & 7`. Langkah dibangkitkan
pseudo-legal lalu disaring lewat `makeMove` / `undoMove`.

**Kebenaran engine.** `shared/test/perft.test.ts` mencocokkan jumlah simpul
dengan angka acuan chessprogramming.org untuk lima posisi standar, termasuk
Kiwipete, sampai 197.281 posisi. Ini menangkap kesalahan halus pada rokade,
en passant, dan pin yang biasanya lolos dari pengujian manual.

**Kenapa engine ada di `shared/`.** Server harus memvalidasi setiap langkah,
jadi aturan catur bukan milik client. Menyalinnya ke dua tempat berarti cepat
atau lambat keduanya akan berbeda — dan bedanya baru ketahuan saat pertandingan
sungguhan berjalan. `protocol.ts` ada di sana dengan alasan yang sama: kalau
salah satu sisi mengubah bentuk pesan, `npm run typecheck` yang gagal, bukan
pemain.

**Kenapa `Position` tidak reaktif.** Pencarian AI memanggil `makeMove`/`undoMove`
ratusan ribu kali; membungkusnya dengan proxy Vue akan memperlambatnya
berkali-kali lipat. Papan dimutasi langsung, dan sebuah penghitung `version`
dinaikkan tiap kali posisi berubah — seluruh `computed` bergantung pada itu.

**Web Worker.** Pencarian AI memblokir thread tempat ia berjalan, jadi dijalankan
di worker agar papan tetap responsif. Bila lingkungan melarang module worker,
client otomatis beralih ke jalur sinkron.

## Pengujian

```
shared/   20 tes   perft, SAN, deteksi remis, evaluasi dan pencarian AI
server/   28 tes   aturan room, kursi, token; plus integrasi WebSocket sungguhan
client/   25 tes   state permainan lokal, dan ujung-ke-ujung melawan server asli
```

Tes server dan client sama-sama menyalakan proses server sungguhan pada port
tersendiri lalu bicara lewat WebSocket asli — bukan tiruan. Cara itulah yang
menemukan bug kursi tidak ikut tertukar setelah "main lagi", yang tidak terlihat
saat tiap bagian diuji sendiri-sendiri.
