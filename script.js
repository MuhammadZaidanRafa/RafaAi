// ==========================
// ⚙️ KONFIGURASI GLOBAL
// ==========================
const CONFIG = {
  maxRiwayat: 50,           // batas riwayat chat di memori
  maxCharDisplay: 800,      // batas karakter ditampilkan
  typingDelay: 8,           // ms per karakter saat mengetik
  cacheExpiry: 10 * 60 * 1000, // cache 10 menit (ms)
  retryMax: 2,              // jumlah retry jika fetch gagal
  retryDelay: 500,          // ms antar retry
  storageKey: "rafa_ai_chat",
  cacheKey: "rafa_ai_cache",
};

// ==========================
// 🌐 STATE GLOBAL
// ==========================
const State = {
  riwayat: [],
  username: "User",
  isTyping: false,
  queryCache: new Map(), // keyword → { result, timestamp }
};

// ==========================
// 🔐 UTILS: ESCAPE HTML
// ==========================
function escapeHTML(text) {
  if (typeof text !== "string") return "";
  return text.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}

// ==========================
// ⏳ UTILS: DELAY
// ==========================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ==========================
// 🔁 UTILS: FETCH DENGAN RETRY
// ==========================
async function fetchWithRetry(url, options = {}, retries = CONFIG.retryMax) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await delay(CONFIG.retryDelay * (i + 1)); // exponential backoff ringan
    }
  }
}

// ==========================
// 💾 UTILS: CACHE SEDERHANA
// ==========================
const Cache = {
  get(key) {
    const entry = State.queryCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CONFIG.cacheExpiry) {
      State.queryCache.delete(key);
      return null;
    }
    return entry.result;
  },
  set(key, result) {
    // Batasi ukuran cache agar tidak membengkak
    if (State.queryCache.size > 100) {
      const firstKey = State.queryCache.keys().next().value;
      State.queryCache.delete(firstKey);
    }
    State.queryCache.set(key, { result, timestamp: Date.now() });
  },
};

// ==========================
// ⌨️ EFEK MENGETIK
// ==========================
async function ketikText(element, text) {
  if (!element || typeof text !== "string") return;
  element.textContent = "";
  for (let i = 0; i < text.length; i++) {
    element.textContent += text[i];
    await delay(CONFIG.typingDelay);
  }
}

// ==========================
// 🧠 EKSTRAK KEYWORD CERDAS
// ==========================
function extractKeyword(text) {
  if (typeof text !== "string" || !text.trim()) return "";

  const stopwords = new Set([
    "apa","apakah","yang","adalah","itu","siapa","dimana","kapan",
    "mengapa","bagaimana","jelaskan","sebutkan","dengan","dan","atau",
    "ke","dari","di","ini","tolong","coba","mohon","bisa","aku",
    "saya","kamu","kita","mereka","ada","sudah","belum","bukan",
    "tidak","juga","lagi","akan","bagi","untuk","pada","jika",
  ]);

  const kata = text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((k) => k.length > 2 && !stopwords.has(k));

  // Ambil maksimal 5 kata kunci paling relevan (muncul lebih dulu = lebih penting)
  return [...new Set(kata)].slice(0, 5).join(" ");
}

// ==========================
// 🔍 DETEKSI TIPE PERTANYAAN
// ==========================
function deteksiTipe(text) {
  const t = text.toLowerCase();
  if (/\b(siapa|who)\b/.test(t)) return "siapa";
  if (/\b(kapan|when|tahun berapa)\b/.test(t)) return "kapan";
  if (/\b(dimana|di mana|where)\b/.test(t)) return "dimana";
  if (/\b(berapa|how many|how much)\b/.test(t)) return "berapa";
  if (/\b(kenapa|mengapa|why)\b/.test(t)) return "alasan";
  if (/\b(bagaimana|cara|how to|how)\b/.test(t)) return "cara";
  if (/\b(apa itu|pengertian|definisi|artinya)\b/.test(t)) return "definisi";
  return "umum";
}

// ==========================
// 🌐 FETCH WIKIPEDIA (ID)
// ==========================
async function cariWiki(keyword) {
  if (!keyword?.trim()) return "";

  const cached = Cache.get("wiki:" + keyword);
  if (cached) return cached;

  try {
    const searchURL = `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(keyword)}&format=json&origin=*&srlimit=3`;
    const res = await fetchWithRetry(searchURL);
    const data = await res.json();

    const results = data?.query?.search;
    if (!results?.length) return "";

    // Coba hasil terbaik, fallback ke yang berikutnya jika extract kosong
    for (const item of results) {
      const pageURL = `https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(item.title)}`;
      try {
        const p = await fetchWithRetry(pageURL);
        const d = await p.json();
        if (d.extract && d.extract.length > 50) {
          const result = d.extract;
          Cache.set("wiki:" + keyword, result);
          return result;
        }
      } catch {
        continue;
      }
    }
  } catch (e) {
    console.warn("Wiki error:", e.message);
  }

  return "";
}

// ==========================
// 🌐 FETCH DUCKDUCKGO
// ==========================
async function cariDDG(query) {
  if (!query?.trim()) return "";

  const cached = Cache.get("ddg:" + query);
  if (cached) return cached;

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
    const res = await fetchWithRetry(url);
    const data = await res.json();

    // Kumpulkan semua sumber yang tersedia dan gabungkan
    const parts = [
      data.Abstract,
      data.Answer,
      data.RelatedTopics?.[0]?.Text,
      data.Definition,
    ].filter(Boolean);

    if (parts.length) {
      const result = parts.join(" ").trim();
      Cache.set("ddg:" + query, result);
      return result;
    }
  } catch (e) {
    console.warn("DDG error:", e.message);
  }

  return "";
}

// ==========================
// 🤖 FALLBACK: LOGIKA LOKAL
// ==========================
function logikaLokal(text, tipe) {
  const responses = {
    siapa: "Pertanyaan ini menanyakan tentang seseorang atau identitas. Coba tambahkan nama atau konteks yang lebih spesifik.",
    kapan: "Pertanyaan ini berkaitan dengan waktu atau tanggal. Spesifikasikan peristiwa yang ingin kamu tanyakan.",
    dimana: "Pertanyaan ini mencari lokasi atau tempat. Tambahkan konteks yang lebih jelas.",
    berapa: "Pertanyaan ini meminta jumlah, angka, atau kuantitas. Coba lebih spesifik.",
    alasan: "Pertanyaan ini mencari sebab atau alasan. Sumber online mungkin bisa membantu lebih lanjut.",
    cara: "Pertanyaan ini meminta panduan atau langkah-langkah. Coba cari tutorial yang lebih spesifik.",
    definisi: "Pertanyaan ini meminta definisi atau pengertian. Coba kata kunci yang lebih tepat.",
    umum: "Maaf, saya tidak menemukan jawaban yang cukup relevan. Coba pertanyaan yang lebih spesifik atau gunakan kata kunci yang berbeda.",
  };
  return responses[tipe] || responses.umum;
}

// ==========================
// 🧩 DETEKSI SOAL PILIHAN GANDA
// ==========================
function cariJawabanPilihan(soal, penjelasan) {
  if (typeof soal !== "string" || typeof penjelasan !== "string") return null;

  const pilihan = soal.match(/\b[A-E]\.\s.+/g);
  if (!pilihan || pilihan.length < 2) return null; // butuh minimal 2 pilihan

  const teks = penjelasan.toLowerCase();
  let terbaik = null;
  let skorMax = 0;

  for (const p of pilihan) {
    const isi = p.slice(2).toLowerCase();
    // Filter kata bermakna (panjang > 3, bukan angka murni)
    const kata = isi.split(/\s+/).filter((k) => k.length > 3 && /[a-z]/.test(k));
    if (!kata.length) continue;

    let skor = 0;
    for (const k of kata) {
      if (teks.includes(k)) skor++;
    }

    // Normalisasi skor berdasarkan jumlah kata agar adil
    const skorNormal = skor / kata.length;
    if (skorNormal > skorMax) {
      skorMax = skorNormal;
      terbaik = p;
    }
  }

  // Threshold: harus ada minimal 20% kata yang cocok
  return skorMax >= 0.2 ? terbaik : null;
}

// ==========================
// 🤖 FUNGSI UTAMA AI
// ==========================
async function tanyaAI(soal) {
  if (typeof soal !== "string" || !soal.trim()) {
    return "Pertanyaan tidak boleh kosong.";
  }

  const soalBersih = soal.trim();
  const tipe = deteksiTipe(soalBersih);
  const keyword = extractKeyword(soalBersih);

  // --- Cari dari Wikipedia ---
  let hasil = keyword ? await cariWiki(keyword) : "";

  // --- Fallback ke DuckDuckGo ---
  if (!hasil) {
    hasil = await cariDDG(soalBersih);
  }

  // --- Fallback ke logika lokal ---
  if (!hasil) {
    hasil = logikaLokal(soalBersih, tipe);
  }

  // --- Deteksi pilihan ganda ---
  const jawaban = cariJawabanPilihan(soalBersih, hasil);
  let teks;
  if (jawaban) {
    teks = `✅ Kemungkinan Jawaban: ${jawaban}\n\n📖 Penjelasan:\n${hasil}`;
  } else {
    teks = hasil;
  }

  // Batasi panjang untuk display
  const teksDisplay = teks.length > CONFIG.maxCharDisplay
    ? teks.slice(0, CONFIG.maxCharDisplay) + "…"
    : teks;

  // Simpan ke riwayat (teks mentah, belum di-escape)
  if (State.riwayat.length >= CONFIG.maxRiwayat) {
    State.riwayat.shift(); // hapus yang paling lama
  }
  State.riwayat.push({
    user: State.username,
    soal: soalBersih,
    ai: teksDisplay,
    waktu: new Date().toISOString(),
    tipe,
  });

  // Return versi aman untuk ditampilkan di HTML
  return escapeHTML(teksDisplay);
}

// ==========================
// 💾 SIMPAN & MUAT CHAT
// ==========================
function saveChat() {
  const chatEl = document.getElementById("chat");
  if (!chatEl) return;
  try {
    localStorage.setItem(CONFIG.storageKey, chatEl.innerHTML);
  } catch (e) {
    console.error("Gagal menyimpan chat:", e);
  }
}

function loadChat() {
  const chatEl = document.getElementById("chat");
  if (!chatEl) return;
  try {
    const data = localStorage.getItem(CONFIG.storageKey);
    if (data) chatEl.innerHTML = data;
  } catch (e) {
    console.error("Gagal memuat chat:", e);
  }
}

// ==========================
// 🗑️ HAPUS CHAT
// ==========================
function clearChat() {
  const chatEl = document.getElementById("chat");
  if (chatEl) chatEl.innerHTML = "";
  State.riwayat = [];
  State.queryCache.clear();
  try {
    localStorage.removeItem(CONFIG.storageKey);
  } catch (e) {
    console.error("Gagal menghapus chat:", e);
  }
}

// ==========================
// 📤 EKSPOR RIWAYAT (BONUS)
// ==========================
function eksporRiwayat() {
  if (!State.riwayat.length) return alert("Riwayat chat kosong.");
  const blob = new Blob(
    [JSON.stringify(State.riwayat, null, 2)],
    { type: "application/json" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `chat-riwayat-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ==========================
// 🚀 INIT
// ==========================
window.onload = () => {
  loadChat();
};
