const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

const dbPath = path.resolve(__dirname, 'siirt_routes.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Veritabanı bağlantı hatası:', err.message);
    } else {
        console.log('SQLite veritabanına (siirt_routes.db) başarıyla bağlanıldı.');
        initializeDb();
    }
});

function initializeDb() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS routes_sessions (
                session_id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW', 'localtime'))
            )
        `, (err) => {
            if (err) console.error("Tablo oluşturma hatası (routes_sessions):", err.message);
            else console.log("'routes_sessions' tablosu hazır.");
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS route_points (
                point_id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                order_index INTEGER,
                longitude REAL,
                latitude REAL,
                address TEXT,
                original_random_index INTEGER,
                FOREIGN KEY (session_id) REFERENCES routes_sessions (session_id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) console.error("Tablo oluşturma hatası (route_points):", err.message);
            else console.log("'route_points' tablosu hazır.");
        });
    });
}

app.post('/api/routes', (req, res) => {
    const orderedRoute = req.body.orderedRoute;

    if (!orderedRoute || !Array.isArray(orderedRoute)) { // Sıfır uzunlukta dizi geçerli olabilir
        return res.status(400).json({ message: 'Geçersiz rota verisi. "orderedRoute" dizisi bekleniyor.' });
    }

    db.run('INSERT INTO routes_sessions DEFAULT VALUES', function(sessionInsertErr) {
        if (sessionInsertErr) {
            console.error('Rota oturumu oluşturma hatası DETAYLARI:', sessionInsertErr);
            return res.status(500).json({ message: 'Sunucu hatası: Rota oturumu kaydedilemedi.', error: sessionInsertErr.message });
        }

        const sessionId = this.lastID;
        const stmt = db.prepare('INSERT INTO route_points (session_id, order_index, longitude, latitude, address, original_random_index) VALUES (?, ?, ?, ?, ?, ?)');

        let pointsSavedCount = 0;
        let errorsOccurred = false;
        let operationsToComplete = orderedRoute.length;
        let operationsCompleted = 0;

        // Eğer hiç nokta yoksa (orderedRoute boş dizi ise), doğrudan commit/finalize adımına geç
        if (operationsToComplete === 0) {
            // db.serialize içine alarak transaction bütünlüğünü koru
            db.serialize(() => {
                db.run("BEGIN TRANSACTION", (beginTransactionErr) => {
                    if (beginTransactionErr) {
                        console.error("BEGIN TRANSACTION hatası (boş rota):", beginTransactionErr);
                        // stmt hiç kullanılmadığı için finalize'a gerek yok gibi ama emin olmak için çağrılabilir.
                        // Ya da doğrudan hata döndür.
                        return res.status(500).json({ message: 'Veritabanı işlemi başlatılamadı (boş rota).', error: beginTransactionErr.message });
                    }
                    finalizeAndCommitOrRollback(); // Boş rota için de transaction gerekebilir
                });
            });
            return; // forEach'e girmemesi için
        }

        // db.serialize tüm transaction'ı sarmalıdır
        db.serialize(() => {
            db.run("BEGIN TRANSACTION", (beginTransactionErr) => {
                if (beginTransactionErr) {
                    console.error("BEGIN TRANSACTION hatası:", beginTransactionErr);
                    errorsOccurred = true; // Transaction başlatılamadıysa
                    // stmt.finalize burada çağrılmalı mı? Belki de gerek yok çünkü stmt hiç kullanılmadı.
                    // Bu durumda, finalizeAndCommitOrRollback'i çağırmak yerine doğrudan hata döndürmek daha iyi olabilir.
                    // Ancak mevcut yapıda, finalizeAndCommitOrRollback errorsOccurred'ı kontrol edecek.
                    // Yine de, transaction başlamazsa commit/rollback anlamsız olur.
                    // Erken çıkış daha mantıklı:
                    return res.status(500).json({ message: 'Veritabanı işlemi başlatılamadı.', error: beginTransactionErr.message });
                }

                orderedRoute.forEach((point, index) => {
                    // Eğer bir önceki adımda zaten hata olduysa veya transaction başlamadıysa devam etme
                    if (errorsOccurred) {
                        // Bu durumda, forEach'ten çıkmak ve rollback yapmak en iyisi.
                        // Ancak forEach'i kırmak doğrudan mümkün değil.
                        // errorsOccurred bayrağı sonraki adımları kontrol edecek.
                        // Belki de tüm insert'leri atlayıp doğrudan finalize'a gitmek için operationsCompleted'ı artırabiliriz.
                        // Şimdilik, stmt.run'a girmemesini sağlayalım.
                        return;
                    }

                    if (!point.coords || point.coords.length !== 2) {
                        console.warn(`Atlanıyor: Nokta ${index} geçersiz koordinatlara sahip.`);
                        operationsCompleted++; // İşlenmiş (atlanmış) say
                        if (operationsCompleted === operationsToComplete) {
                            finalizeAndCommitOrRollback();
                        }
                        return;
                    }
                    const lon = point.coords[0];
                    const lat = point.coords[1];
                    const address = point.address || `Koordinat: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
                    const originalIndex = point.originalIndex !== undefined ? point.originalIndex : null;

                    stmt.run(sessionId, index, lon, lat, address, originalIndex, (runErr) => {
                        if (runErr) {
                            console.error(`Rota noktası kaydetme hatası (index ${index}, session ${sessionId}) DETAYLARI:`, runErr);
                            errorsOccurred = true;
                        } else {
                            pointsSavedCount++;
                        }
                        operationsCompleted++;
                        if (operationsCompleted === operationsToComplete) {
                            finalizeAndCommitOrRollback();
                        }
                    });
                });
            }); // BEGIN TRANSACTION callback sonu
        }); // db.serialize sonu

        function finalizeAndCommitOrRollback() {
            stmt.finalize((finalizeErr) => {
                if (finalizeErr) {
                    console.error("Statement finalize hatası DETAYLARI:", finalizeErr);
                    errorsOccurred = true; // Finalize hatası da transaction'ı etkiler
                }

                // Hata oluştuysa (ister nokta kaydında, ister finalize'da)
                if (errorsOccurred) {
                    db.run("ROLLBACK", (rollbackErr) => {
                        if (rollbackErr) console.error("Rollback hatası DETAYLARI:", rollbackErr);
                        // Hatanın kaynağını daha iyi belirt
                        const specificErrorMessage = finalizeErr ? finalizeErr.message : (sessionInsertErr ? sessionInsertErr.message : 'Bilinmeyen veritabanı hatası (muhtemelen nokta kaydında veya session oluşturmada)');
                        return res.status(500).json({ message: `Rota kaydedilemedi. Veritabanı işlemi sırasında hata oluştu (${specificErrorMessage}). İşlem geri alındı.` });
                    });
                } else if (pointsSavedCount > 0 || orderedRoute.length === 0) {
                    // Başarılı: en az bir nokta kaydedildi VEYA hiç nokta gönderilmedi (boş rota)
                    db.run("COMMIT", (commitErr) => {
                        if (commitErr) {
                            console.error("Commit hatası DETAYLARI:", commitErr);
                            // Commit hatası durumunda da rollback denenebilir ama genellikle transaction zaten bitmiştir.
                            return res.status(500).json({ message: `Rota kaydedilemedi. Veritabanı commit hatası. SQLite Error: ${commitErr.message}` });
                        }

                        console.log('Rota başarıyla veritabanına kaydedildi. Playwright otomasyonu tetikleniyor...');
                        const pythonScriptPath = path.join(__dirname, '..', 'automation', 'Maps_automator.py');
                        const pythonCommand = 'python'; // veya 'python3'

                        const pythonProcess = spawn(pythonCommand, [pythonScriptPath]);

                        pythonProcess.stdout.on('data', (data) => {
                            console.log(`[Playwright Otomasyonu - Çıktı]: ${data.toString()}`);
                        });
                        pythonProcess.stderr.on('data', (data) => {
                            console.error(`[Playwright Otomasyonu - Hata]: ${data.toString()}`);
                        });
                        pythonProcess.on('close', (code) => {
                            console.log(`Playwright otomasyon betiği ${code} kodu ile sonlandı.`);
                            if (code !== 0) {
                                console.error(`Playwright betiği bir hata ile sonlandı (kod: ${code}). Daha fazla bilgi için yukarıdaki Hata loglarına bakın.`);
                            }
                        });
                        pythonProcess.on('error', (err) => {
                            console.error('Playwright otomasyon betiğini başlatırken bir hata oluştu:', err);
                        });

                        return res.status(201).json({
                            message: 'Rota başarıyla kaydedildi ve otomasyon tetiklendi.',
                            sessionId: sessionId,
                            pointsSaved: pointsSavedCount,
                            totalPointsInRoute: orderedRoute.length
                        });
                    });
                } else {
                    // Hiç nokta kaydedilmedi (ve orderedRoute boş değildi, yani tüm noktalarda hata oldu)
                    db.run("ROLLBACK", (rollbackErr) => {
                        if (rollbackErr) console.error("Rollback hatası (hiç nokta kaydedilmedi):", rollbackErr);
                        return res.status(400).json({ message: `Hiçbir geçerli rota noktası kaydedilemedi.` });
                    });
                }
            }); // stmt.finalize sonu
        } // finalizeAndCommitOrRollback fonksiyon sonu
    }); // db.run INSERT INTO routes_sessions sonu
});

app.get('/api/routes/latest', (req, res) => {
    db.get('SELECT session_id, timestamp FROM routes_sessions ORDER BY timestamp DESC LIMIT 1', (err, sessionRow) => {
        if (err) {
            console.error('En son rota oturumu alınamadı:', err.message);
            return res.status(500).json({ message: 'Sunucu hatası (oturum alınamadı).' });
        }
        if (!sessionRow) {
            return res.status(404).json({ message: 'Kaydedilmiş rota bulunamadı.' });
        }

        const latestSessionId = sessionRow.session_id;
        db.all('SELECT longitude, latitude, address, order_index, original_random_index FROM route_points WHERE session_id = ? ORDER BY order_index ASC', [latestSessionId], (errPoints, points) => {
            if (errPoints) {
                console.error('Rota noktaları alınamadı:', errPoints.message);
                return res.status(500).json({ message: 'Sunucu hatası (noktalar alınamadı).' });
            }

            const formattedPoints = points.map(p => ({
                coords: [p.longitude, p.latitude],
                address: p.address,
                orderIndex: p.order_index,
                originalRandomIndex: p.original_random_index
            }));
            res.status(200).json({
                sessionId: latestSessionId,
                timestamp: sessionRow.timestamp,
                route: formattedPoints
            });
        });
    });
});

app.listen(port, () => {
    console.log(`Backend sunucusu http://localhost:${port} adresinde çalışıyor`);
    console.log(`Frontend http://localhost:${port} adresinden sunuluyor olmalı.`);
});