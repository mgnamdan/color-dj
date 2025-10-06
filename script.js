/* ========= SETUP =========
  1) Make a Spotify App: https://developer.spotify.com/dashboard
  2) Add your Redirect URI (e.g., http://localhost:5500 or https://your.site)
  3) Fill CLIENT_ID and REDIRECT_URI below.
*/
const CLIENT_ID = "16ddc329177f4de4b340d7e7570fde13";
const REDIRECT_URI = "https://mgnamdan.github.io/color-dj/"; // change to your deployed URL when hosting
const SCOPES = ""; // recommendations don’t need user scopes

// --- UI elements
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

let accessToken = null; // stored after PKCE auth

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
  loginBtn.classList.add("connected");
  // optional: remove ?code=... from the URL
  history.replaceState({}, "", REDIRECT_URI);
}

/* ========= COLOR → FEATURES MAPPING =========
   We map HSL to Spotify audio features:
   - hue (0–360)        → target_tempo (60–180 bpm) and seed genres
   - saturation (0–100) → target_energy (0–1)
   - lightness (0–100)  → target_valence (0–1)
*/
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

  // genre seeds from hue buckets
  let seeds;
  if (h < 20 || h >= 340) seeds = ["rock","metal","punk"];
  else if (h < 70)        seeds = ["pop","dance","edm"];
  else if (h < 160)       seeds = ["acoustic","folk","singer-songwriter"];
  else if (h < 210)       seeds = ["chill","ambient","downtempo"];
  else if (h < 260)       seeds = ["indie","alt-rock","dream-pop"];
  else if (h < 300)       seeds = ["r-n-b","hip-hop","neo-soul"];
  else                    seeds = ["synth-pop","electropop","alt-pop"];

  return { tempo, energy: +energy.toFixed(2), valence: +valence.toFixed(2), seeds, hsl: {h,s,l} };
}

function updateSwatch(hex, feats){
  swatch.style.background = `linear-gradient(135deg, ${hex}, #0d0d14 70%)`;
  tempoEl.textContent   = feats ? feats.tempo : "—";
  energyEl.textContent  = feats ? feats.energy : "—";
  valenceEl.textContent = feats ? feats.valence : "—";
  seedEl.textContent    = feats ? feats.seeds.join(", ") : "—";
}

/* ========= SPOTIFY CALL ========= */
async function getRecommendations(feats){
  if(!accessToken){
    alert("Connect your Spotify account first.");
    return [];
  }
  // build query
  const params = new URLSearchParams({
    limit: "24",
    seed_genres: feats.seeds.slice(0,3).join(","),
    target_tempo: feats.tempo,
    target_energy: feats.energy,
    target_valence: feats.valence
  });
  const res = await fetch(`https://api.spotify.com/v1/recommendations?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if(!res.ok){
    console.error("Recommendations failed", await res.text());
    if(res.status === 401) alert("Session expired—please reconnect Spotify.");
    return [];
  }
  const json = await res.json();
  return json.tracks || [];
}

/* ========= RENDER ========= */
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
function escapeHtml(s){ return s?.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) || ""; }

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
  if(!/^#[0-9a-f]{6}$/.test(hex)) { alert("Please enter a valid hex color like #6e5df6"); return; }
  const feats = colorToFeatures(hex);
  updateSwatch(hex, feats);
  // Subtle progress state
  grid.innerHTML = "<div style='opacity:.8'>Finding tracks that match your color…</div>";
  const tracks = await getRecommendations(feats);
  if(!tracks.length){ grid.innerHTML = "<div>Nothing found. Try a different color?</div>"; return; }
  renderTracks(tracks);
}

/* ========= INIT ========= */
window.addEventListener("DOMContentLoaded", async () => {
  // hydrate from URL/PKCE
  await handleRedirect();

  // seed initial swatch
  updateSwatch(hexInput.value, colorToFeatures(hexInput.value));

  // UI hooks
  colorInput.addEventListener("input", syncFromColor);
  hexInput.addEventListener("input", syncFromHex);
  loginBtn.addEventListener("click", beginAuth);
  mixBtn.addEventListener("click", handleMix);
});