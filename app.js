// Firebase (compat) yapılandırma
const firebaseConfig = {
  apiKey: "AIzaSyAJkdKDJc0_5OB-QLPpTE7KhSEUAW8qyzg",
  authDomain: "msfs-1eeed.firebaseapp.com",
  projectId: "msfs-1eeed",
  storageBucket: "msfs-1eeed.appspot.com",
  messagingSenderId: "953746578457",
  appId: "1:953746578457:web:df91b27ab14884c94dde88",
  measurementId: "G-M0DTKY5QPQ"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Sadece sahibin yazabilmesi için UID
const OWNER_UID = "RBnsLQ1odEXiY9JsIA9VdnyiJi03";

// UI elemanları
const signInBtn = document.getElementById("sign-in-btn");
const signOutBtn = document.getElementById("sign-out-btn");
const userInfo = document.getElementById("user-info");
const adminPanel = document.getElementById("admin-panel");
const routeStatus = document.getElementById("route-status");
const fitRouteBtn = document.getElementById("fit-route-btn");
const resetViewBtn = document.getElementById("reset-view-btn");
const searchInput = document.getElementById("search-city");
const shareBtn = document.getElementById("share-link-btn");
const baseSelect = document.getElementById('basemap-select');
const editRoutesBtn = document.getElementById("edit-routes-btn");
const routePanel = document.getElementById("route-panel");
const closeRoutePanel = document.getElementById("close-route-panel");
const routeList = document.getElementById("route-list");

// İstatistik elemanları
const statCount = document.getElementById('stat-count');
const statVisited = document.getElementById('stat-visited');
const statDuration = document.getElementById('stat-duration');
const statDistance = document.getElementById('stat-distance');

// Modal elemanları
const visitModal = document.getElementById("visit-modal");
const visitModalClose = document.getElementById("visit-modal-close");
const visitDepCity = document.getElementById("visit-dep-city");
const visitArrCity = document.getElementById("visit-arr-city");
const visitAircraft = document.getElementById("visit-aircraft");
const visitDuration = document.getElementById("visit-duration");
const visitDistance = document.getElementById("visit-distance");
const visitDep = document.getElementById("visit-dep");
const visitArr = document.getElementById("visit-arr");
const visitNotes = document.getElementById("visit-notes");
const visitCancel = document.getElementById("visit-cancel");
const visitSave = document.getElementById("visit-save");
let currentEditId = null;

let isAdmin = false;

// Giriş / Çıkış
signInBtn.addEventListener("click", async () => {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    console.error("signIn error:", e);
    alert("Giriş hatası: " + (e && e.message ? e.message : e));
  }
});

signOutBtn.addEventListener("click", async () => {
  await auth.signOut();
});

auth.onAuthStateChanged((user) => {
  if (user) {
    const isOwner = user.uid === OWNER_UID;
    console.log("UID (Rules'a koy):", user.uid);
    if (userInfo) userInfo.textContent = `Giriş: ${user.displayName || user.email}`;
    if (signInBtn) signInBtn.classList.add("hidden");
    if (signOutBtn) signOutBtn.classList.remove("hidden");
    isAdmin = isOwner; // yalnızca OWNER admin
    if (adminPanel) {
      if (isOwner) adminPanel.classList.remove("hidden");
      else adminPanel.classList.add("hidden");
    }
  } else {
    if (userInfo) userInfo.textContent = "";
    if (signInBtn) signInBtn.classList.remove("hidden");
    if (signOutBtn) signOutBtn.classList.add("hidden");
    isAdmin = false;
    if (adminPanel) adminPanel.classList.add("hidden");
  }
});

// Harita
var defaultView = { center: [41.015137, 28.97953], zoom: 4 };
function parseHashView() {
  try {
    if (location.hash && location.hash.startsWith('#v=')) {
      var parts = location.hash.substring(3).split(',');
      var lat = parseFloat(parts[0]);
      var lng = parseFloat(parts[1]);
      var zoom = parseInt(parts[2], 10);
      if (isFinite(lat) && isFinite(lng) && isFinite(zoom)) {
        return { center: [lat, lng], zoom: zoom };
      }
    }
  } catch (e) {}
  return null;
}
var initialView = parseHashView() || defaultView;
var map = L.map("map", { worldCopyJump: true }).setView(initialView.center, initialView.zoom);

// Taban harita katmanları
var baseLayers = {
  'osm': L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap katkıcıları" }),
  'carto-dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap, © CARTO' })
};
var currentBaseKey = 'osm';
baseLayers[currentBaseKey].addTo(map);

// Marker cluster katmanı
var clusterGroup = (typeof L.markerClusterGroup === 'function') ? L.markerClusterGroup({
  disableClusteringAtZoom: 10,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false
}) : null;
if (clusterGroup) clusterGroup.addTo(map);

function updateHashFromMap() {
  var c = map.getCenter();
  var z = map.getZoom();
  var hash = `#v=${c.lat.toFixed(5)},${c.lng.toFixed(5)},${z}`;
  history.replaceState(null, '', hash);
}
map.on('moveend', updateHashFromMap);

// Şehir/rota
var cityMarkers = new Map();
var cityData = new Map(); // id -> last data snapshot
var routeLine = L.polyline([], { 
  color: "#1e40af", 
  weight: 12, 
  className: 'route-line',
  interactive: true,
  bubblingMouseEvents: false
}).addTo(map);

// Rota çizgisine CTRL + tıklama eventi (admin için)
routeLine.on('click', function(e) {
  if (!isAdmin) return;
  
  // Sadece CTRL tuşu basılıyken çalışsın
  if (!e.originalEvent.ctrlKey) return;
  
  e.originalEvent.stopPropagation(); // Harita tıklama eventini engelle
  e.originalEvent.preventDefault(); // Varsayılan davranışı engelle
  openFlightModal(e.latlng);
});

// Rota çizgisine hover eventi (seyirciler için)
routeLine.on('mouseover', function(e) {
  // Admin'ler için de hover çalışsın
  showFlightInfo(e.latlng, e.originalEvent);
});

routeLine.on('mouseout', function(e) {
  // Herkes için hover gizlensin
  hideFlightInfo();
});
var routeArrows = []; // small arrow markers along the route
var metaDoc = db.collection("meta").doc("route");

function cityDoc(id) { return db.collection("visited").doc(id); }
function latLngId(latlng) { return latlng.lat.toFixed(5) + "_" + latlng.lng.toFixed(5); }

function buildIcon(color) {
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
    '<circle cx="12" cy="12" r="8" fill="' + color + '" stroke="#111" stroke-width="2" />' +
    "</svg>";
  return L.divIcon({ className: "city-icon", html: svg, iconSize: [24, 24], iconAnchor: [12, 12] });
}

// Pilot ikonu fonksiyonu kaldırıldı

function renderMarkerPopupHtml(id, data) {
  var name = data.name || id;
  var aircraft = data.aircraft || "-";
  var duration = (typeof data.durationMinutes === 'number') ? (data.durationMinutes + ' dk') : (data.duration || data.durationMinutes || "-");
  var dep = data.depIcao || data.dep || "-";
  var arr = data.arrIcao || data.arr || "-";
  var distanceNm = (typeof data.distanceNm === 'number') ? (data.distanceNm + ' NM') : (data.distance || data.distanceNm || "-");
  var weather = data.weather || "-";
  var notes = data.notes || "";
  var lines = [
    `<div><strong>${name}</strong></div>`,
    `<div>Uçak: ${aircraft}</div>`,
    `<div>Süre: ${duration}</div>`,
    `<div>Mesafe: ${distanceNm}</div>`,
    `<div>Hava: ${weather}</div>`,
    `<div>Kalkış: ${dep} • İniş: ${arr}</div>`
  ];
  if (notes) lines.push(`<div>Not: ${notes}</div>`);
  // Düzenle butonu kaldırıldı - sadece bilgi gösterimi
  return lines.join('');
}

function bindMarkerPopup(marker, id, data) {
  // Popup'lar tamamen kaldırıldı - sadece tooltip kullanılıyor
  // Marker'a popup bind etmeyi tamamen engelle
  marker.unbindPopup();
}

function ensureOnMap(marker) {
  if (clusterGroup) {
    if (!clusterGroup.hasLayer(marker)) clusterGroup.addLayer(marker);
  } else {
    if (!map.hasLayer(marker)) marker.addTo(map);
  }
}
function ensureOffMap(marker) {
  if (clusterGroup) {
    if (clusterGroup.hasLayer(marker)) clusterGroup.removeLayer(marker);
  } else {
    if (map.hasLayer(marker)) map.removeLayer(marker);
  }
}

function upsertMarker(id, data) {
  var lat = data.lat, lng = data.lng, label = data.name || id;
  var visited = data.visited === true, color = visited ? "#2ecc71" : "#e74c3c";
  cityData.set(id, data);
  if (cityMarkers.has(id)) {
    var m = cityMarkers.get(id);
    m.setLatLng([lat, lng]);
    m.setIcon(buildIcon(color));
    m.bindTooltip(data.name || id, { permanent: false, direction: 'top' });
    bindMarkerPopup(m, id, data);
  } else {
    var marker = L.marker([lat, lng], { icon: buildIcon(color) }).bindTooltip(data.name || id, { permanent: false, direction: 'top' });
    bindMarkerPopup(marker, id, data);

// Marker tıklama eventleri kaldırıldı - sadece görsel
// Sol tık = ziyaret değiştir, Shift + Sol tık = SİL
marker.on("click", function (e) {
  if (!isAdmin) return;
  if (e && e.originalEvent && e.originalEvent.shiftKey) {
    if (confirm("Bu noktayı tamamen sil?")) deleteCity(id);
  } else {
    toggleVisited(id);
  }
});

// Sağ tık = SİL (destekleyen tarayıcılarda)
marker.on("contextmenu", function (e) {
  if (!isAdmin) return;
  if (e && e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault();
  if (confirm("Bu noktayı tamamen sil?")) deleteCity(id);
});

// Çift tık = düzenle (sadece admin) - şehir detayları
marker.on("dblclick", function () { if (isAdmin) openVisitModal(id); });

    cityMarkers.set(id, marker);
    ensureOnMap(marker);
  }
}

function drawRoute(order) {
  var pts = [];
  for (var i = 0; i < order.length; i++) {
    var m = cityMarkers.get(order[i]);
    if (m) pts.push(m.getLatLng());
  }
  routeLine.setLatLngs(pts);
  // Clear old arrows
  routeArrows.forEach(function (a) { if (map.hasLayer(a)) map.removeLayer(a); });
  routeArrows = [];
  
  // Pilot şapkası sembolleri kaldırıldı - sadece rota çizgisi
  if (routeStatus) routeStatus.textContent = pts.length ? ("Rota noktası: " + pts.length) : "";
}

function refreshRoute() {
  metaDoc.get().then(function (snap) {
    var order = snap.exists ? (snap.data().order || []) : [];
    drawRoute(order);
  });
}

function formatNumber(n) {
  return n.toLocaleString('tr-TR');
}

function updateStats() {
  var total = 0, totalVisited = 0, sumDur = 0, sumDist = 0;

  cityMarkers.forEach(function (marker, id) {
    var d = cityData.get(id) || {};
    total += 1;
    if (d.visited === true) totalVisited += 1;
    ensureOnMap(marker); // Tüm marker'ları göster
    var dur = (typeof d.durationMinutes === 'number') ? d.durationMinutes : (parseInt(d.duration, 10) || null);
    var dist = (typeof d.distanceNm === 'number') ? d.distanceNm : (parseInt(d.distance, 10) || null);
    if (dur) sumDur += dur;
    if (dist) sumDist += dist;
  });

  if (statCount) statCount.textContent = 'Nokta: ' + formatNumber(total);
  if (statVisited) statVisited.textContent = 'Ziyaret: ' + formatNumber(totalVisited);
  if (statDuration) statDuration.textContent = 'Toplam süre: ' + formatNumber(sumDur) + ' dk';
  if (statDistance) statDistance.textContent = 'Toplam mesafe: ' + formatNumber(sumDist) + ' NM';
}

// Firestore canlı dinleme
db.collection("visited").onSnapshot(function (snap) {
  snap.docChanges().forEach(function (ch) {
    var id = ch.doc.id, d = ch.doc.data();
    if (ch.type === "removed") {
      if (cityMarkers.has(id)) {
        var m = cityMarkers.get(id);
        ensureOffMap(m);
        cityMarkers.delete(id);
      }
      cityData.delete(id);
    } else {
      upsertMarker(id, d);
    }
  });
  updateStats();
  refreshRoute();
});

metaDoc.onSnapshot(function (doc) {
  var data = doc && doc.data ? doc.data() : null;
  var order = data && data.order ? data.order : [];
  drawRoute(order);
});

// Admin: haritaya tıklayınca nokta ekle
map.on("click", function (e) {
  if (!isAdmin) return;
  var id = latLngId(e.latlng);
  var name = prompt("Şehir/konum adı:", "");
  if (name === null) return;
  cityDoc(id).set({
    name: (name && name.trim()) ? name.trim() : id,
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    visited: true,
    updatedAt: Date.now()
  }, { merge: true }).then(function () {
    pushToRoute(id);
  }).catch(function (err) {
    console.error("write error:", err);
    alert("Yazma hatası: " + (err && err.message ? err.message : err));
  });
});

// Ziyaret değiştir
function toggleVisited(id) {
  cityDoc(id).get().then(function (doc) {
    if (!doc.exists) return;
    var prev = doc.data().visited === true;
    cityDoc(id).set({ visited: !prev, updatedAt: Date.now() }, { merge: true })
      .then(function () { if (!prev) pushToRoute(id); else removeFromRoute(id); })
      .catch(function (err) { console.error("toggle error:", err); });
  });
}

// Rota ekle/çıkar
function pushToRoute(id) {
  return db.runTransaction(function (tx) {
    return tx.get(metaDoc).then(function (snap) {
      var order = snap.exists ? (snap.data().order || []) : [];
      if (order.indexOf(id) === -1) order.push(id);
      tx.set(metaDoc, { order: order }, { merge: true });
    });
  });
}

function removeFromRoute(id) {
  return db.runTransaction(function (tx) {
    return tx.get(metaDoc).then(function (snap) {
      var order = snap.exists ? (snap.data().order || []) : [];
      var next = order.filter(function (x) { return x !== id; });
      tx.set(metaDoc, { order: next }, { merge: true });
    });
  });
}
function deleteCity(id) {
  removeFromRoute(id).finally(function () {
    cityDoc(id).delete().catch(function (err) {
      console.error("delete error:", err);
      alert("Silme hatası: " + (err && err.message ? err.message : err));
    });
  });
}
// Admin panel butonları (opsiyonel)
var undoBtn = document.getElementById("undo-last");
if (undoBtn) undoBtn.addEventListener("click", function () {
  if (!isAdmin) return;
  metaDoc.get().then(function (snap) {
    var order = snap.exists ? (snap.data().order || []) : [];
    var last = order[order.length - 1];
    if (last) removeFromRoute(last);
  });
});

var clearBtn = document.getElementById("clear-all");
if (clearBtn) clearBtn.addEventListener("click", function () {
  if (!isAdmin) return;
  if (!confirm("Tüm rota ve işaretleri temizle? (Geri alınamaz)")) return;
  db.collection("visited").get().then(function (s) {
    var b = db.batch();
    s.forEach(function (d) { b.delete(d.ref); });
    return b.commit();
  }).then(function () {
    return metaDoc.set({ order: [] });
  });
});

// Harita kontrol butonları
function fitRouteToView() {
  try {
    var points = routeLine.getLatLngs();
    if (points && points.length > 1) {
      var bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [30, 30] });
      return;
    }
    if (points && points.length === 1) {
      map.setView(points[0], Math.max(map.getZoom(), 8));
      return;
    }
    var allMarkerLatLngs = [];
    cityMarkers.forEach(function (m) { allMarkerLatLngs.push(m.getLatLng()); });
    if (allMarkerLatLngs.length > 0) {
      var allBounds = L.latLngBounds(allMarkerLatLngs);
      map.fitBounds(allBounds, { padding: [30, 30] });
    }
  } catch (err) {
    console.error("fitRouteToView error:", err);
  }
}

function resetMapView() {
  map.setView(initialView.center, initialView.zoom);
}

if (fitRouteBtn) {
  fitRouteBtn.addEventListener("click", function () { fitRouteToView(); });
}
if (resetViewBtn) {
  resetViewBtn.addEventListener("click", function () { resetMapView(); });
}

// Arama: Enter ile en iyi eşleşene git
if (searchInput) {
  searchInput.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var q = (searchInput.value || "").trim().toLowerCase();
    if (!q) return;
    var bestId = null;
    var bestScore = -1;
    cityMarkers.forEach(function (marker, id) {
      var label = marker.getTooltip() ? marker.getTooltip().getContent() : id;
      var text = String(label || id).toLowerCase();
      var score = 0;
      if (text === q) score = 3; // tam eşleşme
      else if (text.startsWith(q)) score = 2; // baştan eşleşme
      else if (text.indexOf(q) !== -1) score = 1; // içinde geçiyor
      if (score > bestScore) { bestScore = score; bestId = id; }
    });
    if (bestId && cityMarkers.has(bestId)) {
      var target = cityMarkers.get(bestId).getLatLng();
      map.flyTo(target, Math.max(map.getZoom(), 8));
    }
  });
}

// Paylaşılabilir bağlantı: mevcut görünüm hash'ini kopyala
if (shareBtn) {
  shareBtn.addEventListener('click', async function () {
    try {
      updateHashFromMap();
      var url = location.href;
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = 'Kopyalandı!';
      setTimeout(function(){ shareBtn.textContent = 'Bağlantıyı paylaş'; }, 1200);
    } catch (e) {
      alert('Kopyalama başarısız. URL:\n' + location.href);
    }
  });
}

if (baseSelect) {
  baseSelect.addEventListener('change', function(){
    var nextKey = baseSelect.value;
    if (nextKey === currentBaseKey) return;
    if (baseLayers[currentBaseKey]) map.removeLayer(baseLayers[currentBaseKey]);
    currentBaseKey = nextKey;
    baseLayers[currentBaseKey].addTo(map);
  });
}

// Rota paneli event listener'ları
if (editRoutesBtn) {
  editRoutesBtn.addEventListener('click', function() {
    if (!isAdmin) {
      alert('Rota düzenlemek için admin olarak giriş yapmanız gerekiyor.');
      return;
    }
    routePanel.classList.remove('hidden');
    updateRouteList();
  });
}

if (closeRoutePanel) {
  closeRoutePanel.addEventListener('click', function() {
    routePanel.classList.add('hidden');
  });
}

function haversineNm(lat1, lon1, lat2, lon2) {
  function toRad(d){ return d * Math.PI / 180; }
  var Rkm = 6371;
  var dLat = toRad(lat2 - lat1);
  var dLon = toRad(lon2 - lon1);
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  var dKm = Rkm * c;
  return dKm * 0.539957; // km -> deniz mili
}

// Mesafe hesaplama fonksiyonu
function haversineNm(lat1, lon1, lat2, lon2) {
  function toRad(d){ return d * Math.PI / 180; }
  var Rkm = 6371;
  var dLat = toRad(lat2 - lat1);
  var dLon = toRad(lon2 - lon1);
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  var dKm = Rkm * c;
  return dKm * 0.539957; // km -> deniz mili
}

// Hata önleme ve güvenlik kontrolleri
function validateFlightData(payload) {
  // Boş değerleri temizle
  if (payload.durationMinutes === null || payload.durationMinutes === '') payload.durationMinutes = null;
  if (payload.distanceNm === null || payload.distanceNm === '') payload.distanceNm = null;
  
  // Sayısal değerleri kontrol et
  if (payload.durationMinutes !== null && (!isFinite(payload.durationMinutes) || payload.durationMinutes < 0)) {
    alert('Süre geçersiz. Pozitif bir sayı girin.');
    return false;
  }
  if (payload.distanceNm !== null && (!isFinite(payload.distanceNm) || payload.distanceNm < 0)) {
    alert('Mesafe geçersiz. Pozitif bir sayı girin.');
    return false;
  }
  
  // ICAO kodlarını kontrol et
  if (payload.depIcao && payload.depIcao.length > 4) {
    alert('ICAO kodu en fazla 4 karakter olabilir.');
    return false;
  }
  if (payload.arrIcao && payload.arrIcao.length > 4) {
    alert('ICAO kodu en fazla 4 karakter olabilir.');
    return false;
  }
  
  return true;
}

// Modal yardımcıları
function openFlightModal(clickLatLng) {
  currentEditId = null; // Rota segmenti için ID yok
  currentClickLatLng = clickLatLng;
  
  // Form alanlarını temizle
  if (visitDepCity) visitDepCity.value = '';
  if (visitArrCity) visitArrCity.value = '';
  if (visitAircraft) visitAircraft.value = '';
  if (visitDuration) visitDuration.value = '';
  if (visitDistance) visitDistance.value = '';
  if (visitWeather) visitWeather.value = '';
  if (visitDep) visitDep.value = '';
  if (visitArr) visitArr.value = '';
  if (visitNotes) visitNotes.value = '';
  
  // Otomatik mesafe hesapla (tıklanan noktaya en yakın iki şehir arası)
  var nearestCities = findNearestCities(clickLatLng);
  if (nearestCities.length >= 2) {
    var city1 = nearestCities[0];
    var city2 = nearestCities[1];
    if (visitDepCity) visitDepCity.value = city1.name || city1.id;
    if (visitArrCity) visitArrCity.value = city2.name || city2.id;
    if (visitDep) visitDep.value = city1.depIcao || city1.dep || '';
    if (visitArr) visitArr.value = city2.arrIcao || city2.arr || '';
    
    // Mesafe hesapla
    var distance = haversineNm(city1.lat, city1.lng, city2.lat, city2.lng);
    if (visitDistance) visitDistance.value = Math.round(distance);
  }
  
  if (visitModal) {
    visitModal.classList.remove('hidden');
    visitModal.removeAttribute('aria-hidden'); // aria-hidden kaldır
  }
}

function findNearestCities(clickLatLng) {
  var cities = [];
  cityMarkers.forEach(function(marker, id) {
    var data = cityData.get(id);
    if (data) {
      var distance = haversineNm(clickLatLng.lat, clickLatLng.lng, data.lat, data.lng);
      cities.push({
        id: id,
        name: data.name,
        lat: data.lat,
        lng: data.lng,
        depIcao: data.depIcao,
        dep: data.dep,
        arrIcao: data.arrIcao,
        arr: data.arr,
        distance: distance
      });
    }
  });
  
  // Mesafeye göre sırala ve en yakın 2 şehri döndür
  cities.sort(function(a, b) { return a.distance - b.distance; });
  return cities.slice(0, 2);
}

// Hover için bilgi gösterme fonksiyonları
function showFlightInfo(latLng, event) {
  // Önce mevcut tooltip'i temizle
  if (window.currentTooltip) {
    map.removeLayer(window.currentTooltip);
    window.currentTooltip = null;
  }
  
  var nearestCities = findNearestCities(latLng);
  if (nearestCities.length < 2) return;
  
  var city1 = nearestCities[0];
  var city2 = nearestCities[1];
  var distance = haversineNm(city1.lat, city1.lng, city2.lat, city2.lng);
  
  // Tooltip oluştur - SADECE MESAFE
  var tooltip = L.tooltip({
    content: `
      <div style="font-size: 12px; line-height: 1.4; min-width: 150px; padding: 8px;">
        <div style="font-weight: bold; margin-bottom: 6px; color: #1e40af; font-size: 13px;">${city1.name} → ${city2.name}</div>
        <div style="margin-bottom: 3px; color: #333;">📏 Mesafe: <strong>${Math.round(distance)} NM</strong></div>
      </div>
    `,
    permanent: false,
    direction: 'top',
    offset: [0, -10],
    className: 'flight-tooltip'
  });
  
  tooltip.setLatLng(latLng).addTo(map);
  window.currentTooltip = tooltip;
}

function hideFlightInfo() {
  if (window.currentTooltip) {
    map.removeLayer(window.currentTooltip);
    window.currentTooltip = null;
  }
}

// Rota listesini güncelle
function updateRouteList() {
  if (!routeList) return;
  
  var flights = JSON.parse(localStorage.getItem('flightSegments') || '[]');
  
  if (flights.length === 0) {
    routeList.innerHTML = '<div class="empty-routes">Henüz uçuş rotası eklenmemiş</div>';
    return;
  }
  
  var html = '';
  flights.forEach(function(flight, index) {
    var nearestCities = findNearestCities(flight.clickLatLng);
    var city1 = nearestCities[0] || { name: 'Bilinmeyen' };
    var city2 = nearestCities[1] || { name: 'Bilinmeyen' };
    
    html += `
      <div class="route-item">
        <div class="route-info">
          <div class="route-route">${city1.name} → ${city2.name}</div>
          <div class="route-details">
            ${flight.aircraft || '-'} • ${flight.durationMinutes ? flight.durationMinutes + 'dk' : '-'} • ${flight.distanceNm ? flight.distanceNm + 'NM' : '-'}
          </div>
        </div>
        <div class="route-actions">
          <button class="route-btn edit" onclick="editRouteSegment(${index})">Düzenle</button>
          <button class="route-btn delete" onclick="deleteRouteSegment(${index})">Sil</button>
        </div>
      </div>
    `;
  });
  
  routeList.innerHTML = html;
}

// Rota segmentini düzenle
function editRouteSegment(index) {
  var flights = JSON.parse(localStorage.getItem('flightSegments') || '[]');
  if (flights[index]) {
    currentEditId = null;
    currentClickLatLng = flights[index].clickLatLng;
    
    // Form alanlarını doldur
    if (visitDepCity) visitDepCity.value = flights[index].depCity || '';
    if (visitArrCity) visitArrCity.value = flights[index].arrCity || '';
    if (visitAircraft) visitAircraft.value = flights[index].aircraft || '';
    if (visitDuration) visitDuration.value = flights[index].durationMinutes || '';
    if (visitDistance) visitDistance.value = flights[index].distanceNm || '';
    if (visitWeather) visitWeather.value = flights[index].weather || '';
    if (visitDep) visitDep.value = flights[index].depIcao || '';
    if (visitArr) visitArr.value = flights[index].arrIcao || '';
    if (visitNotes) visitNotes.value = flights[index].notes || '';
    
    // Modal'ı aç
    if (visitModal) visitModal.classList.remove('hidden');
    
    // Rota panelini kapat
    if (routePanel) routePanel.classList.add('hidden');
  }
}

// Rota segmentini sil
function deleteRouteSegment(index) {
  if (!confirm('Bu uçuş segmentini silmek istediğinizden emin misiniz?')) return;
  
  var flights = JSON.parse(localStorage.getItem('flightSegments') || '[]');
  flights.splice(index, 1);
  localStorage.setItem('flightSegments', JSON.stringify(flights));
  
  updateRouteList();
}

function openVisitModal(id) {
  currentEditId = id;
  cityDoc(id).get().then(function (doc) {
    var d = doc.exists ? doc.data() : {};
    if (visitDepCity) visitDepCity.value = (d.name || id);
    if (visitArrCity) visitArrCity.value = '';
    if (visitAircraft) visitAircraft.value = d.aircraft || '';
    if (visitDuration) visitDuration.value = (typeof d.durationMinutes === 'number') ? d.durationMinutes : (parseInt(d.duration, 10) || '');
    if (visitDistance) visitDistance.value = (typeof d.distanceNm === 'number') ? d.distanceNm : (parseInt(d.distance, 10) || '');
    if (visitWeather) visitWeather.value = d.weather || '';
    if (visitDep) visitDep.value = d.depIcao || d.dep || '';
    if (visitArr) visitArr.value = d.arrIcao || d.arr || '';
    if (visitNotes) visitNotes.value = d.notes || '';
    if (visitModal) visitModal.classList.remove('hidden');
  });
}
function closeVisitModal() {
  if (visitModal) {
    visitModal.classList.add('hidden');
    visitModal.removeAttribute('aria-hidden'); // aria-hidden kaldır
  }
  currentEditId = null;
}
function saveVisitModal() {
  var payload = {
    depCity: visitDepCity ? visitDepCity.value.trim() : '',
    arrCity: visitArrCity ? visitArrCity.value.trim() : '',
    aircraft: visitAircraft ? visitAircraft.value.trim() : '',
    durationMinutes: visitDuration && visitDuration.value !== '' ? parseInt(visitDuration.value, 10) : null,
    distanceNm: visitDistance && visitDistance.value !== '' ? parseInt(visitDistance.value, 10) : null,
    weather: visitWeather ? visitWeather.value.trim() : '',
    depIcao: visitDep ? visitDep.value.trim().toUpperCase() : '',
    arrIcao: visitArr ? visitArr.value.trim().toUpperCase() : '',
    notes: visitNotes ? visitNotes.value.trim() : '',
    updatedAt: Date.now()
  };
  
  // Validasyon kontrolü
  if (!validateFlightData(payload)) return;
  
  // Eğer rota segmenti için kaydediliyorsa (currentEditId null ise)
  if (!currentEditId) {
    var flights = JSON.parse(localStorage.getItem('flightSegments') || '[]');
    
    // Aynı konuma yakın mevcut uçuş var mı kontrol et
    var existingFlightIndex = -1;
    for (var i = 0; i < flights.length; i++) {
      var flight = flights[i];
      var distance = haversineNm(currentClickLatLng.lat, currentClickLatLng.lng, flight.clickLatLng.lat, flight.clickLatLng.lng);
      if (distance < 0.1) { // 0.1 NM içinde ise aynı segment
        existingFlightIndex = i;
        break;
      }
    }
    
    var flightData = {
      depCity: payload.depCity,
      arrCity: payload.arrCity,
      aircraft: payload.aircraft,
      durationMinutes: payload.durationMinutes,
      distanceNm: payload.distanceNm,
      weather: payload.weather,
      depIcao: payload.depIcao,
      arrIcao: payload.arrIcao,
      notes: payload.notes,
      clickLatLng: currentClickLatLng,
      id: existingFlightIndex >= 0 ? flights[existingFlightIndex].id : 'flight_' + Date.now(),
      updatedAt: Date.now()
    };
    
    if (existingFlightIndex >= 0) {
      // Mevcut uçuşu güncelle
      flights[existingFlightIndex] = flightData;
    } else {
      // Yeni uçuş ekle
      flights.push(flightData);
    }
    
    localStorage.setItem('flightSegments', JSON.stringify(flights));
    updateRouteList();
    closeVisitModal();
    return;
  }
  
  // Mevcut şehir düzenleme mantığı
  payload.name = payload.depCity || currentEditId;
  if (payload.durationMinutes !== null && (!isFinite(payload.durationMinutes) || payload.durationMinutes < 0)) {
    alert('Süre geçersiz.');
    return;
  }
  if (payload.distanceNm !== null && (!isFinite(payload.distanceNm) || payload.distanceNm < 0)) {
    alert('Mesafe geçersiz.');
    return;
  }
  // Otomatik mesafe: eğer girilmemişse ve bu noktanın rotada bir önceki noktası biliniyorsa
  if ((payload.distanceNm === null || payload.distanceNm === undefined) && cityMarkers.has(currentEditId)) {
    var prevPoint = null;
    // metaDoc order içinden currentEditId'nin bir önceki id'sini bul
    // Bu senkron değil; basitçe mevcut polylinedan en yakın önceki segmenti bulacağız
    var pts = routeLine.getLatLngs();
    var target = cityMarkers.get(currentEditId).getLatLng();
    for (var i = 1; i < pts.length; i++) {
      if (pts[i].lat === target.lat && pts[i].lng === target.lng) { prevPoint = pts[i-1]; break; }
    }
    if (prevPoint) {
      var nm = haversineNm(prevPoint.lat, prevPoint.lng, target.lat, target.lng);
      payload.distanceNm = Math.round(nm);
      if (visitDistance) visitDistance.value = String(payload.distanceNm);
    }
  }
  if (payload.durationMinutes === null) delete payload.durationMinutes;
  if (payload.distanceNm === null || payload.distanceNm === undefined) delete payload.distanceNm;
  cityDoc(currentEditId).set(payload, { merge: true }).then(function () {
    closeVisitModal();
  }).catch(function (err) {
    console.error('save error:', err);
    alert('Kaydetme hatası: ' + (err && err.message ? err.message : err));
  });
}

if (visitCancel) visitCancel.addEventListener('click', closeVisitModal);
if (visitModalClose) visitModalClose.addEventListener('click', closeVisitModal);
if (visitModal) visitModal.addEventListener('click', function (e) { if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) closeVisitModal(); });
if (visitSave) visitSave.addEventListener('click', saveVisitModal);

// Filtre olaylarını bağla ve ilk hesaplama
updateStats();

// Sayfa yüklendiğinde rota listesini güncelle
if (routeList) {
  updateRouteList();
}

// Hata yakalama ve loglama
window.addEventListener('error', function(e) {
  console.error('Uygulama hatası:', e.error);
});

// localStorage temizleme (geliştirme için)
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  console.log('Geliştirme modu: localStorage temizlenebilir');
}
