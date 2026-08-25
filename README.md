# Chess with Mari

[![CI](https://github.com/Yunnie-pin/chess-js/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Yunnie-pin/chess-js/actions/workflows/ci.yml)

Catur di browser: main lawan komputer, atau online bareng temen lewat room.
Engine, AI, sama servernya ditulis sendiri — nggak pakai library catur.

![Papan catur bertema emas dan gading, panel kontrol di kanan, dan potret Mari sebagai latar](https://i.imgur.com/jRiarIT.png)

## Jalanin

```bash
npm install
npm run dev      # server + client sekaligus
```

Client di <http://localhost:5173>, server di <http://localhost:8787>.

Kalau cuma mau main lokal (lawan komputer / dua pemain), servernya nggak usah
dijalanin — `npm run dev:client` aja cukup.

| Perintah             | Buat apa                                    |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | Server + client barengan                    |
| `npm run dev:server` | Server multiplayer doang                    |
| `npm run dev:client` | UI doang                                    |
| `npm test`           | 73 test di tiga workspace                   |
| `npm run typecheck`  | TypeScript strict, termasuk template Vue    |
| `npm run build`      | Build client ke `client/dist/`              |
| `npm start`          | Jalanin server buat production              |

Client nyambung ke `/ws` di origin yang sama, dan dev server Vite yang
nerusin ke server catur. `VITE_SERVER_URL` cuma perlu diisi kalau servernya
memang ada di host lain, misal
`VITE_SERVER_URL=wss://catur.example.com npm run build`.

## Docker

```bash
docker compose up --build      # buka http://localhost:8080
```

nginx nyajiin client sekaligus nerusin `/ws` ke server lewat network internal
compose. Jadi cuma satu port yang kebuka keluar, dan alamat server nggak
ikut ke-bundle — satu image bisa dipakai di domain mana pun.

### Ganti port

Port host diatur lewat `CLIENT_PORT`, nggak usah ngedit `docker-compose.yml`.
Tiga cara, sama aja hasilnya:

```bash
CLIENT_PORT=3000 docker compose up      # sekali jalan
```

```bash
cp .env.example .env                    # permanen; .env nggak ikut ke git
# isi CLIENT_PORT=3000
docker compose up
```

```bash
docker compose --env-file prod.env up   # file env sendiri per environment
```

Mau ngecek dulu tanpa jalanin apa-apa? `docker compose config`, lihat baris
`published`.

Yang berubah cuma port di sisi host. nginx di dalam container tetap di 80, dan
`/ws` ikut pindah sendiri karena client pakai origin yang sama.

Build context dua image ini adalah root repo, bukan foldernya masing-masing,
soalnya dua-duanya pakai workspace `@chess/shared`.

Image server nggak punya tahap compile sama sekali — Node 24 jalanin
TypeScript-nya langsung lewat type stripping.

## Release

Push tag versi bakal nge-build dan push dua image ke GitHub Container Registry:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

```
ghcr.io/yunnie-pin/chess-js/server:1.0.0   :1.0   :1   :latest
ghcr.io/yunnie-pin/chess-js/client:1.0.0   :1.0   :1   :latest
```

Namanya huruf kecil semua karena ghcr nolak huruf besar, sedangkan nama repo
GitHub boleh ada kapitalnya. Yang nurunin `docker/metadata-action`, jadi nggak
ada yang perlu diutak-atik manual.

[`release.yml`](.github/workflows/release.yml) manggil ulang
[`ci.yml`](.github/workflows/ci.yml) duluan — tag nggak otomatis berarti kodenya
sehat, jadi typecheck, test, sama build harus lolos sebelum ada yang nyampe ke
registry. Image dibuat buat `linux/amd64` dan `linux/arm64`. Auth-nya pakai
`GITHUB_TOKEN` bawaan, nggak perlu nyiapin secret.

Package yang baru pertama kali dipush itu private. Buat ngebukanya: tab
**Packages** di halaman repo → pilih packagenya → *Package settings* →
*Change visibility*.

## Kapan test jalan

[`ci.yml`](.github/workflows/ci.yml) ngejalanin `npm ci`, typecheck, semua test,
sama build client di:

- tiap **PR yang nargetin `main`** — sebelum di-merge;
- tiap **push ke `main`** — termasuk commit hasil merge PR, karena merge itu
  memang menghasilkan push ke `main`;
- tiap **tag release**, lewat panggilan ulang dari `release.yml`.

Jadi merge ke `main` selalu kecek dua kali: di PR-nya, terus di commit hasil
merge-nya.

Tapi workflow cuma ngasih tanda merah, bukan ngeblokir. Biar PR yang gagal test
beneran nggak bisa di-merge, nyalain di **Settings → Branches → Add rule** buat
`main`: *Require status checks to pass*, terus pilih check yang namanya
`verify`.


## Struktur

```
shared/     Dipakai bareng client dan server — bukan punya salah satunya
  src/chess.ts       Papan, generate langkah, SAN, status permainan
  src/ai.ts          Negamax + alpha-beta + quiescence
  src/protocol.ts    Kontrak pesan WebSocket + guard buat dua arah
  src/types.ts       Tipe dasar (Piece, Move, GameStatus, …)

server/     Server multiplayer
  src/room.ts        Satu match: kursi, validasi langkah, resign
  src/rooms.ts       Registry room, kode acak, bersih-bersih room mati
  src/index.ts       HTTP + WebSocket, broadcast, heartbeat

client/     UI Vue 3
  src/composables/useChessGame.ts    Main lokal (dua pemain / lawan komputer)
  src/composables/useOnlineGame.ts   Client multiplayer
  src/engine/ai.worker.ts            Bungkus Web Worker buat AI
  src/components/                    Papan, lobby, panel room, riwayat, …
```

## Multiplayer

Bikin room, share kode empat huruf, lawan masuk pakai kode itu. Orang ketiga
yang masuk jadi penonton, bukan ditolak.

**Servernya yang megang source of truth.** Client nggak pernah mutusin sendiri sebuah
langkah itu sah atau nggak. Dia cuma ngirim maunya, server yang ngecek pakai
engine yang sama persis, terus nyiarin state barunya. Client yang telat, beda
versi, atau udah dioprek nggak bisa bikin papan dua pemain jadi beda isi — kalau
dia ngirim langkah ngawur, server nolak terus langsung ngirim state yang
sebenernya biar client-nya balik sinkron.

**Nutup tab bukan berarti kalah.** Tiap pemain pegang token yang disimpen di
`localStorage`. Nyambung lagi pakai token yang sama bakal ngerebut kursi dan
papan yang sama, jadi refresh atau internet sempet putus nggak bikin orang
kelempar dari match yang lagi jalan. Client-nya juga nyambung ulang sendiri
dengan jeda yang makin lama makin panjang.

**Kode room** pakai alfabet tanpa karakter yang gampang ketuker (nggak ada 0/O,
1/I/L, 5/S, 8/B), soalnya kode itu emang buat dibacain atau diketik ulang orang.

## Aturan dan main lokal

Aturan FIDE lengkap: rokade termasuk larangan lewat petak yang keancem,
en passant, promosi pakai pilihan bidak, skak, skakmat, dan semua kondisi remis
(stalemate, materi nggak cukup, posisi ngulang tiga kali, aturan 50 langkah).

Klik dua petak atau drag bidaknya — dua-duanya jalan di desktop maupun layar
sentuh. Lawan komputer ada empat level, dengan jeda balasan minimal 500 ms biar
langkah lawan nggak muncul mendadak.

Shortcut: `←` undo, `F` puter papan, `Esc` batal pilih.

## Catatan teknis

**Representasi papan.** Array 64 elemen; index 0 itu a8 dan 63 itu h1, jadi
`rank = index >> 3` dan `file = index & 7`. Langkah di-generate pseudo-legal
dulu, baru disaring lewat `makeMove` / `undoMove`.

**Engine-nya bener nggak?** `shared/test/perft.test.ts` nyocokin jumlah node
sama angka acuan chessprogramming.org buat lima posisi standar, termasuk
Kiwipete, sampai 197.281 posisi. Ini yang nangkep bug halus di rokade,
en passant, sama pin — jenis bug yang biasanya lolos kalau cuma dites manual.

**Kenapa engine-nya di `shared/`.** Server wajib validasi tiap langkah, jadi
aturan catur bukan punya client. Kalau dicopy ke dua tempat, cepat atau lambat
dua-duanya bakal beda — dan bedanya baru ketahuan pas match beneran jalan.
`protocol.ts` di situ juga alasannya sama: kalau salah satu sisi ngubah bentuk
pesan, yang gagal itu `npm run typecheck`, bukan pemainnya.

**Kenapa `Position` nggak reaktif.** Search AI manggil `makeMove`/`undoMove`
ratusan ribu kali. Kalau dibungkus proxy Vue, lemotnya bisa berkali-kali lipat.
Jadi papannya dimutasi langsung, terus ada counter `version` yang naik tiap
posisi berubah — semua `computed` nempel ke counter itu.

**Web Worker.** Search AI nge-block thread tempat dia jalan, jadi ditaruh di
worker biar papannya tetep responsif. Kalau environment-nya nggak ngebolehin
module worker, client otomatis pindah ke jalur sinkron.

## Testing

```
shared/   20 test   perft, SAN, deteksi remis, evaluasi + search AI
server/   28 test   aturan room, kursi, token; plus integrasi WebSocket beneran
client/   25 test   state main lokal, dan end-to-end lawan server asli
```

Test server sama client dua-duanya nyalain proses server beneran di port
sendiri, terus ngobrol lewat WebSocket asli — bukan mock. Cara ini yang nemuin
bug kursi nggak ikut ketuker abis "main lagi", yang nggak kelihatan pas tiap
bagian dites sendiri-sendiri.
