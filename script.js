// Comment added for fork


const CLIENT_ID = "16ddc329177f4de4b340d7e7570fde13";
const REDIRECT_URI = "https://mgnamdan.github.io/color-dj/"; // change to your deployed URL when hosting
const SCOPES = ""; // recommendations don’t need user scopes

/* ========= DOM ========= */
const colorInput = document.getElementById("colorInput");
const hexInput   = document.getElementById("hexInput");
const swatch     = document.getElementById("swatch");
const tempoEl    = document.getElementById("tempoVal");
const energyEl   = document.getElementById("energyVal");
const valenceEl  = document.getElementById("valenceVal");
const seedEl     = document.getElementById("seedVal");
const loginBtn   = document.getElementById("loginBtn");
const mixBtn     = document.getElementById("mixBtn");
const grid       = document.getElementById("grid");

let accessToken = null;

/* ========= AUTH (PKCE) ========= */
async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(len=64){
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = ""; for(let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
async function beginAuth(){
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256(codeVerifier);
  localStorage.setItem("mm_code_verifier", codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES
  });
  window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}
async function handleRedirect(){
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if(!code) return;

  const codeVerifier = localStorage.getItem("mm_code_verifier");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code, redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method:"POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if(!res.ok){ console.error("Token exchange failed", await res.text()); return; }
  const json = await res.json();
  accessToken = json.access_token;
  loginBtn.textContent = "Connected ✓";
  history.replaceState({}, "", REDIRECT_URI); // clean URL
}

/* ========= GENRE NORMALIZATION =========
   Only allowed seed genres will be sent. Synonyms translate to allowed ones.
   (Trimmed but broad, safe set.)
*/
const ALLOWED_GENRES = new Set([
  "acoustic","afrobeat","alt-rock","alternative","ambient","anime","bluegrass","blues",
  "bossanova","breakbeat","british","chicago-house","chill","classical","club","country",
  "dance","dancehall","death-metal","deep-house","detroit-techno","disco","disney",
  "drum-and-bass","dub","dubstep","edm","electro","electronic","emo","folk","forro",
  "funk","garage","gospel","goth","grindcore","groove","grunge","guitar","happy","hard-rock",
  "hardcore","hardstyle","heavy-metal","hip-hop","holidays","honky-tonk","house","idm",
  "indian","indie","indie-pop","industrial","j-dance","j-idol","j-pop","j-rock","jazz",
  "k-pop","latin","metal","metalcore","minimal-techno","movies","new-age","new-release",
  "opera","party","philippines-opm","piano","pop","power-pop","progressive-house","psych-rock",
  "punk","punk-rock","r-n-b","rainy-day","reggae","reggaeton","road-trip","rock","rock-n-roll",
  "rockabilly","romance","sad","salsa","samba","sertanejo","show-tunes","singer-songwriter",
  "ska","sleep","songwriter","soul","soundtracks","spanish","study","summer","synth-pop",
  "tango","techno","trance","trip-hop","work-out","world-music"
]);

const GENRE_SYNONYMS = {
  "electropop":"synth-pop",
  "alt-pop":"indie-pop",
  "dream-pop":"indie-pop",
  "downtempo":"trip-hop",
  "chillout":"chill",
  "rnb":"r-n-b",
  "hiphop":"hip-hop",
  "lofi":"chill",           // a reasonable proxy
  "lo-fi":"chill",
  "bedroom-pop":"indie-pop",
  "alt":"alternative"
};

function toAllowedGenres(list) {
  const out = [];
  for (const g of list) {
    const norm = (GENRE_SYNONYMS[g] || g).toLowerCase();
    if (ALLOWED_GENRES.has(norm)) out.push(norm);
  }
  // De-dup + max 3 (Spotify can take up to 5 mixed seeds, but we keep 3 for clarity)
  return [...new Set(out)].slice(0,3);
}

/* ========= COLOR → FEATURES ========= */
function hexToRgb(hex){
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if(!m) return null;
  return { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
}
function rgbToHsl(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h,s,l=(max+min)/2;
  if(max===min){ h=s=0; }
  else{
    const d = max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      case b: h=(r-g)/d+4; break;
    }
    h/=6;
  }
  return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) };
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function colorToFeatures(hex){
  const rgb = hexToRgb(hex);
  if(!rgb) return null;
  const {h,s,l} = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // tempo from hue: map 0–360 → 60–180 bpm (reds faster, blues calmer)
  const tempo = Math.round(60 + (h/360) * 120);

  // energy from saturation (0–100 → 0–1)
  const energy = clamp01(s/100);

  // valence from lightness (0–100 → 0–1)
  const valence = clamp01(l/100);

  // hue→seed genres (raw buckets), then normalize to allowed seeds
  let seedsRaw;
  if (h < 20 || h >= 340)      seedsRaw = ["rock","metal","punk"];
  else if (h < 70)             seedsRaw = ["pop","dance","edm"];
  else if (h < 160)            seedsRaw = ["acoustic","folk","singer-songwriter"];
  else if (h < 210)            seedsRaw = ["chill","ambient","downtempo"];
  else if (h < 260)            seedsRaw = ["indie","alt-rock","dream-pop"];
  else if (h < 300)            seedsRaw = ["r-n-b","hip-hop","neo-soul"];
  else                         seedsRaw = ["synth-pop","electropop","alt-pop"];

  const seeds = toAllowedGenres(seedsRaw);

  return {
    tempo,
    energy: +energy.toFixed(2),
    valence: +valence.toFixed(2),
    seeds,
    hsl: {h,s,l}
  };
}

/* ========= UI HELPERS ========= */
function updateSwatch(hex, feats){
  swatch.style.background = `linear-gradient(135deg, ${hex}, #0d0d14 70%)`;
  tempoEl.textContent   = feats ? feats.tempo : "—";
  energyEl.textContent  = feats ? feats.energy : "—";
  valenceEl.textContent = feats ? feats.valence : "—";
  seedEl.textContent    = feats ? (feats.seeds.length ? feats.seeds.join(", ") : "—") : "—";
}
function escapeHtml(s){ return s?.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) || ""; }
function card(track){
  const img = track.album?.images?.find(i => i.width >= 300) || track.album?.images?.[0];
  const art = img ? img.url : "";
  const artists = (track.artists || []).map(a => a.name).join(", ");
  const playUrl = `https://open.spotify.com/track/${track.id}`;
  const title = track.name;
  return `
    <article class="card">
      <img src="${art}" alt="">
      <div class="meta">
        <div class="title">${escapeHtml(title)}</div>
        <div class="subtitle">${escapeHtml(artists)}</div>
      </div>
      <a class="play" target="_blank" rel="noopener" href="${playUrl}">Play ▶</a>
    </article>
  `;
}
function renderTracks(tracks){
  grid.innerHTML = tracks.map(card).join("");
}

/* ========= RECOMMENDATIONS (with ranges + fallbacks) ========= */
function clamp(val, lo, hi){ return Math.max(lo, Math.min(hi, val)); }

async function getRecommendations(feats){
  if(!accessToken){ alert("Connect Spotify first."); return []; }

  // Primary seeds (validated) or safe default
  let seeds = feats.seeds.length ? feats.seeds : ["indie","pop","rock"];

  // Build a search window around the color-derived targets
  const minTempo   = clamp(feats.tempo - 30, 50, 200);
  const maxTempo   = clamp(feats.tempo + 30, 50, 200);
  const minEnergy  = clamp(+(feats.energy - 0.25).toFixed(2), 0, 1);
  const maxEnergy  = clamp(+(feats.energy + 0.25).toFixed(2), 0, 1);
  const minValence = clamp(+(feats.valence - 0.25).toFixed(2), 0, 1);
  const maxValence = clamp(+(feats.valence + 0.25).toFixed(2), 0, 1);

  // A small helper to call the endpoint
  async function callRecs(params){
    const res = await fetch(`https://api.spotify.com/v1/recommendations?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if(!res.ok){
      console.error("Recommendations failed", res.status, await res.text());
      return { tracks: [], seeds: [] };
    }
    return res.json();
  }

  // Pass 1: normal query (ranges + a gentle target tempo)
  let params = new URLSearchParams({
    limit: "24",
    seed_genres: seeds.slice(0,3).join(","),
    min_tempo: String(minTempo),
    max_tempo: String(maxTempo),
    min_energy: String(minEnergy),
    max_energy: String(maxEnergy),
    min_valence: String(minValence),
    max_valence: String(maxValence),
    target_tempo: String(feats.tempo),
    market: "from_token" // helps fit the user’s market
  });

  let json = await callRecs(params);
  if (json.tracks?.length) {
    console.log("Pass1 OK", json.seeds);
    return json.tracks;
  }

  // Pass 2: broaden seeds if we had none or it returned empty
  seeds = ["indie","pop","rock"];
  params.set("seed_genres", seeds.join(","));
  json = await callRecs(params);
  if (json.tracks?.length) {
    console.log("Pass2 OK (fallback seeds)", json.seeds);
    return json.tracks;
  }

  // Pass 3: very broad sweep (remove target_tempo; widen more)
  params.delete("target_tempo");
  params.set("min_tempo", "50");
  params.set("max_tempo", "200");
  params.set("min_energy", "0");
  params.set("max_energy", "1");
  params.set("min_valence", "0");
  params.set("max_valence", "1");
  json = await callRecs(params);
  if (json.tracks?.length) {
    console.log("Pass3 OK (broad)", json.seeds);
    return json.tracks;
  }

  return [];
}

/* ========= EVENTS ========= */
function syncFromColor(){
  const hex = colorInput.value.toLowerCase();
  hexInput.value = hex;
  const feats = colorToFeatures(hex);
  updateSwatch(hex, feats);
}
function syncFromHex(){
  let hex = hexInput.value.trim().toLowerCase();
  if(!/^#[0-9a-f]{6}$/.test(hex)) return; // wait until valid
  colorInput.value = hex;
  const feats = colorToFeatures(hex);
  updateSwatch(hex, feats);
}
async function handleMix(){
  const hex = hexInput.value.trim().toLowerCase();
  if(!/^#[0-9a-f]{6}$/.test(hex)) { alert("Please enter a valid hex like #6e5df6"); return; }
  const feats = colorToFeatures(hex);
  updateSwatch(hex, feats);
  grid.innerHTML = "<div style='opacity:.8'>Finding tracks that match your color…</div>";
  const tracks = await getRecommendations(feats);
  grid.innerHTML = tracks.length ? tracks.map(card).join("") : "<div>Nothing found. Try another color?</div>";
}

/* ========= INIT ========= */
window.addEventListener("DOMContentLoaded", async () => {
  await handleRedirect();
  updateSwatch(hexInput.value, colorToFeatures(hexInput.value));
  colorInput.addEventListener("input", syncFromColor);
  hexInput.addEventListener("input", syncFromHex);
  loginBtn.addEventListener("click", beginAuth);
  mixBtn.addEventListener("click", handleMix);
});