// UltramaxoMD — WhatsApp Bot (Baileys)

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, proto, generateWAMessageFromContent, prepareWAMessageMedia, getContentType } = require('@whiskeysockets/baileys');
const P = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const fetch = require('node-fetch');
const chalk = require('chalk');
const config = require('./config');
const moment = require('moment-timezone');
const sharp = require('sharp');
let createCanvas, loadImage;
try {
  const canvasPath = require('canvas');
  createCanvas = canvasPath.createCanvas;
  loadImage = canvasPath.loadImage;
} catch (err) {
  console.log('[WARN] Canvas module not loaded. ID Card generator will fail locally.');
}
const { Chess } = require('chess.js');
const cheerio = require('cheerio');
const { translate } = require('bing-translate-api');
const AdmZip = require('adm-zip');
const FormData = require('form-data');
const crypto = require('crypto');
const { tmpdir } = require('os');
const { fileTypeFromBuffer } = require('file-type');

// data files
const groupFile = 'groupList.json';
const groupIdFile = './group_ids.json';
const userListFile = './userList.json';
const userDataFile = './userData.json';
const settingsFile = './settings.json';

function ensureFile(fp, def = []) {
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(def, null, 2));
}
ensureFile(groupFile);
ensureFile(groupIdFile);
ensureFile(userListFile);
ensureFile(userDataFile);
ensureFile('./premium.json');
ensureFile('./admin.json');
if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify({ isPublic: true }, null, 2));

let premiumUsers = JSON.parse(fs.readFileSync('./premium.json'));
let adminUsers = JSON.parse(fs.readFileSync('./admin.json'));
let settings = JSON.parse(fs.readFileSync(settingsFile));

const msgCache = new Map();

function watchF(fp, cb) {
  fs.watch(fp, (ev) => {
    if (ev === 'change') { try { cb(JSON.parse(fs.readFileSync(fp))); } catch {} }
  });
}
watchF('./premium.json', (d) => premiumUsers = d);
watchF('./admin.json', (d) => adminUsers = d);

function savePremiumUsers() { fs.writeFileSync('./premium.json', JSON.stringify(premiumUsers, null, 2)); }
function saveAdminUsers() { fs.writeFileSync('./admin.json', JSON.stringify(adminUsers, null, 2)); }
function saveSettings() { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); }

// helpers
const startTime = Math.floor(Date.now() / 1000);
const PREFIX = config.PREFIX;

function formatRuntime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  return `${d} Hari, ${h} Jam, ${m} Menit, ${sc} Detik`;
}
function getBotRuntime() { return formatRuntime(Math.floor(Date.now() / 1000) - startTime); }
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Selamat Pagi ☀️';
  if (h < 18) return 'Selamat Sore 🌤️';
  return 'Selamat Malam 🌙';
}
function getCurrentDate() {
  return new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function isOwner(number) { return config.OWNER_ID.includes(number); }
function getPremiumStatus(num) {
  const u = premiumUsers.find(x => typeof x === 'object' && String(x.id) === String(num));
  if (u && new Date(u.expiresAt) > new Date()) return 'PREMIUM ✓';
  return 'FREE';
}
function isVerified(number) {
  try { return JSON.parse(fs.readFileSync(userListFile)).includes(number); } catch { return false; }
}
function verifyUser(number, name) {
  const list = JSON.parse(fs.readFileSync(userListFile));
  if (!list.includes(number)) { list.push(number); fs.writeFileSync(userListFile, JSON.stringify(list, null, 2)); }
  const data = JSON.parse(fs.readFileSync(userDataFile));
  if (!data.some(u => u.id === number)) {
    data.push({ id: number, first_name: name, registered_at: new Date().toISOString() });
    fs.writeFileSync(userDataFile, JSON.stringify(data, null, 2));
  }
}
function escapeHTML(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function splitText(text, max = 4000) {
  const parts = [];
  while (text.length > 0) { parts.push(text.slice(0, max)); text = text.slice(max); }
  return parts;
}

// tiktok downloader
async function tiktokDl(url) {
  function fmtNum(n) { return Number(parseInt(n)).toLocaleString().replace(/,/g, '.'); }
  function fmtDate(n) { return new Date(n).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); }
  let data = [];
  const domain = 'https://www.tikwm.com/api/';
  const res = await (await axios.post(domain, {}, {
    headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Origin: 'https://www.tikwm.com', Referer: 'https://www.tikwm.com/', 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
    params: { url, count: 12, cursor: 0, web: 1, hd: 2 }
  })).data.data;
  if (!res) throw '⚠️ Gagal mengambil data!';
  if (res.duration == 0) { res.images.forEach(v => data.push({ type: 'photo', url: v })); }
  else { data.push({ type: 'nowatermark', url: 'https://www.tikwm.com' + (res.play || '/undefined') }, { type: 'nowatermark_hd', url: 'https://www.tikwm.com' + (res.hdplay || '/undefined') }); }
  return { status: true, title: res.title, region: res.region, duration: res.duration + ' detik', cover: 'https://www.tikwm.com' + res.cover,
    stats: { views: fmtNum(res.play_count), likes: fmtNum(res.digg_count), comment: fmtNum(res.comment_count), share: fmtNum(res.share_count) },
    author: { id: res.author.id, fullname: res.author.unique_id, nickname: res.author.nickname, avatar: 'https://www.tikwm.com' + res.author.avatar },
    video_links: data };
}

// game data
const khodamList = ['si ganteng','si jelek','anomali bt script','kang hapus sumber','kang ngocok','Anomali maklu','orang gila','anak rajin','anak cerdas','lonte gurun','dugong','macan yatim','buaya darat','kanjut terbang','kuda kayang','janda salto','lonte alas','jembut singa','gajah terbang','kuda cacat','jembut pink','sabun bolong','ambalambu','megawati','jokowi'];

function komentarTampan(n) { if(n>=100)return'💎 Ganteng dewa.';if(n>=94)return'🔥 Ganteng gila!';if(n>=90)return'😎 Bintang iklan!';if(n>=83)return'✨ Memantulkan kebahagiaan.';if(n>=78)return'🧼 Bersih dan rapih!';if(n>=73)return'🆒 Ganteng natural!';if(n>=68)return'😉 Banyak yang naksir.';if(n>=54)return'🙂 Lumayan sih.';if(n>=50)return'😐 Malu-malu.';if(n>=45)return'😬 Masih bisa lah.';if(n>=35)return'🤔 Bukan harinya.';if(n>=30)return'🫥 Upgrade skincare.';if(n>=20)return'🫣 Coba pose lain?';if(n>=10)return'😭 Yang penting akhlak.';return'😵 Gagal di wajah.';}
function komentarCantik(n) { if(n>=100)return'👑 Level dewi Olympus!';if(n>=94)return'🌟 Glowing parah!';if(n>=90)return'💃 Kayak di runway!';if(n>=83)return'✨ Inner & outer beauty!';if(n>=78)return'💅 Aesthetic tiktok!';if(n>=73)return'😊 Manis dan mempesona!';if(n>=68)return'😍 Bisa jadi idol!';if(n>=54)return'😌 Cantik adem.';if(n>=50)return'😐 Bisa lebih wow.';if(n>=45)return'😬 Lighting lebih terang.';if(n>=35)return'🤔 Unik.';if(n>=30)return'🫥 Butuh makeup.';if(n>=20)return'🫣 Inner beauty aja.';if(n>=10)return'😭 Cinta itu buta.';return'😵 Semoga lucu pas bayi.';}
function komentarKaya(n) { if(n>=100)return'💎 Sultan endorse.';if(n>=90)return'🛥️ Jet pribadi.';if(n>=80)return'🏰 Rumah buat konser.';if(n>=70)return'💼 Bos besar!';if(n>=60)return'🤑 Kaya no debat.';if(n>=50)return'💸 Kaya tapi waras.';if(n>=40)return'💳 Saldo aman.';if(n>=30)return'🏦 Kaya dari tampang.';if(n>=20)return'🤔 Cukup buat kopi.';if(n>=10)return'🫠 Kaya hati.';return'🙃 Duit imajinasi.';}
function komentarMiskin(n) { if(n>=100)return'💀 Miskin absolut.';if(n>=90)return'🥹 Beli gorengan mikir 3x.';if(n>=80)return'😩 Isi dompet: angin.';if(n>=70)return'😭 Bayar parkir utang.';if(n>=60)return'🫥 Beli pulsa receh?';if(n>=50)return'😬 Indomie dibagi dua.';if(n>=40)return'😅 Token 5 ribu.';if(n>=30)return'😔 Sering nanya gratis.';if(n>=20)return'🫣 Semoga dapet bansos.';if(n>=10)return'🥲 Yang penting hidup.';return'😵 Gaji = 0.';}
function komentarJanda(n) { if(n>=100)return'🔥 Janda premium.';if(n>=90)return'💋 Bekas tapi segel.';if(n>=80)return'🛵 Banyak ngajak balikan.';if(n>=70)return'🌶️ Laku keras.';if(n>=60)return'🧕 Sekarang bersinar.';if(n>=50)return'🪞 Upload status galau.';if(n>=40)return'🧍‍♀️ Low-profile.';if(n>=30)return'💔 Ditinggal pas sayang2nya.';if(n>=20)return'🫥 Masih labil.';if(n>=10)return'🥲 Perlu support.';return'🚫 Masih istri orang.';}
function komentarPacar(n) { if(n>=95)return'💍 Sudah tunangan.';if(n>=85)return'❤️ Pacaran 3 tahun.';if(n>=70)return'😍 Lagi anget2nya.';if(n>=60)return'😘 Sering video call.';if(n>=50)return'🫶 Saling sayang LDR.';if(n>=40)return'😶 Dibilang pacaran belum tentu.';if(n>=30)return'😅 Masih PDKT.';if(n>=20)return'🥲 Sering dicuekin.';if(n>=10)return'🫠 Naksir diam2.';return'❌ Jomblo murni.';}

const aktivitas = {
  pagi: ["Lagi nyari sarapan 🍞","Baru bangun loading ☕","Olahraga jempol scroll TikTok 🏋️","Ngopi liatin grup 🧃","Cari motivasi di IG ✨","Dengerin ayam berantem 🐓","Nonton matahari di wallpaper 🌄","Ngelamun di kamar mandi 🚿","Cari sendal hilang 🩴","Mikir kenapa Senin cepat 😩"],
  siang: ["Pura2 kerja baca komik 💼","Ngelamun di depan nasi padang 🍛","Ngadem di AC kantor orang 😎","Dengerin dosen mikirin liburan 📚","Rebutan colokan di kafe ☕","Debat makan siang 🍜","Scroll Shopee bokek 🛒","Cari sinyal buat tugas 📶","Nyari alasan skip kelas 🙃","Ngintip jam nunggu pulang 🕒"],
  sore: ["Main bola pake sandal ⚽","Liat langit biar deep 🌇","Nyemil tahu bulat 🚚","Ngopi senja aesthetic ☕","Nungguin hujan malah panas 🌤️","Jalan2 cari wifi 🚶","Mikir mau ngapain malam 🤔","Bantu emak belanja 🛍️","Main sama kucing tetangga 🐱","Galau liat story mantan 😔"],
  malam: ["Nonton anime lupa tugas 📺","Galau dengerin lagu lawas 🎧","Curhat ke AI 🤖","Merenungi hidup rebahan 😔","Nyalain lampu tumblr 🌃","Ngetik chat panjang ga dikirim 💬","Nungguin pesan ga datang 📭","Stalk akun random 🕵️","Ngedit story ga jadi upload 📸","Begadang ga tau buat apa 🌙"]
};

function getWaktu() { const j = new Date().getHours(); if (j >= 4 && j < 11) return 'pagi'; if (j >= 11 && j < 15) return 'siang'; if (j >= 15 && j < 18) return 'sore'; return 'malam'; }
function getRandomAktivitas() { const w = getWaktu(); const d = aktivitas[w]; return { waktu: w, teks: d[Math.floor(Math.random() * d.length)] }; }

const jobs = [
  { title: "Web Developer", emoji: "💻", desc: "Membuat situs web modern." },
  { title: "Mobile App Developer", emoji: "📱", desc: "Membangun aplikasi mobile." },
  { title: "UI/UX Designer", emoji: "🎨", desc: "Merancang antarmuka." },
  { title: "Graphic Designer", emoji: "🖌️", desc: "Desain visual kreatif." },
  { title: "Backend Developer", emoji: "🧠", desc: "Mengelola logika dan database." },
  { title: "Frontend Developer", emoji: "🖼️", desc: "Tampilan antarmuka." },
  { title: "Fullstack Developer", emoji: "🔁", desc: "Frontend dan backend." },
  { title: "DevOps Engineer", emoji: "⚙️", desc: "Otomatisasi infrastruktur." },
  { title: "Game Developer", emoji: "🎮", desc: "Membuat game digital." },
  { title: "Cybersecurity Specialist", emoji: "🔐", desc: "Melindungi sistem." },
  { title: "Data Scientist", emoji: "🧬", desc: "Analisis data." },
  { title: "AI Engineer", emoji: "🤖", desc: "Kecerdasan buatan." },
  { title: "Cloud Architect", emoji: "☁️", desc: "Solusi cloud." },
  { title: "Blockchain Developer", emoji: "⛓️", desc: "Aplikasi blockchain." },
  { title: "Content Writer", emoji: "✍️", desc: "Menulis konten." },
  { title: "Video Editor", emoji: "🎞️", desc: "Mengedit video." },
  { title: "3D Artist", emoji: "🧱", desc: "Grafik dan animasi 3D." },
  { title: "Freelancer", emoji: "🧳", desc: "Pekerja lepas." },
  { title: "Startup Founder", emoji: "🚀", desc: "Mendirikan startup." },
  { title: "No-Code Developer", emoji: "🧩", desc: "Tanpa menulis kode." }
];
function hashUsername(u) { if (!u) return Math.floor(Math.random() * jobs.length); let h = 0; for (let i = 0; i < u.length; i++) h += u.charCodeAt(i) * (i + 1); return h % jobs.length; }

const waifuList = [
  "https://i.pinimg.com/736x/c3/53/d5/c353d5b69271d572a1b1bec8ff50f4b2.jpg",
  "https://i.pinimg.com/736x/40/28/4c/40284c46155cb812372e9895066b1b28.jpg",
  "https://i.pinimg.com/736x/52/c2/53/52c253338492f7b6185637378fefd2a1.jpg",
  "https://i.pinimg.com/736x/44/ed/fd/44edfde351c836c760f7db7fa75bf77c.jpg",
  "https://i.pinimg.com/736x/eb/72/de/eb72de9117538e2bf445a6130030abe9.jpg",
  "https://i.pinimg.com/originals/53/2f/f8/532ff81b4f3bc92c8db823f2cea3d7a6.jpg",
  "https://i.pinimg.com/originals/91/5e/47/915e47e83801b992ff66d92dc8cc1244.jpg",
  "https://i.pinimg.com/originals/41/2e/f3/412ef39c4244861c287675498a9c6296.png",
  "https://i.pinimg.com/originals/89/68/6e/89686edeb4316f53832e00ea7980cf01.jpg",
  "https://i.pinimg.com/736x/cd/53/b0/cd53b02aec22e034be15c42d81fea760.jpg",
  "https://i.pinimg.com/736x/d4/66/47/d466476d52f5db16f042cc660eefb66d.jpg",
  "https://i.pinimg.com/736x/f6/16/7f/f6167f6a8cfb2e8471bb71ccb6983ef1.jpg",
  "https://i.pinimg.com/originals/23/8d/3a/238d3abe793fcdd198efd85308f1bce9.jpg",
  "https://i.pinimg.com/originals/74/35/b1/7435b1c713e956dd946c6721e19e6e14.jpg",
  "https://i.pinimg.com/originals/e6/96/63/e69663c0f775438826c62e02c8b8eac8.jpg",
  "https://i.pinimg.com/originals/15/d1/c5/15d1c53899bafb2fd4b06b66bb6deb50.jpg",
  "https://i.pinimg.com/originals/8f/31/17/8f31178899d16701c0764cda76430433.png",
  "https://i.pinimg.com/originals/1d/a6/1a/1da61a5df4a31dd394758b035b17320e.jpg",
  "https://i.pinimg.com/originals/42/e2/2c/42e22c72db81ff2c2900badfea2aaad1.jpg",
  "https://i.pinimg.com/originals/b6/03/80/b6038086c1c26c47f84c1f73851e74b2.jpg",
  "https://i.pinimg.com/originals/b6/32/dd/b632dd5f206d8295e4dfdac93411e75c.jpg",
  "https://i.pinimg.com/originals/a4/f2/ce/a4f2cec43267f37efd7cca541385d706.jpg",
  "https://i.pinimg.com/originals/ce/4f/4b/ce4f4b7635e8c8ab5c8db2911edd4249.jpg",
  "https://i.pinimg.com/originals/54/2a/01/542a017e6b4b677bc5d79f5bb8943476.jpg",
  "https://i.pinimg.com/originals/b5/7d/54/b57d54e40df741ddd37adbb0de41e004.jpg",
  "https://i.pinimg.com/originals/12/e5/35/12e535a4c8da2694f22809eb456886e9.png",
  "https://i.pinimg.com/originals/eb/74/1b/eb741b162e3255172bac9f19fa40d06c.jpg",
  "https://i.pinimg.com/originals/d6/b9/34/d6b934119056594f17a94192110cdbd8.jpg",
  "https://i.pinimg.com/originals/46/79/25/467925d52634fd098ab6890a23c33f30.jpg",
  "https://i.pinimg.com/originals/44/4b/9b/444b9b8136ba26466b75136ef5d684cb.jpg",
  "https://i.pinimg.com/originals/79/ac/74/79ac742105acb071fac7eacbb2ff1e14.jpg",
  "https://i.pinimg.com/originals/c9/71/fd/c971fd4936c93b8343691952a88e3199.jpg",
  "https://i.pinimg.com/originals/1b/f2/c5/1bf2c59a4b5c977ee61d0b5739da8a84.jpg",
  "https://i.pinimg.com/originals/42/2b/bf/422bbfbaaeb2d5b62ece67206cdb1ae5.jpg",
  "https://i.pinimg.com/originals/fa/ad/b0/faadb0977c90790eb72f051e4966059c.jpg",
  "https://i.pinimg.com/originals/dc/e9/f9/dce9f9beb37722c1d4c460065a37e252.jpg",
  "https://i.pinimg.com/originals/94/bd/e9/94bde9abb7f5d25ae7f1548b65c2869e.jpg",
  "https://i.pinimg.com/originals/04/eb/2f/04eb2f337389bf0b1247fb31aff9f93f.jpg",
  "https://i.pinimg.com/originals/da/1c/ac/da1cac1d1cc919ec4362b6dac5bb539d.jpg",
  "https://i.pinimg.com/originals/6c/8d/19/6c8d196474794342a5b07ff57a78fecb.jpg",
  "https://i.pinimg.com/originals/f0/49/5c/f0495c7f50d78e28e31645d8adc38603.jpg",
  "https://i.pinimg.com/originals/9a/fa/d1/9afad13f18ada18954231ee93708040b.jpg",
  "https://i.pinimg.com/originals/27/ca/b1/27cab176e51f16f4513c0e139c52a401.png",
  "https://i.pinimg.com/originals/b3/6e/84/b36e84613cc59a7b5c5e280ce7a91502.jpg",
  "https://i.pinimg.com/originals/e6/e3/87/e6e3876124a051597fd113a3f3308941.png",
  "https://i.pinimg.com/originals/b2/33/68/b233685b5910013a24d7a970ee77fa03.jpg",
  "https://i.pinimg.com/originals/ac/b2/6c/acb26c516d6681e922f6aeb3f3848d2f.jpg",
  "https://i.pinimg.com/originals/f3/fe/61/f3fe619cd29b07f0a8f8b213f2005bba.jpg",
  "https://i.pinimg.com/originals/a0/9b/86/a09b864c3234ea0c6c420187e4c0a721.jpg",
  "https://i.pinimg.com/originals/67/09/ee/6709ee13ea60b70d1aaaac9f2060c8b8.jpg"
];
function getRandomWaifu() { return waifuList[Math.floor(Math.random() * waifuList.length)]; }

// tebak game sources
const tebakUrls = {
  tebakkata: 'https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakkata.json',
  tebakkalimat: 'https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakkalimat.json',
  tebaktebakan: 'https://raw.githubusercontent.com/BochilTeam/database/master/games/tebaktebakan.json',
  tebakgambar: 'https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakgambar.json',
  tebaklirik: 'https://raw.githubusercontent.com/BochilTeam/database/master/games/tebaklirik.json',
  tebakbendera: 'https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakbendera.json',
  tebakkabupaten: 'https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakkabupaten.json',
};
async function loadSoal(type) {
  const res = await fetch(tebakUrls[type]);
  const data = await res.json();
  return data[Math.floor(Math.random() * data.length)];
}

// chess board renderer
function createBoardText(chess) {
  const board = chess.board();
  const pieces = { p:'♟',r:'♜',n:'♞',b:'♝',q:'♛',k:'♚',P:'♙',R:'♖',N:'♘',B:'♗',Q:'♕',K:'♔' };
  let text = '';
  for (let i = 7; i >= 0; i--) {
    text += (i + 1) + ' ';
    for (let j = 0; j < 8; j++) {
      const sq = board[i][j];
      text += sq ? pieces[sq.color === 'w' ? sq.type.toUpperCase() : sq.type] + ' ' : '· ';
    }
    text += '\n';
  }
  text += '  a b c d e f g h';
  return '```\n' + text + '\n```';
}

// tictactoe engine
class TicTacToe {
  constructor(p1, p2) {
    this.board = Array(3).fill().map(() => Array(3).fill(''));
    this.p1 = p1; this.p2 = p2; this.turn = p1; this.winner = null;
  }
  move(player, row, col) {
    if (this.winner || this.board[row][col]) return false;
    if (player !== this.turn) return false;
    this.board[row][col] = player === this.p1 ? '❌' : '⭕';
    if (this.checkWin(this.board[row][col])) this.winner = player;
    else if (this.isDraw()) this.winner = 'draw';
    else this.turn = player === this.p1 ? this.p2 : this.p1;
    return true;
  }
  checkWin(sym) {
    const b = this.board;
    const lines = [[b[0][0],b[0][1],b[0][2]],[b[1][0],b[1][1],b[1][2]],[b[2][0],b[2][1],b[2][2]],
      [b[0][0],b[1][0],b[2][0]],[b[0][1],b[1][1],b[2][1]],[b[0][2],b[1][2],b[2][2]],
      [b[0][0],b[1][1],b[2][2]],[b[0][2],b[1][1],b[2][0]]];
    return lines.some(l => l.every(c => c === sym));
  }
  isDraw() { return this.board.flat().every(c => c !== ''); }
  render() {
    let t = '    1    2    3\n';
    const labels = ['A', 'B', 'C'];
    for (let i = 0; i < 3; i++) {
      t += labels[i] + '  ';
      for (let j = 0; j < 3; j++) t += (this.board[i][j] || '⬜') + '  ';
      t += '\n';
    }
    return t;
  }
  getStatus(names) {
    if (this.winner === 'draw') return '⚖️ Seri!';
    if (this.winner) return `🏆 ${names[this.winner]} menang!`;
    return `🎯 Giliran: ${names[this.turn]}`;
  }
}

// game sessions
const gameSessions = new Map();    // tebak games
const sesiAsahOtak = {};           // asah otak
const chessGames = {};             // chess by chatId
const battleSessions = {};         // perang
const tttGames = {};               // tictactoe
const cooldowns = new Map();

// bot initialization
const qrcode = require('qrcode-terminal');

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  // fetch WA web version
  let waVersion;
  try {
    const { fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
    console.log(chalk.cyan(`[*] Using WA Web version: ${version}`));
  } catch {
    waVersion = [2, 3000, 1015901307];
    console.log(chalk.yellow(`[*] Using fallback version: ${waVersion}`));
  }

  const sock = makeWASocket({
    auth: state,
    version: waVersion,
    logger: P({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    keepAliveIntervalMs: 30000,
    emitOwnEvents: true,
    markOnlineOnConnect: true
  });

  if (!sock.authState.creds.registered) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (text) => new Promise((resolve) => rl.question(text, resolve));
    
    setTimeout(async () => {
      let phoneNumber = await question(chalk.cyan(`\n📱 Masukkan nomor WhatsApp Bot (awali dengan 62, contoh: 628123...): `));
      phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
      const code = await sock.requestPairingCode(phoneNumber);
      console.log(chalk.green.bold(`\n🔑 KODE PAIRING KAMU: ${code?.match(/.{1,4}/g)?.join('-') || code}`));
      console.log(chalk.yellow(`Penting: Buka WhatsApp Bot HP > Perangkat Tertaut > Tautkan dengan Nomor > Masukkan kode di atas!\n`));
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    // pairing code mode — QR disabled
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(chalk.red(`[!] Connection closed. Code: ${statusCode}`));
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 440) {
        console.log(chalk.red(`[!] Session dead or conflicting (Code ${statusCode}). Cleaning auth...`));
        fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
        process.exit(1);
      } else {
        console.log(chalk.yellow(`[!] Reconnecting due to Code: ${statusCode}. Forcing hard restart...`));
        process.exit(1); // Force Pterodactyl to restart cleanly instead of stacking sockets!
      }
    } else if (connection === 'open') {
      console.log(chalk.green.bold(`\n╔════════════════════════════════╗`));
      console.log(chalk.green.bold(`║   ${config.botName} Connected!    ║`));
      console.log(chalk.green.bold(`║   Dev: ${config.devTelegram}            ║`));
      console.log(chalk.green.bold(`╚════════════════════════════════╝\n`));
    }
  });

  // group participant events
  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;
    try {
      const metadata = await sock.groupMetadata(id);
      if (action === 'add') {
        const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
        if (participants.includes(botJid)) {
          // bot joined group
          let groupList = JSON.parse(fs.readFileSync(groupFile));
          if (!groupList.some(g => g.id === id)) {
            groupList.push({ id, title: metadata.subject });
            fs.writeFileSync(groupFile, JSON.stringify(groupList, null, 2));
          }
          await sock.sendMessage(id, { text: `✅ *${config.botName}* telah bergabung di grup *${metadata.subject}*!\n\nKetik *${PREFIX}menu* untuk melihat fitur.` });
        }
      }
    } catch {}
  });

  // message handler
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message) return;

    // cache view once messages to survive mediaKey stripping
    if (msg.message.viewOnceMessage || msg.message.viewOnceMessageV2 || msg.message.viewOnceMessageV2Extension) {
       msgCache.set(msg.key.id, msg);
       if (msgCache.size > 500) msgCache.delete(msgCache.keys().next().value); // prevent memory leak
    }

    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    let sender = isGroup ? msg.key.participant : jid;
    if (msg.key.fromMe) sender = config.OWNER_ID[0] + '@s.whatsapp.net';
    const senderNumber = sender.split('@')[0].split(':')[0];
    const pushName = msg.pushName || 'Owner';

    // extract message body
    let body = '';
    // unwrap viewOnce
    let realMsg = msg.message;
    if (realMsg?.viewOnceMessage) realMsg = realMsg.viewOnceMessage.message;
    if (realMsg?.viewOnceMessageV2) realMsg = realMsg.viewOnceMessageV2.message;
    const mtype = getContentType(realMsg);
    if (mtype === 'conversation') body = realMsg.conversation;
    else if (mtype === 'extendedTextMessage') body = realMsg.extendedTextMessage.text;
    else if (mtype === 'imageMessage') body = realMsg.imageMessage?.caption || '';
    else if (mtype === 'videoMessage') body = realMsg.videoMessage?.caption || '';
    else if (mtype === 'buttonsResponseMessage') body = realMsg.buttonsResponseMessage?.selectedButtonId || '';
    else if (mtype === 'templateButtonReplyMessage') body = realMsg.templateButtonReplyMessage?.selectedId || '';
    else if (mtype === 'listResponseMessage') body = realMsg.listResponseMessage?.singleSelectReply?.selectedRowId || '';
    else if (mtype === 'interactiveResponseMessage') {
      try { 
        let params = realMsg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
        if (typeof params === 'string') params = JSON.parse(params);
        body = params?.id || ''; 
      } catch (e) {
        console.error('Interactive MSG Parse Error:', e);
      }
    }

    // quoted message
    const contextInfo = realMsg?.[mtype]?.contextInfo || msg.message?.[getContentType(msg.message)]?.contextInfo || {};
    const quotedMsg = contextInfo.quotedMessage;
    const quotedParticipant = contextInfo.participant;
    const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || quotedMsg?.imageMessage?.caption || '';

    // reply helper
    const reply = async (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    // download media
    const dlMedia = async () => {
      try { return await downloadMediaMessage(msg, 'buffer', {}); } catch { return null; }
    };

    // download quoted media
    const dlQuotedMedia = async () => {
      if (!quotedMsg) return null;
      try {
        const qtype = Object.keys(quotedMsg)[0];
        const fakeMsg = { key: { remoteJid: jid, id: contextInfo.stanzaId, participant: isGroup ? quotedParticipant : undefined }, message: quotedMsg };
        return await downloadMediaMessage(fakeMsg, 'buffer', {});
      } catch { return null; }
    };

    // console logger
    const timeStamp = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
    if (body) {
      console.log(chalk.white.bold(`\n ═══ ${config.botName} ═══`));
      console.log(chalk.green('TIME  :'), chalk.blue(timeStamp));
      console.log(chalk.green('USER  :'), chalk.yellow(pushName));
      console.log(chalk.green('FROM  :'), chalk.magenta(isGroup ? jid : 'Private'));
      console.log(chalk.green('CHAT  :'), chalk.cyan(body.slice(0, 100)));
      console.log('');
    }

    // mode check
    if (!settings.isPublic && isGroup && !isOwner(senderNumber)) return;

    // parse command
    const isCommand = body.startsWith(PREFIX);
    const command = isCommand ? body.slice(PREFIX.length).split(' ')[0].toLowerCase() : '';
    const args = isCommand ? body.slice(PREFIX.length + command.length).trim() : '';

    if (isCommand) {
      console.log(chalk.blue(`[DEBUG] senderNumber: '${senderNumber}', OWNER_ID: '${config.OWNER_ID[0]}', isOwner: ${isOwner(senderNumber)}, fromMe: ${msg.key.fromMe}`));
    }
    
    // verify check
    if (isCommand && !isOwner(senderNumber) && !isVerified(senderNumber) && command !== 'verify') {
      return reply(`❌ *Kamu belum terverifikasi!*\n\n1️⃣ Join channel: ${config.channelUrl}\n2️⃣ Ketik *${PREFIX}verify* untuk verifikasi\n\n_Bot ini GRATIS, tapi wajib join channel!_`);
    }

    // command handler
    if (isCommand) {
      try {
      switch (command) {

        // verify
        case 'verify': {
          if (isOwner(senderNumber) || isVerified(senderNumber)) return reply('✅ Kamu sudah terverifikasi!');
          verifyUser(senderNumber, pushName);
          await reply(`✅ Berhasil terverifikasi!\n\nSelamat menggunakan *${config.botName}*!\nKetik *${PREFIX}menu* untuk melihat daftar fitur.`);
          const ownerJid = config.OWNER_ID[0] + '@s.whatsapp.net';
          sock.sendMessage(ownerJid, { text: `📢 *User Baru Terverifikasi!*\n👤 ${pushName}\n📱 ${senderNumber}\n⏰ ${timeStamp}` });
          break;
        }

        // menu
        case 'menu': case 'start': {
          const status = getPremiumStatus(senderNumber);
          const runtime = getBotRuntime();
          const greeting = getGreeting();
          const menuBody = `${greeting}

╭──「 *${config.botName}* 」──
│ 👤 User: ${pushName}
│ 📱 Number: ${senderNumber}
│ 📊 Status: ${status}
│ ⏱️ Runtime: ${runtime}
│ 📅 ${getCurrentDate()}
╰──────────────────`;
          const imageMedia = await prepareWAMessageMedia({ image: fs.readFileSync('./logo.png') }, { upload: sock.waUploadToServer });
          const menuBtns = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadata: {},
                  deviceListMetadataVersion: 2
                },
                interactiveMessage: proto.Message.InteractiveMessage.create({
                  contextInfo: {
                    mentionedJid: [sender],
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                      newsletterJid: '120363181827494553@newsletter',
                      newsletterName: 'Powered by UltramaxoMD',
                      serverMessageId: -1
                    }
                  },
                  contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 9999,
                    isForwarded: true
                  },
                  contextInfo: {
                    mentionedJid: [sender],
                    isForwarded: true,
                    forwardingScore: 9999
                  },
                  header: proto.Message.InteractiveMessage.Header.create({
                    title: ``,
                    hasMediaAttachment: true,
                    imageMessage: imageMedia.imageMessage
                  }),
                  body: proto.Message.InteractiveMessage.Body.create({
                    text: menuBody
                  }),
                  footer: proto.Message.InteractiveMessage.Footer.create({
                    text: `© ${config.botName} | ${config.devTelegram}`
                  }),
                  nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: [
                      { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📋 ALL MENU', id: `${PREFIX}allmenu` }) },
                      { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📌 SCRIPT INFO', id: `${PREFIX}script` }) },
                      { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '👑 OWNER', id: `${PREFIX}owner` }) }
                    ]
                  })
                })
              }
            }
          }, {});
          await sock.relayMessage(jid, menuBtns.message, { messageId: menuBtns.key.id });
          break;
        }

        // all menu
        case 'allmenu': {
          const menuText = `╭──「 *${config.botName} MENU* 」
│
│ *🔧 TOOLS*
│ ${PREFIX}tiktok - Download TikTok
│ ${PREFIX}play - Download musik
│ ${PREFIX}mediafire - Download MediaFire
│ ${PREFIX}tourl - Upload ke Catbox
│ ${PREFIX}brat - Stiker brat
│ ${PREFIX}qc - Quote Card
│ ${PREFIX}sticker - Foto to Sticker
│ ${PREFIX}stiktok - Search TikTok
│ ${PREFIX}translate - Terjemahkan
│ ${PREFIX}nulis - Tulis di kertas
│ ${PREFIX}getcode - Ambil source code
│ ${PREFIX}getcodezip - Ambil code + ZIP
│ ${PREFIX}infogempa - Info gempa BMKG
│
│ *🤖 AI*
│ ${PREFIX}ai - AI Assistant
│ ${PREFIX}gpt - ChatGPT
│ ${PREFIX}fixcode - Perbaiki kode
│ ${PREFIX}fixcode2 - Perbaiki kode (ZIP)
│ ${PREFIX}fixcodeerror - Fix error spesifik
│ ${PREFIX}editcode - Edit kode
│
│ *🔍 STALK*
│ ${PREFIX}igstalk - Instagram
│ ${PREFIX}ttstalk - TikTok
│ ${PREFIX}twstalk - Twitter
│ ${PREFIX}ytstalk - YouTube
│ ${PREFIX}pinstalk - Pinterest
│ ${PREFIX}threadsstalk - Threads
│ ${PREFIX}ghstalk - GitHub
│ ${PREFIX}stalkff - Free Fire
│ ${PREFIX}stalkmlbb - MLBB
│
│ *🎮 GAME*
│ ${PREFIX}tebakkata - Tebak Kata
│ ${PREFIX}tebakgambar - Tebak Gambar
│ ${PREFIX}tebakbendera - Tebak Bendera
│ ${PREFIX}tebakkabupaten - Tebak Kabupaten
│ ${PREFIX}tebaklirik - Tebak Lirik
│ ${PREFIX}tebaktebakan - Tebak Tebakan
│ ${PREFIX}asahotak - Asah Otak
│ ${PREFIX}catur - Main Catur
│ ${PREFIX}tictactoe - Tic Tac Toe
│ ${PREFIX}perang - Battle PvP
│
│ *📊 CEK*
│ ${PREFIX}cekkhodam - Cek Khodam
│ ${PREFIX}cekpacar - Cek Pacar
│ ${PREFIX}cektampan - Cek Tampan
│ ${PREFIX}cekcantik - Cek Cantik
│ ${PREFIX}cekkaya - Cek Kaya
│ ${PREFIX}cekmiskin - Cek Miskin
│ ${PREFIX}cekjanda - Cek Janda
│ ${PREFIX}ceklokasi - Cek Lokasi
│ ${PREFIX}ceksedangapa - Cek Sedang Apa
│
│ *🎲 RANDOM*
│ ${PREFIX}waifu - Random Waifu
│ ${PREFIX}pakustad - Tanya Ustad
│ ${PREFIX}xnxx - Search XNXX
│ ${PREFIX}profil - Profil User
│ ${PREFIX}cekid - ID Card
│ ${PREFIX}xid - ID Card v2
│ ${PREFIX}info - Info User
│ ${PREFIX}done - Transaksi
│
│ *👥 GRUP*
│ ${PREFIX}kick - Kick member
│ ${PREFIX}invite - Invite link
│ ${PREFIX}addgroupid - Tambah grup
│ ${PREFIX}delgroupid - Hapus grup
│ ${PREFIX}listgroupid - List grup
│ ${PREFIX}cfdgroup - Broadcast grup
│ ${PREFIX}bc - Broadcast teks
│ ${PREFIX}bc2 - Broadcast media
│
│ *👑 OWNER*
│ ${PREFIX}addprem - Add premium
│ ${PREFIX}delprem - Del premium
│ ${PREFIX}listprem - List premium
│ ${PREFIX}addowner - Add admin
│ ${PREFIX}delowner - Del admin
│ ${PREFIX}users - Lihat users
│ ${PREFIX}listusr - Daftar user
│ ${PREFIX}private - Mode private
│ ${PREFIX}public - Mode public
╰──────────────────`;
          await reply(menuText);
          break;
        }

        case 'owner': {
          const ownerJid = config.OWNER_ID[0] + '@s.whatsapp.net';
          const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${config.botName} Owner\nTEL;type=CELL;waid=${config.OWNER_ID[0]}:+${config.OWNER_ID[0]}\nEND:VCARD`;
          await sock.sendMessage(jid, { contacts: { displayName: `${config.botName} Owner`, contacts: [{ vcard }] } }, { quoted: msg });
          break;
        }

        // ai assistant
        case 'ai': case 'gpt': {
          if (!args) return reply(`❌ Masukkan pertanyaan!\nContoh: ${PREFIX}${command} siapa presiden indonesia?`);
          await reply('⏳ _Sedang berpikir..._');
          try {
            const { default: fetch } = require('node-fetch');
            const response = await fetch('https://api.maia.userevaluation.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ISI_API_KEY_KAMU_DISINI`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: 'xai/grok-4-fast-non-reasoning',
                messages: [
                  { role: 'system', content: `Kamu adalah ${config.botName}, AI assistant WhatsApp yang keren.` },
                  { role: 'user', content: args }
                ],
              })
            });
            const data = await response.json();
            if (data?.choices?.[0]?.message?.content) {
              reply(data.choices[0].message.content.trim());
            } else {
              reply(`❌ Gagal mendapatkan respon dari AI. (Data Kosong)`);
            }
          } catch (err) {
            console.error('[AI ERROR]', err.message);
            reply(`❌ AI Error: ${err.message}`);
          }
          break;
        }

        // private/public mode
        case 'private': {
          if (!isOwner(senderNumber)) return reply('❌ Owner only!');
          settings.isPublic = false;
          saveSettings();
          reply('🔒 Bot sekarang dalam *mode PRIVATE*.\nHanya merespon di Private Chat dan Owner di grup.');
          break;
        }

        // read view once
        case 'rvo': case 'readviewonce': {
          if (!quotedMsg) return reply('❌ Reply pesan *View Once (1x lihat)* dengan command ini!');
          
          let isViewOnce = false;
          let realViewOnce = null;
          const qtype = Object.keys(quotedMsg)[0];

          if (quotedMsg.viewOnceMessage || quotedMsg.viewOnceMessageV2 || quotedMsg.viewOnceMessageV2Extension) {
             isViewOnce = true;
             realViewOnce = (quotedMsg.viewOnceMessage || quotedMsg.viewOnceMessageV2 || quotedMsg.viewOnceMessageV2Extension).message;
          } else if (quotedMsg[qtype]?.viewOnce === true) {
             isViewOnce = true;
             realViewOnce = quotedMsg;
          }
          
          if (!isViewOnce) {
             return reply(`❌ Pesan yang direply bukan View Once! (Terdeteksi: ${qtype})`);
          }
          
          try {
            await reply('⏳ Membuka segel privasi pesan...');
            
            // Use cache because WhatsApp removes mediaKey from quoted view once messages
            const cachedMsg = msgCache.get(contextInfo.stanzaId);
            const targetMsg = cachedMsg ? cachedMsg : { key: { remoteJid: jid, id: contextInfo.stanzaId, participant: isGroup ? quotedParticipant : undefined }, message: realViewOnce };
            
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            
            let buffer;
            try { 
              buffer = await downloadMediaMessage(targetMsg, 'buffer', {}); 
            } catch (err) {
              if (err.message.includes('media key')) {
                 throw new Error('Kunci media hangus dan tidak ada di memori. Pastikan pesan View Once dikirim *setelah* bot menyala.');
              }
              throw err;
            }
            if (!buffer) throw new Error('Gagal menarik isi buffer media');

            const mediaMessage = cachedMsg ? (cachedMsg.message.viewOnceMessage?.message || cachedMsg.message.viewOnceMessageV2?.message || cachedMsg.message.viewOnceMessageV2Extension?.message || cachedMsg.message) : realViewOnce;
            const mediaType = Object.keys(mediaMessage)[0] === 'senderKeyDistributionMessage' ? Object.keys(mediaMessage)[1] : Object.keys(mediaMessage)[0];

            const caption = realViewOnce[mediaType]?.caption || '';
            const tag = `🔓 *RVO Terbuka!*\n` + (caption ? `\n📝 Keterangan: ${caption}` : '');
            
            if (mediaType === 'imageMessage') {
                await sock.sendMessage(jid, { image: buffer, caption: tag }, { quoted: msg });
            } else if (mediaType === 'videoMessage') {
                await sock.sendMessage(jid, { video: buffer, caption: tag }, { quoted: msg });
            } else if (mediaType === 'audioMessage') {
                await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, { quoted: msg });
            } else {
                return reply(`❌ Format media tidak didukung RVO. (${mediaType})`);
            }
          } catch (e) {
            console.error('[RVO Error]', e);
            reply(`❌ Gagal membongkar media: ${e.message}`);
          }
          break;
        }
        case 'public': {
          if (!isOwner(senderNumber)) return reply('❌ Owner only!');
          settings.isPublic = true;
          saveSettings();
          reply('🌐 Bot sekarang dalam *mode PUBLIC*.\nMerespon di semua chat.');
          break;
        }

        // broadcast
        case 'bc': {
          if (senderNumber !== config.ADMIN_ID) return reply('❌ Admin only!');
          if (!args) return reply('❌ Teks broadcast kosong!');
          const groupList = JSON.parse(fs.readFileSync(groupFile));
          let count = 0;
          for (const g of groupList) { try { await sock.sendMessage(g.id, { text: `📢 *Broadcast:*\n${args}` }); count++; } catch {} }
          reply(`✅ Broadcast terkirim ke *${count}* grup!`);
          break;
        }
        case 'bc2': {
          if (senderNumber !== config.ADMIN_ID) return reply('❌ Admin only!');
          if (!quotedMsg) return reply('❌ Reply media yang ingin dibroadcast!');
          const groupList2 = JSON.parse(fs.readFileSync(groupFile));
          let count2 = 0;
          const buffer = await dlQuotedMedia();
          const qtype = Object.keys(quotedMsg)[0];
          for (const g of groupList2) {
            try {
              if (qtype === 'imageMessage') await sock.sendMessage(g.id, { image: buffer, caption: quotedMsg.imageMessage?.caption || '' });
              else if (qtype === 'videoMessage') await sock.sendMessage(g.id, { video: buffer, caption: quotedMsg.videoMessage?.caption || '' });
              else if (qtype === 'conversation' || qtype === 'extendedTextMessage') await sock.sendMessage(g.id, { text: quotedText });
              count2++;
            } catch {}
          }
          reply(`✅ Broadcast media terkirim ke *${count2}* grup!`);
          break;
        }

        // premium management
        case 'addprem': {
          if (!isOwner(senderNumber) && !adminUsers.includes(parseInt(senderNumber))) return reply('❌ Not authorized.');
          const [uid, dur] = args.split(' ');
          if (!uid || !dur) return reply(`❌ Format: ${PREFIX}addprem 6281234567890 30d`);
          if (!/^\d+[dhm]$/.test(dur)) return reply('❌ Duration: 30d / 24h / 60m');
          const now = moment();
          const exp = moment().add(parseInt(dur), dur.slice(-1) === 'd' ? 'days' : dur.slice(-1) === 'h' ? 'hours' : 'minutes');
          const existing = premiumUsers.find(u => typeof u === 'object' && String(u.id) === uid);
          if (existing) { existing.expiresAt = exp.toISOString(); } else { premiumUsers.push({ id: uid, expiresAt: exp.toISOString() }); }
          savePremiumUsers();
          reply(`✅ User *${uid}* premium sampai *${exp.format('YYYY-MM-DD HH:mm:ss')}*`);
          break;
        }
        case 'delprem': {
          if (!isOwner(senderNumber)) return reply('❌ Owner only!');
          if (!args) return reply(`❌ Format: ${PREFIX}delprem 6281234567890`);
          const idx = premiumUsers.findIndex(u => typeof u === 'object' && String(u.id) === args);
          if (idx === -1) return reply('❌ User tidak ditemukan di list premium.');
          premiumUsers.splice(idx, 1);
          savePremiumUsers();
          reply(`✅ User *${args}* dihapus dari premium.`);
          break;
        }
        case 'listprem': {
          if (!isOwner(senderNumber)) return reply('❌ Owner only!');
          if (premiumUsers.length === 0) return reply('📌 Tidak ada user premium.');
          let txt = '📋 *LIST PREMIUM*\n\n';
          premiumUsers.forEach((u, i) => { if (typeof u === 'object') txt += `${i + 1}. ${u.id} — Exp: ${moment(u.expiresAt).format('YYYY-MM-DD HH:mm')}\n`; });
          reply(txt);
          break;
        }
        case 'addowner': {
          if (!isOwner(senderNumber)) return reply('❌ Owner only!');
          if (!args) return reply(`❌ Format: ${PREFIX}addowner 6281234567890`);
          const uid2 = parseInt(args);
          if (adminUsers.includes(uid2)) return reply('❌ Sudah admin.');
          adminUsers.push(uid2);
          saveAdminUsers();
          reply(`✅ ${args} ditambahkan sebagai admin.`);
          break;
        }
        case 'delowner': {
          if (!isOwner(senderNumber)) return reply('❌ Owner only!');
          if (!args) return reply(`❌ Format: ${PREFIX}delowner 6281234567890`);
          const aidx = adminUsers.indexOf(parseInt(args));
          if (aidx === -1) return reply('❌ Bukan admin.');
          adminUsers.splice(aidx, 1);
          saveAdminUsers();
          reply(`✅ ${args} dihapus dari admin.`);
          break;
        }
        case 'users': {
          if (senderNumber !== config.ADMIN_ID) return reply('❌ Admin only!');
          if (!fs.existsSync(userDataFile)) return reply('📁 Belum ada data user.');
          const ud = JSON.parse(fs.readFileSync(userDataFile));
          let txt2 = `👥 *Total: ${ud.length} users*\n\n`;
          ud.slice(0, 50).forEach((u, i) => { txt2 += `*${i+1}.* ${u.id}\n👤 ${u.first_name}\n📆 ${new Date(u.registered_at).toLocaleString()}\n\n`; });
          reply(txt2);
          break;
        }
        case 'listusr': {
          if (!isOwner(senderNumber)) return reply('❌ Owner only!');
          const ul = JSON.parse(fs.readFileSync(userListFile));
          if (ul.length === 0) return reply('📋 Tidak ada user terdaftar.');
          let txt3 = '📋 *Daftar User Bot:*\n\n';
          ul.forEach((id, i) => { txt3 += `${i + 1}. ${id}\n`; });
          reply(txt3);
          break;
        }

        // group management
        case 'kick': {
          if (!isGroup) return reply('❌ Hanya bisa di grup!');
          const metadata = await sock.groupMetadata(jid);
          const isAdmin = metadata.participants.find(p => p.id === sender)?.admin;
          if (!isAdmin && !isOwner(senderNumber)) return reply('❌ Kamu bukan admin.');
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (quotedParticipant ? quotedParticipant : null);
          if (!mentioned) return reply('❌ Tag atau reply user yang mau di-kick.');
          try { await sock.groupParticipantsUpdate(jid, [mentioned], 'remove'); reply(`✅ *${mentioned.split('@')[0]}* telah di-kick!`); } catch { reply('❌ Gagal kick. Bot harus jadi admin.'); }
          break;
        }
        case 'invite': {
          if (!isGroup) return reply('❌ Hanya bisa di grup!');
          try { const code = await sock.groupInviteCode(jid); reply(`📨 *Link Invite Grup:*\nhttps://chat.whatsapp.com/${code}`); } catch { reply('❌ Gagal membuat invite link.'); }
          break;
        }
        case 'addgroupid': {
          if (!args) return reply('❌ Masukkan group JID!');
          let gids = JSON.parse(fs.readFileSync(groupIdFile));
          if (gids.includes(args)) return reply('⚠️ Sudah terdaftar.');
          gids.push(args);
          fs.writeFileSync(groupIdFile, JSON.stringify(gids, null, 2));
          reply(`✅ Group ID *${args}* ditambahkan.`);
          break;
        }
        case 'delgroupid': {
          let gids2 = JSON.parse(fs.readFileSync(groupIdFile));
          gids2 = gids2.filter(g => g !== args);
          fs.writeFileSync(groupIdFile, JSON.stringify(gids2, null, 2));
          reply(`🗑️ Group ID *${args}* dihapus.`);
          break;
        }
        case 'listgroupid': {
          const gids3 = JSON.parse(fs.readFileSync(groupIdFile));
          if (gids3.length === 0) return reply('📭 Belum ada grup terdaftar.');
          reply('📋 *Daftar Grup:*\n\n' + gids3.map((id, i) => `${i + 1}. ${id}`).join('\n'));
          break;
        }
        case 'cfdgroup': {
          if (!isOwner(senderNumber)) return reply('❌ Owner only!');
          if (!quotedMsg) return reply('⚠️ Reply pesan yang ingin dibroadcast.');
          const gids4 = JSON.parse(fs.readFileSync(groupIdFile));
          if (gids4.length === 0) return reply('📭 Belum ada grup.');
          let s = 0, f = 0;
          for (const gid of gids4) {
            try {
              const qtype = Object.keys(quotedMsg)[0];
              if (qtype === 'imageMessage') { const buf = await dlQuotedMedia(); await sock.sendMessage(gid, { image: buf, caption: quotedMsg.imageMessage?.caption || '' }); }
              else if (qtype === 'videoMessage') { const buf = await dlQuotedMedia(); await sock.sendMessage(gid, { video: buf, caption: quotedMsg.videoMessage?.caption || '' }); }
              else await sock.sendMessage(gid, { text: quotedText });
              s++;
            } catch { f++; }
          }
          reply(`📢 Broadcast Done!\n✅ Success: ${s}\n❌ Failed: ${f}`);
          break;
        }

        // tiktok download
        case 'tiktok': case 'tt': {
          if (!args) return reply(`❌ Masukkan link TikTok!\nContoh: ${PREFIX}tiktok https://vt.tiktok.com/xxx`);
          try {
            await reply('⏳ Memproses...');
            const result = await tiktokDl(args);
            const cap = `📹 *${result.title}*\n👤 ${result.author.nickname} (@${result.author.fullname})\n👁️ Views: ${result.stats.views}\n❤️ Likes: ${result.stats.likes}\n💬 Comments: ${result.stats.comment}`;
            for (const link of result.video_links) {
              if (link.type === 'photo') await sock.sendMessage(jid, { image: { url: link.url } }, { quoted: msg });
              else if (link.type === 'nowatermark') { await sock.sendMessage(jid, { video: { url: link.url }, caption: cap }, { quoted: msg }); break; }
            }
          } catch (e) { reply('❌ ' + (e.message || e)); }
          break;
        }

        // upload to catbox
        case 'tourl': {
          if (!quotedMsg) return reply(`❌ Reply media dengan ${PREFIX}tourl`);
          try {
            await reply('⏳ Uploading ke Catbox...');
            const buffer = await dlQuotedMedia();
            if (!buffer) return reply('❌ Gagal download media.');
            const form = new FormData();
            form.append('reqtype', 'fileupload');
            form.append('fileToUpload', buffer, { filename: `upload_${Date.now()}`, contentType: 'application/octet-stream' });
            const { data: catboxUrl } = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders() });
            if (!catboxUrl.startsWith('https://')) throw new Error('Invalid URL');
            reply(`✅ Upload berhasil!\n📎 URL: ${catboxUrl}`);
          } catch { reply('❌ Gagal upload ke Catbox.'); }
          break;
        }

        // sticker
        case 'sticker': case 's': {
          const hasImage = mtype === 'imageMessage' || (quotedMsg && Object.keys(quotedMsg)[0] === 'imageMessage');
          if (!hasImage) return reply(`❌ Kirim/reply foto dengan ${PREFIX}sticker`);
          try {
            const buffer = mtype === 'imageMessage' ? await dlMedia() : await dlQuotedMedia();
            const webp = await sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
            await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
          } catch { reply('❌ Gagal membuat sticker.'); }
          break;
        }

        // brat sticker
        case 'brat': {
          if (!args) return reply(`❌ Format: ${PREFIX}brat <teks>`);
          try {
            await reply('🌿 Generating stiker brat...');
            const apiUrl = `https://api.siputzx.my.id/api/m/brat?text=${encodeURIComponent(args)}`;
            const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
            const buf = Buffer.from(response.data);
            const webp = await sharp(buf).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
            await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
          } catch { reply('❌ Gagal membuat stiker brat.'); }
          break;
        }

        // quote card
        case 'qc': {
          if (!quotedMsg) return reply('❌ Reply pesan orang untuk membuat quote.');
          const text = quotedText;
          if (!text) return reply('❌ Pesan tidak punya teks.');
          const name = pushName;
          let ppUrl = null;
          try { ppUrl = await sock.profilePictureUrl(quotedParticipant || sender, 'image'); } catch {}
          const warna = ['#000000', '#ff2414', '#22b4f2', '#eb13f2'];
          const obj = { type: 'quote', format: 'png', backgroundColor: warna[Math.floor(Math.random() * warna.length)], width: 512, height: 768, scale: 2,
            messages: [{ entities: [], avatar: true, from: { id: 1, name, photo: { url: ppUrl || 'https://i.imgur.com/1Q7HAma.png' } }, text, replyMessage: {} }] };
          try {
            const res = await axios.post('https://bot.lyo.su/quote/generate', obj, { headers: { 'Content-Type': 'application/json' } });
            const buf = Buffer.from(res.data.result.image, 'base64');
            const webp = await sharp(buf).webp().toBuffer();
            await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
          } catch { reply('❌ Gagal bikin stiker quote.'); }
          break;
        }

        // translate
        case 'translate': case 'tr': {
          const tArgs = args.split(' ');
          const lang = tArgs[0];
          const tText = tArgs.slice(1).join(' ') || quotedText;
          if (!lang || !tText) return reply(`📌 Format: ${PREFIX}translate <kode_bahasa> <teks>\nContoh: ${PREFIX}translate id Hello how are you`);
          try {
            const result = await translate(tText, null, lang);
            reply(`📤 *Hasil terjemahan:*\n\n${result?.translation || 'Tidak ada hasil.'}`);
          } catch (e) { reply(`❌ Gagal: ${e.message}`); }
          break;
        }

        // play music
        case 'play': {
          if (!args) return reply(`❌ Format: ${PREFIX}play <judul lagu>`);
          try {
            await reply('🔎 Mencari lagu...');
            const url = `https://api.fasturl.link/downup/ytdown-v1?name=${encodeURIComponent(args)}&format=mp3&quality=320&server=auto`;
            const response = await axios.get(url, { headers: { accept: 'application/json' } });
            const res = response.data;
            if (res.status !== 200 || !res.result?.media) return reply('❌ Lagu tidak ditemukan.');
            const { title, media, metadata, author } = res.result;
            await sock.sendMessage(jid, { image: { url: metadata.thumbnail }, caption: `🎶 *${title}*\n👤 ${author.name}\n🕒 ${metadata.duration}` }, { quoted: msg });
            await sock.sendMessage(jid, { audio: { url: media }, mimetype: 'audio/mpeg', fileName: `${title}.mp3` }, { quoted: msg });
          } catch { reply('🚫 Error saat mengambil lagu.'); }
          break;
        }

        // mediafire download
        case 'mediafire': {
          if (!args) return reply(`❌ Format: ${PREFIX}mediafire <link>`);
          try {
            const res = await axios.get('https://fastrestapis.fasturl.cloud/downup/mediafiredown', { params: { url: args }, headers: { accept: 'application/json' } });
            const data = res.data.result;
            if (!data?.download) return reply('❌ Gagal. Pastikan link valid.');
            await sock.sendMessage(jid, { document: { url: data.download }, fileName: data.filename, mimetype: data.filetype || 'application/octet-stream', caption: `📁 *${data.filename}*\n📏 Size: ${data.size}` }, { quoted: msg });
          } catch { reply('⚠️ Error saat download.'); }
          break;
        }

        // ai / gpt (legacy)
        case 'ai': case 'gpt': case 'openai': {
          const input = args || quotedText;
          if (!input) return reply(`❌ Format: ${PREFIX}ai <pertanyaan>`);
          await reply('⏳ _Sedang berpikir..._');
          try {
            const res = await axios.post('https://api.maia.id/v1/chat/completions', {
              model: 'xai/grok-4-fast-non-reasoning',
              messages: [
                { role: 'system', content: `Kamu adalah ${config.botName}, AI assistant WhatsApp yang ramah dan membantu.` },
                { role: 'user', content: input }
              ]
            }, {
              headers: {
                'Authorization': `Bearer sk-B-aqQWQ2yBKL8FwrcRe2qg`,
                'Content-Type': 'application/json'
              }
            });
            const data = res.data;
            if (data?.choices?.[0]?.message?.content) {
              reply(data.choices[0].message.content.trim());
            } else {
              reply('❌ Gagal mendapatkan respon dari AI.');
            }
          } catch (err) {
            console.error('[AI ERROR]', err.response?.data || err.message);
            reply('❌ Terjadi kesalahan saat memproses AI.');
          }
          break;
        }

        // fix code
        case 'fixcode': {
          const code = quotedText;
          if (!code) return reply(`❌ Reply kode yang mau diperbaiki dengan ${PREFIX}fixcode`);
          try {
            await reply('🧠 Memproses perbaikan kode...');
            const prompt = `Lu adalah AI expert. Perbaiki kode ini tanpa penjelasan, kasih langsung kode yang sudah fixed:\n\n${code}`;
            const res = await fetch(`https://api.siputzx.my.id/api/ai/gpt3?prompt=${encodeURIComponent('kamu ai perbaiki code')}&content=${encodeURIComponent(prompt)}`);
            const data = await res.json();
            if (data?.result) { const r = data.result.length > 4000 ? data.result.slice(0, 4000) + '...' : data.result; reply(r); }
            else reply('❌ Gagal.');
          } catch { reply('❌ Error saat fix kode.'); }
          break;
        }
        case 'fixcode2': {
          const code2 = quotedText;
          if (!code2) return reply(`❌ Reply kode dengan ${PREFIX}fixcode2`);
          try {
            await reply('🧠 Memproses...');
            const prompt = `Perbaiki kode ini tanpa penjelasan:\n\n${code2}`;
            const res = await fetch(`https://fastrestapis.fasturl.cloud/aillm/gpt-4o?ask=${encodeURIComponent(prompt)}`);
            const data = await res.json();
            if (data?.result) reply(data.result.length > 4000 ? data.result.slice(0, 4000) + '...' : data.result);
            else reply('❌ Gagal.');
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'fixcodeerror': {
          if (!args) return reply(`❌ Format: ${PREFIX}fixcodeerror <error description>\nReply kode yang error.`);
          const code3 = quotedText;
          if (!code3) return reply('❌ Reply pesan kode-nya.');
          try {
            await reply('🧠 Fixing...');
            const prompt = `Fix error: ${args}\n\nKode:\n${code3}`;
            const { data } = await axios.get('https://fastrestapis.fasturl.cloud/aillm/gpt-4o', { params: { ask: prompt }, headers: { accept: 'application/json' } });
            if (data?.result) reply(data.result.length > 4000 ? data.result.slice(0, 4000) + '...' : data.result);
            else reply('❌ Gagal.');
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'editcode': {
          if (!args) return reply(`❌ Format: ${PREFIX}editcode <instruksi edit>\nReply kode-nya.`);
          const code4 = quotedText;
          if (!code4) return reply('❌ Reply pesan kode-nya.');
          try {
            await reply('🧠 Editing...');
            const prompt = `Edit kode sesuai instruksi tanpa penjelasan:\nInstruksi: ${args}\nKode:\n${code4}`;
            const res = await fetch(`https://fastrestapis.fasturl.cloud/aillm/gpt-4o?ask=${encodeURIComponent(prompt)}`);
            const data = await res.json();
            if (data?.result) reply(data.result.length > 4000 ? data.result.slice(0, 4000) + '...' : data.result);
            else reply('❌ Gagal.');
          } catch { reply('❌ Error.'); }
          break;
        }

        // get source code
        case 'getcode': {
          const url = quotedText?.trim() || args;
          if (!url || !url.startsWith('http')) return reply('❌ Reply/kirim link website.');
          try {
            await reply('⏳ Mengambil source code...');
            const response = await axios.get(url);
            const buf = Buffer.from(response.data, 'utf-8');
            await sock.sendMessage(jid, { document: buf, fileName: 'source-code.html', mimetype: 'text/html', caption: `📦 Source code dari ${url}` }, { quoted: msg });
          } catch { reply('⚠️ Gagal mengambil source code.'); }
          break;
        }
        case 'getcodezip': {
          const url2 = quotedText?.trim() || args;
          if (!url2 || !url2.startsWith('http')) return reply('❌ Reply/kirim link website.');
          try {
            await reply('⏳ Mengambil dan mengemas kode...');
            const res = await axios.get(url2);
            const $ = cheerio.load(res.data);
            const baseFolder = path.join(tmpdir(), `sitecode_${Date.now()}`);
            fs.mkdirSync(baseFolder, { recursive: true });
            fs.mkdirSync(path.join(baseFolder, 'assets'), { recursive: true });
            fs.writeFileSync(path.join(baseFolder, 'index.html'), $.html());
            const zip = new AdmZip();
            zip.addLocalFolder(baseFolder);
            const zipPath = path.join(tmpdir(), `code_${Date.now()}.zip`);
            zip.writeZip(zipPath);
            await sock.sendMessage(jid, { document: fs.readFileSync(zipPath), fileName: 'website_code.zip', mimetype: 'application/zip' }, { quoted: msg });
          } catch { reply('⚠️ Gagal.'); }
          break;
        }

        // tiktok search
        case 'stiktok': {
          const keyword = args || quotedText;
          if (!keyword) return reply(`❌ Format: ${PREFIX}stiktok <keyword>`);
          try {
            await reply('⏳ Mencari di TikTok...');
            const response = await axios.post('https://www.tikwm.com/api/feed/search', `keywords=${encodeURIComponent(keyword)}&count=5&cursor=0`, {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const data = response.data?.data;
            if (!data || !data.videos || !data.videos.length) return reply('⚠️ Video TikTok tidak ditemukan.');
            
            let txt = `🔎 Hasil TikTok: *${keyword}*\n\n`;
            for (let i = 0; i < Math.min(data.videos.length, 5); i++) {
              const v = data.videos[i];
              txt += `🎦 *${v.title}*\n`;
              txt += `👤 @${v.author?.unique_id || 'unknown'}\n`;
              txt += `♥️ ${v.digg_count} | 💬 ${v.comment_count} | 👁️ ${v.play_count}\n`;
              txt += `🔗 https://tiktok.com/@${v.author?.unique_id}/video/${v.video_id}\n\n`;
            }
            txt += `_Balas dengan ${PREFIX}tiktok <link> untuk mendownload_`;
            await reply(txt);
          } catch (e) {
            console.error(e);
            reply('❌ Error saat mencari (Data tidak ditemukan).');
          }
          break;
        }

        // id card generator
        case 'cekid': {
          try {
            const target = quotedParticipant || sender;
            const targetNum = target.split('@')[0];
            let ppUrl = null;
            try { ppUrl = await sock.profilePictureUrl(target, 'image'); } catch {}
            const canvas = createCanvas(1000, 600);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#e6f2ee'; ctx.fillRect(0, 0, 1000, 600);
            if (ppUrl) { const resp = await axios.get(ppUrl, { responseType: 'arraybuffer' }); const avatar = await loadImage(Buffer.from(resp.data)); ctx.drawImage(avatar, 50, 50, 250, 300); }
            else { ctx.fillStyle = '#ccc'; ctx.fillRect(50, 50, 250, 300); }
            ctx.fillStyle = '#0a4f44'; ctx.font = 'bold 40px sans-serif'; ctx.fillText('ID CARD WHATSAPP', 350, 80);
            ctx.fillStyle = 'black'; ctx.font = '28px sans-serif';
            ctx.fillText(`Nama: ${pushName}`, 350, 150);
            ctx.fillText(`Nomor: ${targetNum}`, 350, 200);
            ctx.fillText(`Tanggal: ${new Date().toISOString().split('T')[0]}`, 350, 250);
            ctx.fillStyle = 'black'; ctx.fillRect(350, 350, 280, 5);
            for (let x = 360; x < 620; x += 15) { ctx.fillRect(x, 370, Math.random() * 5 + 2, 50); }
            const buffer = canvas.toBuffer('image/png');
            await sock.sendMessage(jid, { image: buffer, caption: `👤 Nama: ${pushName}\n📱 Nomor: ${targetNum}\n📅 Tanggal: ${new Date().toISOString().split('T')[0]}` }, { quoted: msg });
          } catch { reply('❌ Gagal generate ID card.'); }
          break;
        }
        case 'xid': {
          try {
            const target = quotedParticipant || sender;
            const targetNum = target.split('@')[0];
            let ppUrl = null;
            try { ppUrl = await sock.profilePictureUrl(target, 'image'); } catch {}
            const canvas = createCanvas(600, 300);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1e1e2e'; ctx.fillRect(0, 0, 600, 300);
            ctx.font = 'bold 24px Arial'; ctx.fillStyle = '#ffcc00'; ctx.fillText('WHATSAPP ID CARD', 200, 40);
            ctx.fillStyle = '#fff'; ctx.font = '18px Arial';
            ctx.fillText(`Nama: ${pushName}`, 200, 80);
            ctx.fillText(`Nomor: ${targetNum}`, 200, 110);
            ctx.fillText(`Status: ${getPremiumStatus(targetNum)}`, 200, 140);
            ctx.fillText(`Lokasi: ${isGroup ? 'Group Chat' : 'Private Chat'}`, 200, 170);
            if (ppUrl) { const resp = await axios.get(ppUrl, { responseType: 'arraybuffer' }); const avatar = await loadImage(Buffer.from(resp.data)); ctx.save(); ctx.beginPath(); ctx.arc(100, 130, 60, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(avatar, 40, 70, 120, 120); ctx.restore(); }
            const buffer = canvas.toBuffer('image/png');
            await sock.sendMessage(jid, { image: buffer, caption: `👤 ${pushName}\n📱 ${targetNum}\n📊 ${getPremiumStatus(targetNum)}` }, { quoted: msg });
          } catch { reply('❌ Gagal generate ID card.'); }
          break;
        }

        // user info
        case 'info': {
          const target = quotedParticipant || sender;
          const num = target.split('@')[0];
          let status = '';
          if (isGroup) {
            try { const meta = await sock.groupMetadata(jid); const p = meta.participants.find(p => p.id === target); status = p?.admin ? p.admin : 'member'; } catch {}
          }
          reply(`🧾 *INFO PENGGUNA*\n📱 Nomor: ${num}\n📛 Nama: ${pushName}\n📌 Status: ${status || 'N/A'}\n📊 Premium: ${getPremiumStatus(num)}`);
          break;
        }
        case 'profil': {
          const targetName = args || pushName;
          const idx = hashUsername(targetName);
          const job = jobs[idx];
          reply(`👤 *Profil Pengguna*\n👨‍💼 Nama: ${targetName}\n${job.emoji} *${job.title}*\n📝 _${job.desc}_`);
          break;
        }

        // handwriting generator
        case 'nulis': {
          if (!args) return reply(`❌ Format: ${PREFIX}nulis <teks>`);
          try {
            const response = await axios.post('https://lemon-write.vercel.app/api/generate-book', { text: args, font: 'default', color: '#000000', size: '32' }, { responseType: 'arraybuffer', headers: { 'Content-Type': 'application/json' } });
            await sock.sendMessage(jid, { image: Buffer.from(response.data) }, { quoted: msg });
          } catch { reply('❌ Error.'); }
          break;
        }

        // social media stalk
        case 'igstalk': {
          if (!args) return reply(`❌ Format: ${PREFIX}igstalk <username>`);
          try {
            const res = await axios.post('https://api.siputzx.my.id/api/stalk/instagram', { username: args }, { headers: { 'Content-Type': 'application/json' } });
            if (!res.data.status) return reply('❌ Tidak ditemukan.');
            const ig = res.data.data;
            const txt = `📸 *Instagram: ${ig.username}*\n👑 ${ig.full_name}\n📝 ${ig.biography || '-'}\n📊 Followers: ${ig.followers_count?.toLocaleString()}\n👥 Following: ${ig.following_count?.toLocaleString()}\n📬 Posts: ${ig.posts_count?.toLocaleString()}\n🔒 Private: ${ig.is_private ? 'Yes' : 'No'}\n✔️ Verified: ${ig.is_verified ? 'Yes' : 'No'}`;
            await sock.sendMessage(jid, { image: { url: ig.profile_pic_url }, caption: txt }, { quoted: msg });
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'ttstalk': {
          if (!args) return reply(`❌ Format: ${PREFIX}ttstalk <username>`);
          try {
            const { data } = await axios.post('https://api.siputzx.my.id/api/stalk/tiktok', { username: args });
            if (!data.status) return reply('❌ Gagal.');
            const u = data.data.user, s = data.data.stats;
            const txt = `👤 *${u.nickname}* (@${u.uniqueId})\n✅ Verified: ${u.verified ? 'Yes' : 'No'}\n📍 ${u.region}\n📝 ${u.signature || '-'}\n👥 Followers: ${s.followerCount?.toLocaleString()}\n❤️ Likes: ${s.heart?.toLocaleString()}\n🎞️ Videos: ${s.videoCount}`;
            await sock.sendMessage(jid, { image: { url: u.avatarLarger }, caption: txt }, { quoted: msg });
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'twstalk': {
          if (!args) return reply(`❌ Format: ${PREFIX}twstalk <username>`);
          try {
            const { data } = await axios.post('https://api.siputzx.my.id/api/stalk/twitter', { user: args });
            if (!data.status) return reply('❌ Gagal.');
            const u = data.data;
            reply(`🐦 *${u.name}* (@${u.username})\n📍 ${u.location || '-'}\n📝 ${u.description || '-'}\n🧵 Tweets: ${u.stats.tweets}\n👥 Followers: ${u.stats.followers}\n❤️ Likes: ${u.stats.likes}`);
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'ytstalk': {
          if (!args) return reply(`❌ Format: ${PREFIX}ytstalk <username>`);
          try {
            const { data } = await axios.post('https://api.siputzx.my.id/api/stalk/youtube', { username: args });
            if (!data.status) return reply('❌ Gagal.');
            const ch = data.data.channel;
            await sock.sendMessage(jid, { image: { url: ch.avatarUrl }, caption: `📺 *${ch.username}*\n📌 Sub: ${ch.subscriberCount}\n🎞️ Videos: ${ch.videoCount}\n📝 ${ch.description || '-'}` }, { quoted: msg });
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'pinstalk': {
          if (!args) return reply(`❌ Format: ${PREFIX}pinstalk <username>`);
          try {
            const res = await axios.post('https://api.siputzx.my.id/api/stalk/pinterest', { q: args });
            const r = res.data.result;
            await sock.sendMessage(jid, { image: { url: r.image?.original }, caption: `📌 *${r.username}*\n📛 ${r.full_name || '-'}\n📝 ${r.bio || '-'}\n📊 Pins: ${r.stats?.pins} | Followers: ${r.stats?.followers}` }, { quoted: msg });
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'threadsstalk': {
          if (!args) return reply(`❌ Format: ${PREFIX}threadsstalk <username>`);
          try {
            const res = await axios.post('https://api.siputzx.my.id/api/stalk/threads', { q: args });
            const d = res.data?.data;
            if (!d) return reply('❌ Tidak ditemukan.');
            await sock.sendMessage(jid, { image: { url: d.hd_profile_picture }, caption: `👤 *${d.name}* (@${d.username})\n${d.is_verified ? '✅ Verified' : ''}\n📝 ${d.bio || '-'}\n👥 Followers: ${d.followers?.toLocaleString()}` }, { quoted: msg });
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'ghstalk': {
          if (!args) return reply(`❌ Format: ${PREFIX}ghstalk <username>`);
          try {
            const res = await axios.post('https://api.siputzx.my.id/api/stalk/github', { user: args }, { headers: { 'Content-Type': 'application/json' } });
            if (!res.data.status) return reply('❌ Tidak ditemukan.');
            const p = res.data.data;
            await sock.sendMessage(jid, { image: { url: p.profile_pic }, caption: `👤 *${p.username}*\n📝 ${p.bio || '-'}\n📦 Repos: ${p.public_repo}\n👥 Followers: ${p.followers}\n📍 ${p.location || '-'}` }, { quoted: msg });
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'stalkff': {
          if (!args) return reply(`❌ Format: ${PREFIX}stalkff <ID>`);
          try {
            const { data } = await axios.get(`https://ff.lxonfire.workers.dev/?id=${args}`);
            if (!data?.nickname) return reply('❌ ID tidak ditemukan.');
            await sock.sendMessage(jid, { image: { url: data.img_url }, caption: `👤 *${data.nickname}*\n🌍 Region: ${data.region}\n🆔 ${data.open_id}` }, { quoted: msg });
          } catch { reply('❌ Error.'); }
          break;
        }
        case 'stalkmlbb': {
          if (!args || !args.includes('|')) return reply(`❌ Format: ${PREFIX}stalkmlbb userId|zoneId`);
          const [uid, zid] = args.split('|').map(v => v.trim());
          try {
            const res = await axios.get('https://fastrestapis.fasturl.cloud/stalk/mlbb', { params: { userId: uid, zoneId: zid } });
            if (res.data.status !== 200) return reply('❌ Gagal.');
            const { username, region, level, rank } = res.data.result;
            reply(`✨ *MLBB*\n👤 ${username}\n🌍 ${region}\n📈 Level: ${level || '-'}\n🏆 Rank: ${rank || '-'}`);
          } catch { reply('❌ Error.'); }
          break;
        }

        // cek commands
        case 'cekkhodam': {
          if (!args) return reply('❌ Masukkan nama! Contoh: .cekkhodam Budi');
          const khodam = khodamList[Math.floor(Math.random() * khodamList.length)];
          reply(`𖤐 *HASIL CEK KHODAM:*\n╭───────────────\n├ Nama: ${args}\n├ Khodam: ${khodam}\n├ Ngeri bet jir 😱\n╰───────────────`);
          break;
        }
        case 'cektampan': { const n = [10,20,30,35,45,50,54,68,73,78,83,90,94,100][Math.floor(Math.random()*14)]; reply(`📊 *Tes Ketampanan*\n👤 ${pushName}\n💯 Nilai: *${n}%*\n🗣️ ${komentarTampan(n)}`); break; }
        case 'cekcantik': { const n = [10,20,30,35,45,50,54,68,73,78,83,90,94,100][Math.floor(Math.random()*14)]; reply(`📊 *Tes Kecantikan*\n👤 ${pushName}\n💯 Nilai: *${n}%*\n🗣️ ${komentarCantik(n)}`); break; }
        case 'cekkaya': { const n = [10,20,30,40,50,60,70,80,90,100][Math.floor(Math.random()*10)]; reply(`💵 *Tes Kekayaan*\n👤 ${pushName}\n💰 Nilai: *${n}%*\n🗣️ ${komentarKaya(n)}`); break; }
        case 'cekmiskin': { const n = [10,20,30,40,50,60,70,80,90,100][Math.floor(Math.random()*10)]; reply(`📉 *Tes Kemiskinan*\n👤 ${pushName}\n📉 Nilai: *${n}%*\n🗣️ ${komentarMiskin(n)}`); break; }
        case 'cekjanda': { const n = Math.floor(Math.random()*101); reply(`👠 *Tes Kejandaan*\n👤 ${pushName}\n📊 Nilai: *${n}%*\n🗣️ ${komentarJanda(n)}`); break; }
        case 'cekpacar': { const n = Math.floor(Math.random()*101); reply(`💕 *Tes Kepacaran*\n👤 ${pushName}\n📊 Nilai: *${n}%*\n🗣️ ${komentarPacar(n)}`); break; }

        case 'ceklokasi': {
          if (!args) return reply(`❌ Format: ${PREFIX}ceklokasi <nama lokasi>`);
          try {
            const geo = await axios.get('https://nominatim.openstreetmap.org/search', { params: { q: args, format: 'json', limit: 1 }, headers: { 'User-Agent': 'UltramaxoBot' } });
            if (!geo.data.length) return reply('❌ Lokasi tidak ditemukan.');
            const { lat, lon, display_name } = geo.data[0];
            await sock.sendMessage(jid, { location: { degreesLatitude: parseFloat(lat), degreesLongitude: parseFloat(lon) } }, { quoted: msg });
            reply(`📌 *${display_name}*\n📍 Lat: ${lat}\n📍 Lon: ${lon}`);
          } catch { reply('❌ Gagal.'); }
          break;
        }
        case 'ceksedangapa': {
          const { waktu, teks } = getRandomAktivitas();
          reply(`🕒 *Waktu:* ${waktu.charAt(0).toUpperCase() + waktu.slice(1)}\n🧐 ${pushName} sedang apa?\n\n${teks}`);
          break;
        }

        // earthquake info
        case 'infogempa': {
          try {
            const res = await fetch('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json');
            const json = await res.json();
            const d = json.Infogempa.gempa;
            let cap = `📡 *Info Gempa Terkini*\n\n📅 ${d.Tanggal}\n🕒 ${d.Jam}\n📍 ${d.Wilayah}\n📈 Magnitudo: ${d.Magnitude}\n📏 Kedalaman: ${d.Kedalaman}\n📌 ${d.Coordinates}\n⚠️ Potensi: *${d.Potensi}*`;
            if (d.Dirasakan) cap += `\n💬 Dirasakan: ${d.Dirasakan}`;
            const mapUrl = `https://data.bmkg.go.id/DataMKG/TEWS/${d.Shakemap}`;
            const buf = await fetch(mapUrl).then(r => r.buffer());
            const image = await sharp(buf).png().toBuffer();
            await sock.sendMessage(jid, { image, caption: cap }, { quoted: msg });
          } catch { reply('❌ Gagal ambil data gempa.'); }
          break;
        }

        // xnxx search
        case 'xnxx': {
          if (!args) return reply(`❌ Format: ${PREFIX}xnxx <query>`);
          try {
            const res = await axios.get('https://www.ikyiizyy.my.id/search/xnxx', { params: { apikey: 'new', q: args } });
            const results = res.data.result;
            if (!results?.length) return reply('❌ Tidak ditemukan.');
            let txt = `🔞 Hasil: *${args}*\n\n`;
            results.slice(0, 3).forEach(v => { txt += `📹 *${v.title}*\n🕒 ${v.duration}\n🔗 ${v.link}\n\n`; });
            reply(txt);
          } catch { reply('❌ Error.'); }
          break;
        }

        // ustad AI
        case 'pakustad': {
          const input = args || quotedText;
          if (!input) return reply(`❌ Format: ${PREFIX}pakustad <pertanyaan>`);
          await reply('🕌 Bertanya ke Pak Ustad...');
          // Visual sticker
          try {
            const response = await axios.get(`https://api.taka.my.id/tanya-ustad?quest=${encodeURIComponent(input)}`, { responseType: 'arraybuffer', validateStatus: () => true });
            const buf = Buffer.from(response.data);
            if (response.status === 200 && buf.length > 10240) {
              const webp = await sharp(buf).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
              await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
            }
          } catch {}
          // AI answer
          try {
            const prompt = `Kamu adalah ustad yang menjawab singkat sesuai syariat Islam.\nPertanyaan: ${input}`;
            const res = await fetch(`https://fastrestapis.fasturl.cloud/aillm/gpt-4o-turbo?ask=${encodeURIComponent(prompt)}`);
            const json = await res.json();
            if (json?.result) { const chunks = splitText(`📿 *Jawaban Pak Ustad:*\n\n${json.result.trim()}`); for (const c of chunks) await reply(c); }
            else reply('❌ Gagal menjawab via AI.');
          } catch { reply('❌ Gagal.'); }
          break;
        }

        // random waifu
        case 'waifu': {
          const url = getRandomWaifu();
          await sock.sendMessage(jid, { image: { url }, caption: `💘 Waifu hari ini~\n\nKetik *${PREFIX}waifu* lagi untuk next!` }, { quoted: msg });
          break;
        }

        // script info
        case 'script': {
          await sock.sendMessage(jid, {
            image: fs.readFileSync('./logo.png'),
            caption: `📌 *${config.botName}*\n💰 Price: 50K FULL UPDATE\n📦 Benefit: NO ENC + PT SC\n📞 Owner: wa.me/${config.OWNER_ID[0]}\n📱 Telegram: ${config.devTelegram}\n\n> Ketik *${PREFIX}owner* untuk kontak owner`
          }, { quoted: msg });
          break;
        }

        // transaction receipt
        case 'done': {
          if (!isOwner(senderNumber)) return reply('❌ Owner only!');
          if (!args) return reply(`❌ Format: ${PREFIX}done nama barang,harga,metode bayar`);
          const [nama, harga, metode] = args.split(',').map(s => s?.trim());
          if (!nama || !harga) return reply('❌ Format salah.');
          const hf = `Rp${Number(harga).toLocaleString('id-ID')}`;
          const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          await sock.sendMessage(jid, { image: { url: 'https://files.catbox.moe/05scm5.jpg' }, caption: `✅ *Transaksi Selesai*\n\n📦 ${nama}\n💳 Harga: ${hf}\n💰 Bayar: ${metode || '-'}\n⏰ ${now}` }, { quoted: msg });
          break;
        }

        // tebak games
        case 'tebakkata': case 'tebakkalimat': case 'tebaktebakan': case 'tebaklirik': {
          if (gameSessions.has(jid)) return reply('⚠️ Masih ada game aktif!');
          try {
            const soal = await loadSoal(command);
            const jawaban = soal.jawaban.toLowerCase();
            const emoji = { tebakkata: '🧠', tebakkalimat: '🧠', tebaktebakan: '🤔', tebaklirik: '🎵' };
            await reply(`${emoji[command] || '🧠'} *${command.replace('tebak', 'Tebak ')}!*\n\n${soal.soal}\n\n_Jawab dalam 60 detik!_`);
            const timeout = setTimeout(() => { reply(`⏰ Waktu habis! Jawaban: *${jawaban}*`); gameSessions.delete(jid); }, 60000);
            gameSessions.set(jid, { jawaban, timeout });
          } catch { reply('❌ Gagal ambil soal.'); }
          break;
        }
        case 'tebakgambar': case 'tebakbendera': case 'tebakkabupaten': {
          if (gameSessions.has(jid)) return reply('⚠️ Masih ada game aktif!');
          try {
            const soal = await loadSoal(command);
            const jawaban = (soal.jawaban || soal.name).toLowerCase();
            const captions = { tebakgambar: '🖼️ *Tebak Gambar!*', tebakbendera: '🏳️ *Tebak Bendera!*', tebakkabupaten: '🗺️ *Tebak Kabupaten!*' };
            await sock.sendMessage(jid, { image: { url: soal.img }, caption: `${captions[command]}\n_Jawab dalam 60 detik!_` }, { quoted: msg });
            const timeout = setTimeout(() => { reply(`⏰ Waktu habis! Jawaban: *${jawaban}*`); gameSessions.delete(jid); }, 60000);
            gameSessions.set(jid, { jawaban, timeout });
          } catch { reply('❌ Gagal ambil soal.'); }
          break;
        }
        case 'skip': {
          const sesi = gameSessions.get(jid);
          if (!sesi) return reply('❌ Tidak ada game aktif.');
          clearTimeout(sesi.timeout);
          reply(`⏭️ Dilewati! Jawaban: *${sesi.jawaban}*`);
          gameSessions.delete(jid);
          break;
        }
        case 'hint': {
          const sesi2 = gameSessions.get(jid);
          if (!sesi2) return reply('❌ Tidak ada game aktif.');
          const hint = sesi2.jawaban.split('').map(() => '_');
          const pos = Math.floor(Math.random() * sesi2.jawaban.length);
          hint[pos] = sesi2.jawaban[pos];
          reply(`💡 Hint: ${hint.join('')}`);
          break;
        }

        // asah otak
        case 'asahotak': {
          try {
            const res = await axios.get('https://nirkyy-dev.hf.space/api/v1/asahotak');
            const data = res.data.data;
            sesiAsahOtak[senderNumber] = { soal: data.soal, jawaban: data.jawaban.toLowerCase(), petunjuk: data.petunjuk || 'Tidak ada petunjuk.', skor: sesiAsahOtak[senderNumber]?.skor || 0 };
            reply(`🧠 *Asah Otak*\n\n${data.soal}\n\n_Jawab langsung, ketik *petunjuk*, *lewati*, atau *stop*._`);
          } catch { reply('❌ Gagal ambil soal.'); }
          break;
        }
        case 'petunjuk': {
          const s = sesiAsahOtak[senderNumber];
          if (!s) return reply('❌ Tidak ada sesi asah otak.');
          reply(`💡 Petunjuk: ${s.petunjuk}`);
          break;
        }
        case 'lewati': {
          const s = sesiAsahOtak[senderNumber];
          if (!s) return reply('❌ Tidak ada sesi asah otak.');
          await reply(`⏭ Dilewati. Jawaban: *${s.jawaban}*`);
          try {
            const res = await axios.get('https://nirkyy-dev.hf.space/api/v1/asahotak');
            const data = res.data.data;
            sesiAsahOtak[senderNumber] = { soal: data.soal, jawaban: data.jawaban.toLowerCase(), petunjuk: data.petunjuk || '-', skor: s.skor };
            reply(`🧠 *Soal Baru:*\n\n${data.soal}`);
          } catch { delete sesiAsahOtak[senderNumber]; }
          break;
        }
        case 'stop': {
          if (sesiAsahOtak[senderNumber]) { delete sesiAsahOtak[senderNumber]; reply('🛑 Asah otak dihentikan.'); }
          else reply('❌ Tidak ada sesi aktif.');
          break;
        }

        // chess
        case 'catur': {
          if (!isGroup) return reply('❌ Hanya bisa di grup!');
          if (!args) return reply(`❌ Format: ${PREFIX}catur @opponent`);
          if (chessGames[jid]) return reply('⚠️ Masih ada permainan catur.');
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
          if (!mentioned) return reply('❌ Tag lawan!');
          const chess = new Chess();
          chessGames[jid] = { chess, white: senderNumber, black: mentioned.split('@')[0], turn: 'w' };
          const board = createBoardText(chess);
          reply(`♟️ *Catur dimulai!*\nPutih: ${senderNumber}\nHitam: ${mentioned.split('@')[0]}\n\n${board}\n\nKetik langkah: *${PREFIX}move e2 e4*`);
          break;
        }
        case 'move': {
          const game = chessGames[jid];
          if (!game) return reply('❌ Tidak ada game catur.');
          const [from, to] = args.split(' ');
          if (!from || !to) return reply(`❌ Format: ${PREFIX}move e2 e4`);
          const isWhiteTurn = game.turn === 'w' && senderNumber === game.white;
          const isBlackTurn = game.turn === 'b' && senderNumber === game.black;
          if (!isWhiteTurn && !isBlackTurn) return reply('❌ Bukan giliran kamu.');
          const move = game.chess.move({ from, to });
          if (!move) return reply('❌ Langkah tidak valid.');
          game.turn = game.turn === 'w' ? 'b' : 'w';
          const board2 = createBoardText(game.chess);
          let msg2 = `${board2}\n\n✅ ${senderNumber} memindahkan ${from} ke ${to}.`;
          if (game.chess.isCheckmate()) { msg2 += `\n\n🏁 Skakmat! ${senderNumber} menang!`; delete chessGames[jid]; }
          else if (game.chess.isDraw()) { msg2 += '\n\n🤝 Seri!'; delete chessGames[jid]; }
          else { msg2 += `\nGiliran: ${game.turn === 'w' ? game.white : game.black}`; }
          reply(msg2);
          break;
        }
        case 'resign': {
          if (!chessGames[jid]) return reply('❌ Tidak ada game catur.');
          const winner = senderNumber === chessGames[jid].white ? chessGames[jid].black : chessGames[jid].white;
          delete chessGames[jid];
          reply(`🏳️ ${senderNumber} menyerah! Pemenang: ${winner}`);
          break;
        }

        // tictactoe
        case 'tictactoe': case 'ttt': {
          if (!isGroup) return reply('❌ Hanya di grup!');
          const mentioned2 = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
          if (!mentioned2) return reply(`❌ Format: ${PREFIX}tictactoe @opponent`);
          const oppNum = mentioned2.split('@')[0];
          const key = [senderNumber, oppNum].sort().join(':');
          if (tttGames[key]) return reply('⚠️ Game sudah berlangsung!');
          const game2 = new TicTacToe(senderNumber, oppNum);
          tttGames[key] = game2;
          const names = {}; names[senderNumber] = pushName; names[oppNum] = oppNum;
          reply(`🎮 *TicTacToe!*\n${pushName} (❌) vs ${oppNum} (⭕)\n\n${game2.render()}\n${game2.getStatus(names)}\n\nKetik posisi: *A1*, *B2*, *C3*, dll`);
          break;
        }

        // battle PvP
        case 'perang': {
          if (battleSessions[jid]) return reply('❗ Ada pertandingan berlangsung.');
          battleSessions[jid] = { players: [senderNumber], names: [pushName], hp: {}, turn: null, started: false };
          battleSessions[jid].hp[senderNumber] = 100;
          reply(`💥 ${pushName} menantang duel!\nKetik *${PREFIX}gabungperang* untuk ikut!`);
          break;
        }
        case 'gabungperang': {
          const bs = battleSessions[jid];
          if (!bs || bs.players.length >= 2) return reply('❌ Tidak ada sesi terbuka.');
          if (bs.players.includes(senderNumber)) return reply('⚠️ Sudah bergabung.');
          bs.players.push(senderNumber); bs.names.push(pushName);
          bs.hp[senderNumber] = 100;
          bs.turn = bs.players[Math.floor(Math.random() * 2)]; bs.started = true;
          reply(`🔥 ${pushName} bergabung!\n🎮 Pertarungan dimulai!\nGiliran: ${bs.names[bs.players.indexOf(bs.turn)]}\nKetik *${PREFIX}serang*`);
          break;
        }
        case 'serang': {
          const bs2 = battleSessions[jid];
          if (!bs2?.started) return reply('❗ Tidak ada duel aktif.');
          if (bs2.turn !== senderNumber) return reply('⏳ Bukan giliran kamu.');
          const target = bs2.players.find(p => p !== senderNumber);
          const dmg = Math.floor(Math.random() * 21) + 10;
          bs2.hp[target] -= dmg;
          const atkName = bs2.names[bs2.players.indexOf(senderNumber)];
          const tgtName = bs2.names[bs2.players.indexOf(target)];
          let txt = `💥 ${atkName} menyerang ${tgtName}: ${dmg} damage!\n❤️ ${tgtName}: ${Math.max(bs2.hp[target], 0)}\n❤️ ${atkName}: ${bs2.hp[senderNumber]}`;
          if (bs2.hp[target] <= 0) { txt += `\n\n🏆 ${atkName} menang!`; delete battleSessions[jid]; }
          else { bs2.turn = target; txt += `\n\n🔁 Giliran: ${tgtName}`; }
          reply(txt);
          break;
        }
        case 'nyerah': {
          const bs3 = battleSessions[jid];
          if (!bs3 || !bs3.players.includes(senderNumber)) return reply('❌ Tidak sedang bertarung.');
          const winIdx = bs3.players.findIndex(p => p !== senderNumber);
          reply(`🏳️ ${pushName} menyerah!\n🏆 ${bs3.names[winIdx]} menang!`);
          delete battleSessions[jid];
          break;
        }

        default: {
          // unrecognized command
          break;
        }
      }
      } catch (err) {
        console.error(chalk.red(`[ERROR] Command '${command}':`, err.message || err));
        try { await reply('❌ Error: ' + (err.message || 'Terjadi kesalahan.')); } catch {}
      }
      return;
    }

    // non-command handlers
    if (!body) return;
    const lowerBody = body.toLowerCase().trim();

    // tebak game answer
    const tebakSesi = gameSessions.get(jid);
    if (tebakSesi) {
      if (lowerBody === tebakSesi.jawaban) {
        clearTimeout(tebakSesi.timeout);
        reply(`✅ Benar! Jawabannya: *${tebakSesi.jawaban}*`);
        gameSessions.delete(jid);
        return;
      }
    }

    // asah otak answer
    const aoSesi = sesiAsahOtak[senderNumber];
    if (aoSesi && lowerBody === aoSesi.jawaban) {
      aoSesi.skor++;
      await reply(`✅ Benar! Skor: *${aoSesi.skor}*`);
      try {
        const res = await axios.get('https://nirkyy-dev.hf.space/api/v1/asahotak');
        const data = res.data.data;
        sesiAsahOtak[senderNumber] = { soal: data.soal, jawaban: data.jawaban.toLowerCase(), petunjuk: data.petunjuk || '-', skor: aoSesi.skor };
        reply(`🧠 *Soal baru:*\n\n${data.soal}`);
      } catch { delete sesiAsahOtak[senderNumber]; }
      return;
    }

    // tictactoe move
    const tttMatch = lowerBody.match(/^([abc])([123])$/);
    if (tttMatch) {
      const row = { a: 0, b: 1, c: 2 }[tttMatch[1]];
      const col = parseInt(tttMatch[2]) - 1;
      const key = Object.keys(tttGames).find(k => k.includes(senderNumber));
      if (key) {
        const game = tttGames[key];
        const moved = game.move(senderNumber, row, col);
        if (!moved) return reply('❌ Langkah tidak valid atau bukan giliran kamu.');
        const names = {}; names[game.p1] = game.p1; names[game.p2] = game.p2;
        let txt = `🎮 *TicTacToe*\n\n${game.render()}\n${game.getStatus(names)}`;
        if (game.winner) delete tttGames[key];
        reply(txt);
        return;
      }
    }

    // chess move
    const chessMatch = body.match(/^([a-h][1-8])\s+([a-h][1-8])$/i);
    if (chessMatch && chessGames[jid]) {
      const game = chessGames[jid];
      const isWhite = game.turn === 'w' && senderNumber === game.white;
      const isBlack = game.turn === 'b' && senderNumber === game.black;
      if (!isWhite && !isBlack) return;
      const move = game.chess.move({ from: chessMatch[1], to: chessMatch[2] });
      if (!move) return reply('❌ Langkah tidak valid.');
      game.turn = game.turn === 'w' ? 'b' : 'w';
      const board = createBoardText(game.chess);
      let txt = `${board}\n\n✅ ${senderNumber}: ${chessMatch[1]} → ${chessMatch[2]}`;
      if (game.chess.isCheckmate()) { txt += `\n🏁 Skakmat! ${senderNumber} menang!`; delete chessGames[jid]; }
      else if (game.chess.isDraw()) { txt += '\n🤝 Seri!'; delete chessGames[jid]; }
      else { txt += `\nGiliran: ${game.turn === 'w' ? game.white : game.black}`; }
      reply(txt);
    }
  });
}

// start
startBot();
console.log(chalk.cyan.bold(`\n🚀 Starting ${config.botName}...\n`));

// global error handlers
process.on('uncaughtException', (err) => {
  console.error(chalk.red('[UNCAUGHT]', err.message));
});
process.on('unhandledRejection', (err) => {
  console.error(chalk.red('[UNHANDLED]', err?.message || err));
});
