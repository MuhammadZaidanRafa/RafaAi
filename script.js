async function tanyaAI(soal){

let hasil = "";
let pertanyaan = soal.toLowerCase();

// hapus kata tidak penting
let stopword = [
"apa","apakah","yang","adalah","itu","siapa","dimana",
"kapan","mengapa","bagaimana","jelaskan","sebutkan"
];

let keyword = pertanyaan;

stopword.forEach(k=>{
keyword = keyword.replace(k,"");
});

keyword = keyword.replace("?","").trim();


// ==========================
// 1. CARI DI WIKIPEDIA
// ==========================

try{

let url =
"https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch="
+ encodeURIComponent(keyword)
+ "&format=json&origin=*";

let res = await fetch(url);
let data = await res.json();

if(data.query.search.length > 0){

let title = data.query.search[0].title;

let page =
"https://id.wikipedia.org/api/rest_v1/page/summary/"
+ encodeURIComponent(title);

let p = await fetch(page);
let d = await p.json();

hasil = d.extract;

}

}catch(e){}


// ==========================
// 2. JIKA TIDAK ADA → SEARCH WEB
// ==========================

if(hasil === ""){

try{

let search =
"https://api.duckduckgo.com/?q="
+ encodeURIComponent(soal)
+ "&format=json&no_redirect=1";

let res = await fetch(search);
let data = await res.json();

if(data.Abstract){
hasil = data.Abstract;
}

}catch(e){}

}


// ==========================
// 3. DETEKSI PILIHAN GANDA
// ==========================

let pilihan = soal.match(/[A-E]\.\s.*$/gm);

if(pilihan && hasil !== ""){

let teks = hasil.toLowerCase();

for(let p of pilihan){

let isi = p.slice(2).toLowerCase();

let kata = isi.split(" ");

for(let k of kata){

if(teks.includes(k)){
return "Jawaban kemungkinan:\n" + p + "\n\nPenjelasan:\n" + hasil;
}

}

}

}


// ==========================
// 4. JIKA MASIH KOSONG
// ==========================

if(hasil === ""){
hasil = "AI belum menemukan jawaban di internet.";
}

return hasil;

}