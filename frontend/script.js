// --- 1. MAPBOX TOKEN'INIZI BURAYA GİRİN ---
mapboxgl.accessToken = 'pk.eyJ1IjoiZG94YTU2IiwiYSI6ImNtYTZraDQzNjAyMG0yanF6NmgwbXN0MDUifQ.V70oJ3N2-PALS12i959MaQ'; // KENDİ TOKENINIZI GİRİN!

// --- 2. SABİTLER VE BAŞLANGIÇ NOKTASI ---
const SIIRT_PTT_LOCATION = { coords: [41.9420, 37.9275], address: "Siirt PTT Müdürlüğü (Başlangıç/Bitiş)" };
const NUM_RANDOM_LOCATIONS = 10; // PTT hariç uğranacak nokta sayısı

// Siirt Merkez Mahallelerini kabaca içeren sınırlayıcı kutu (longitude min, latitude min, longitude max, latitude max)
const SIIRT_MERKEZ_BOUNDS = [41.915, 37.920, 41.955, 37.945];

// --- 3. GLOBAL DEĞİŞKENLER ---
let map;
let markers = [];
let routeLayerIds = [];
let locationData = []; // Format: { coords: [lon, lat], address: "...", originalIndex: number }
const locationsListContainer = document.getElementById('locations-list');
const routeInfoDiv = document.getElementById('route-info');
const loadingIndicator = document.getElementById('loading-indicator');
const generateBtn = document.getElementById('generate-points-btn');
const calculateBtn = document.getElementById('calculate-route-btn');
const statusMessageDiv = document.getElementById('status-message');

// --- 4. HARİTA İLK AYARLARI ---
function initializeMap() {
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12', 
        center: SIIRT_PTT_LOCATION.coords,
        zoom: 12.8
    });
    map.addControl(new mapboxgl.NavigationControl());
}

// --- 5. SINIRLAR İÇİNDE RASTGELE NOKTA ÜRETME ---
function generateRandomPointsInBounds(count, bounds) {
    const points = [];
    const [minLon, minLat, maxLon, maxLat] = bounds;
    for (let i = 0; i < count; i++) {
        const lon = minLon + Math.random() * (maxLon - minLon);
        const lat = minLat + Math.random() * (maxLat - minLat);
        points.push([lon, lat]);
    }
    return points;
}

// --- 6. REVERSE GEOCODING (Mapbox ile Adres Bulma) ---
async function reverseGeocode(coords) {
    const [lon, lat] = coords;
    const apiUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?limit=1&language=tr&access_token=${mapboxgl.accessToken}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`Geocoding API hatası: ${response.status}`);
        const data = await response.json();
        return data.features?.[0]?.place_name || `Adres bulunamadı (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
    } catch (error) {
        console.error('Reverse Geocoding Hatası:', error);
        setStatusMessage(`Adres bulma hatası: ${error.message}`, 'error');
        return `Hata (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
    }
}

// --- 7. NOKTALARI GÖSTERME VE ADRESLERİ ALMA ---
async function displayLocationsAndGetAddresses(startLocation, randomPoints) {
    setLoading(true, "Noktalar ve adresler yükleniyor...");
    clearPreviousData();

    const startMarker = new mapboxgl.Marker({ color: '#28a745' }) 
        .setLngLat(startLocation.coords)
        .setPopup(new mapboxgl.Popup().setText(`Başlangıç: ${startLocation.address}`))
        .addTo(map);
    markers.push(startMarker);

    const tempLocationData = []; 
    let pointCounter = 1; 

    for (const coords of randomPoints) {
        const address = await reverseGeocode(coords);
        tempLocationData.push({
            coords: coords,
            address: address,
            originalIndex: pointCounter
        });

        const marker = new mapboxgl.Marker({ color: '#007bff' }) 
            .setLngLat(coords)
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(`Nokta ${pointCounter}: ${address}`))
            .addTo(map);
        markers.push(marker);
        pointCounter++;
    }
    
    locationData = [...tempLocationData]; 

    locationsListContainer.innerHTML = '<h4>Bulunan Adresler (Sırasız):</h4>';
    const unorderedList = document.createElement('ul');
    tempLocationData.forEach(loc => {
        const listItem = document.createElement('li');
        listItem.textContent = `Nokta ${loc.originalIndex}: ${loc.address}`;
        unorderedList.appendChild(listItem);
    });
    locationsListContainer.appendChild(unorderedList);

    if (locationData.length > 0) {
        calculateBtn.disabled = false;
    }
    setLoading(false);
}

function clearPreviousData() {
    locationData = [];
    locationsListContainer.innerHTML = '<h4>Uğranacak Adresler:</h4>'; 
    routeInfoDiv.innerHTML = '';
    statusMessageDiv.innerHTML = '';
    statusMessageDiv.className = 'status-message'; 
    calculateBtn.disabled = true;

    markers.forEach(marker => marker.remove());
    markers = [];
    removeRouteLayers();
}

// --- 8. KUŞ UÇUŞU MESAFE HESAPLAMA (Haversine) ---
function haversineDistance(coords1, coords2) {
    const R = 6371; 
    const dLat = (coords2[1] - coords1[1]) * Math.PI / 180;
    const dLon = (coords2[0] - coords1[0]) * Math.PI / 180;
    const lat1Rad = coords1[1] * Math.PI / 180;
    const lat2Rad = coords2[1] * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// --- 9. EN YAKIN KOMŞU ALGORİTMASI (TSP Çözümü) ---
function nearestNeighborTSP(startLocation, pointsToVisit) {
    if (!pointsToVisit || pointsToVisit.length === 0) return [startLocation, startLocation];

    let currentLocation = { ...startLocation }; 
    let orderedRoute = [currentLocation]; 
    let remainingPoints = [...pointsToVisit]; 

    while (remainingPoints.length > 0) {
        let nearestPoint = null;
        let nearestDistance = Infinity;
        let nearestIndexInRemaining = -1;

        for (let i = 0; i < remainingPoints.length; i++) {
            const distance = haversineDistance(currentLocation.coords, remainingPoints[i].coords);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestPoint = remainingPoints[i];
                nearestIndexInRemaining = i;
            }
        }

        if (nearestPoint) {
            orderedRoute.push(nearestPoint);
            currentLocation = nearestPoint;
            remainingPoints.splice(nearestIndexInRemaining, 1); 
        } else {
            break; 
        }
    }
    orderedRoute.push({ ...startLocation }); 
    return orderedRoute;
}

// --- 10. YOL AĞI ÜZERİNDEN ROTA ÇİZME VE BİLGİ HESAPLAMA (Mapbox Directions API) ---
async function drawRouteOnMapAndCalculateInfo(orderedRoute) {
    setLoading(true, "Yol ağı üzerinden rota çiziliyor ve hesaplanıyor...");
    calculateBtn.disabled = true;
    generateBtn.disabled = true;
    removeRouteLayers(); 

    let totalDuration = 0;
    let totalDistance = 0;
    const segmentPromises = [];
    const totalSegments = orderedRoute.length - 1;

    for (let i = 0; i < totalSegments; i++) {
        const startCoords = orderedRoute[i].coords;
        const endCoords = orderedRoute[i + 1].coords;
        const coordsString = `${startCoords[0]},${startCoords[1]};${endCoords[0]},${endCoords[1]}`;
        const apiUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsString}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
        
        const progress = totalSegments <= 1 ? 0.5 : i / (totalSegments - 1);
        const segmentColor = interpolateColor(0, 255, 0, 255, 0, 0, progress); 

        segmentPromises.push(
            fetch(apiUrl)
                .then(response => {
                    if (!response.ok) return response.json().then(err => Promise.reject(err)); // Hata durumunda JSON'u işle
                    return response.json();
                })
                .then(data => {
                    if (data.routes && data.routes.length > 0) {
                        const route = data.routes[0];
                        return { 
                            geometry: route.geometry, 
                            duration: route.duration, 
                            distance: route.distance, 
                            color: segmentColor, 
                            id: `route-segment-${i}` 
                        };
                    }
                    console.warn(`Segment ${i + 1} için Mapbox Directions API'den rota bulunamadı. Düz çizgi kullanılıyor.`);
                    return { 
                        geometry: { type: 'LineString', coordinates: [startCoords, endCoords] }, 
                        duration: 0, 
                        distance: haversineDistance(startCoords, endCoords) * 1000, 
                        color: segmentColor, 
                        id: `route-segment-${i}` 
                    };
                })
                .catch(error => {
                    // error objesi zaten bir Error instance olabilir veya fetch'ten gelen bir hata mesajı.
                    // Eğer error.message varsa onu kullan, yoksa genel bir mesaj.
                    const errorMessage = error.message || (typeof error === 'string' ? error : 'Bilinmeyen bir segment hatası');
                    console.error(`Rota segmenti ${i + 1} alınamadı:`, errorMessage);
                    setStatusMessage(`Rota segmenti ${i+1} alınamadı: ${errorMessage}`, 'error');
                    return { 
                        geometry: { type: 'LineString', coordinates: [startCoords, endCoords] }, 
                        duration: 0, 
                        distance: haversineDistance(startCoords, endCoords) * 1000, 
                        color: segmentColor, 
                        id: `route-segment-${i}` 
                    };
                })
        );
    }

    const segmentResults = await Promise.all(segmentPromises);
    
    segmentResults.forEach(result => {
        if (result) {
            totalDuration += result.duration;
            totalDistance += result.distance;
            drawRouteSegmentOnMap(result.geometry, result.id, result.color);
        }
    });

    const durationMinutes = (totalDuration / 60).toFixed(1);
    const distanceKm = (totalDistance / 1000).toFixed(1);
    routeInfoDiv.innerHTML = `Hesaplanan Rota: Yaklaşık <strong>${durationMinutes} dakika</strong>, <strong>${distanceKm} km</strong>`;

    displayOrderedRouteListInSidebar(orderedRoute); 
    
    setLoading(false);
    calculateBtn.disabled = false;
    generateBtn.disabled = false;

    return orderedRoute; 
}

function interpolateColor(r1, g1, b1, r2, g2, b2, progress) {
    const r = Math.round(r1 + (r2 - r1) * progress);
    const g = Math.round(g1 + (g2 - g1) * progress);
    const b = Math.round(b1 + (b2 - b1) * progress);
    const toHex = (c) => c.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function drawRouteSegmentOnMap(geometry, layerId, lineColor) {
    routeLayerIds.push(layerId); 
    if (map.getSource(layerId)) { 
        map.getSource(layerId).setData(geometry);
        if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'line-color', lineColor);
    } else { 
        map.addSource(layerId, { 'type': 'geojson', 'data': geometry });
        map.addLayer({
            'id': layerId,
            'type': 'line',
            'source': layerId,
            'layout': { 'line-join': 'round', 'line-cap': 'round' },
            'paint': { 'line-color': lineColor, 'line-width': 5, 'line-opacity': 0.85 }
        }, 
        map.getStyle().layers.find(layer => layer.type === 'symbol' && layer.layout && layer.layout['text-field'])?.id || undefined
        );
    }
}

function removeRouteLayers() {
    routeLayerIds.forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
    });
    routeLayerIds = [];
}

function displayOrderedRouteListInSidebar(orderedRoute) {
    locationsListContainer.innerHTML = '<h4>Optimize Edilmiş Rota Sırası:</h4>';
    const orderedListElement = document.createElement('ol');

    orderedRoute.forEach((location, index) => {
        const listItem = document.createElement('li');
        let label = "";
        let originalIndexInfo = "";

        if (location.originalIndex !== undefined) {
            originalIndexInfo = ` (Asıl Nokta No: ${location.originalIndex})`;
        }

        if (index === 0) {
            label = "Başlangıç: ";
        } else if (index === orderedRoute.length - 1) {
            label = `Bitiş (${index}): `;
        } else {
            label = `${index}. Durak${originalIndexInfo}: `;
        }
        listItem.textContent = `${label}${location.address}`;
        orderedListElement.appendChild(listItem);
    });
    locationsListContainer.appendChild(orderedListElement);
}

function setLoading(isLoading, message = "İşlem yapılıyor...") {
    loadingIndicator.textContent = message;
    loadingIndicator.style.display = isLoading ? 'block' : 'none';
}

function setStatusMessage(message, type = 'info') { 
    statusMessageDiv.textContent = message;
    statusMessageDiv.className = `status-message ${type}`; 
    statusMessageDiv.style.display = 'block';
}

// --- 14. Rotayı Backend'e Kaydetme (Geliştirilmiş Hata Yönetimi) ---
async function saveRouteToBackend(orderedRouteData) {
    setLoading(true, "Optimize edilmiş rota sunucuya kaydediliyor...");
    const backendUrl = 'http://localhost:3000/api/routes'; 
    let response; // Yanıtı dış kapsamda tanımla

    try {
        response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({ orderedRoute: orderedRouteData }),
        });

        let resultJson = null;
        // Yanıt gövdesini okumaya çalış (başarısız olsa bile JSON olabilir)
        try {
            resultJson = await response.json();
        } catch (jsonError) {
            console.warn("Sunucudan gelen yanıt JSON formatında değil veya parse edilemedi:", jsonError);
            // Eğer yanıt başarılı değilse (örn: 500) ve JSON parse edilemediyse,
            // response.statusText kullanarak bir hata fırlat.
            if (!response.ok) {
                throw new Error(`Sunucu hatası: ${response.status} - ${response.statusText || 'Yanıt gövdesi okunamadı'}`);
            }
            // Eğer yanıt başarılı (örn: 201) ama JSON parse edilemediyse (server.js'de bir sorun olabilir),
            // bu durumu da belirt.
            if (response.ok) {
                 throw new Error("Sunucudan başarılı yanıt alındı ancak JSON gövdesi parse edilemedi. Lütfen server.js'i kontrol edin.");
            }
        }

        // response.ok (HTTP durum kodu 200-299 arasındaysa true döner)
        if (!response.ok) {
            // resultJson.message varsa onu kullan, yoksa genel bir hata mesajı oluştur.
            const errorMessage = resultJson?.message || `Sunucu ile iletişimde bilinmeyen bir hata: ${response.status} - ${response.statusText || 'Detay yok'}`;
            throw new Error(errorMessage);
        }
        
        // Bu noktada response.ok === true ve resultJson (server.js'den gelen yanıt) geçerli olmalı
        console.log('Rota başarıyla backend\'e kaydedildi:', resultJson);
        setStatusMessage(`Rota sunucuya başarıyla kaydedildi (Oturum ID: ${resultJson.sessionId}). Python otomasyonu tetiklendi.`, 'success');

    } catch (error) { 
        // Bu blok fetch network hatasını, yukarıdaki explicit throw new Error() çağrılarını
        // veya response.json() içindeki parse hatasını (eğer yukarıda yakalanmadıysa) yakalar.
        console.error('Rota backend\'e kaydedilemedi (catch bloğu):', error);
        
        let displayErrorMessage = `Hata: Rota sunucuya kaydedilemedi. (${error.message})`;
        
        // Eğer error.message zaten status kodunu içermiyorsa ve response objemiz varsa, ekleyelim.
        if (response && response.status && error.message && !error.message.includes(String(response.status))) {
            displayErrorMessage += ` (Sunucu Yanıtı: ${response.status})`;
        }
        
        setStatusMessage(displayErrorMessage, 'error');
    } finally {
        setLoading(false);
    }
}

// --- 15. OLAY DİNLEYİCİLERİ VE BAŞLATMA ---
generateBtn.addEventListener('click', () => {
    clearPreviousData(); 
    const randomPoints = generateRandomPointsInBounds(NUM_RANDOM_LOCATIONS, SIIRT_MERKEZ_BOUNDS);
    displayLocationsAndGetAddresses(SIIRT_PTT_LOCATION, randomPoints);
});

calculateBtn.addEventListener('click', async () => {
    if (locationData.length === 0 && NUM_RANDOM_LOCATIONS > 0) {
        setStatusMessage("Önce 'Rastgele Noktaları Göster' butonuna tıklayarak noktaları üretmelisiniz.", 'error');
        return;
    }
    
    const tspOptimizedRoute = nearestNeighborTSP(SIIRT_PTT_LOCATION, locationData);
    
    if (tspOptimizedRoute && tspOptimizedRoute.length > 1) { 
        const finalRouteForMapbox = await drawRouteOnMapAndCalculateInfo(tspOptimizedRoute);
        if (finalRouteForMapbox) {
            await saveRouteToBackend(finalRouteForMapbox); 
        }
    } else {
        setStatusMessage("Rota hesaplanamadı. Yeterli nokta bulunmuyor.", 'error');
    }
});

initializeMap();
setStatusMessage("Başlamak için 'Rastgele Noktaları Göster' butonuna tıklayın.", "info");