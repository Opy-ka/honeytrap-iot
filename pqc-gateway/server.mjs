import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import { ml_kem512 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';

const PORT = 3005;
const LARAVEL_URL = 'http://127.0.0.1:8000/api/honeypot/log';

if (!fs.existsSync('keys.json')) {
  console.error('ERROR: keys.json belum ada! Jalankan: node keygen.mjs');
  process.exit(1);
}

const keys = JSON.parse(fs.readFileSync('keys.json', 'utf8'));
const serverKemSk = Uint8Array.from(Buffer.from(keys.kem.secretKeyBase64, 'base64'));
const esp32DsaPk  = Uint8Array.from(Buffer.from(keys.dsa.publicKeyBase64, 'base64'));

function verifyAndDecrypt(packet) {
  const kemCt  = Buffer.from(packet.kem_ct, 'base64');
  const iv     = Buffer.from(packet.iv, 'base64');
  const aesCt  = Buffer.from(packet.aes_ct, 'base64');
  const tag    = Buffer.from(packet.tag, 'base64');
  const sig    = Buffer.from(packet.sig, 'base64');

  // 1. Gabungkan data yang ditandatangani (sama persis dengan urutan di ESP32)
  const signedData = Buffer.concat([kemCt, iv, aesCt, tag]);

  // 2. Verifikasi tanda tangan digital ML-DSA-44
  const isValid = ml_dsa44.verify(esp32DsaPk, Uint8Array.from(signedData), Uint8Array.from(sig));
  if (!isValid) {
    throw new Error('ML-DSA-44 Signature INVALID! Paket ditolak (kemungkinan spoofing/tampering).');
  }

  // 3. Dekapsulasi ML-KEM-512 untuk mendapatkan shared_secret (32 byte kunci AES-256)
  const sharedSecret = ml_kem512.decapsulate(Uint8Array.from(kemCt), serverKemSk);

  // 4. Dekripsi AES-256-GCM
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(sharedSecret), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(aesCt), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', pqc: 'ML-KEM-512 + ML-DSA-44 + AES-256-GCM' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/pqc/verify-decrypt') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const packet = JSON.parse(body);

        // Jika paket masih plaintext (misal dari tombol test Node-RED lama), tolak atau beri info
        if (!packet.kem_ct || !packet.sig || !packet.aes_ct) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Paket tidak memiliki envelope PQC (kem_ct, iv, aes_ct, tag, sig).' }));
          return;
        }

        const plaintextLog = verifyAndDecrypt(packet);
        console.log('[PQC OK] ML-DSA Verified & AES-256-GCM Decrypted:', plaintextLog);

        // Teruskan ke Laravel Backend API
        const laravelRes = await fetch(LARAVEL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(plaintextLog),
        });
        const laravelJson = await laravelRes.json();

        res.writeHead(laravelRes.status);
        res.end(JSON.stringify({
          pqc_verified: true,
          algorithms: 'ML-KEM-512 + ML-DSA-44 + AES-256-GCM',
          laravel: laravelJson
        }));
      } catch (err) {
        console.error('[PQC REJECTED]', err.message);
        res.writeHead(403);
        res.end(JSON.stringify({ success: false, pqc_verified: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`========================================================`);
  console.log(`  HoneyTrap PQC Security Gateway aktif di port ${PORT}`);
  console.log(`  Algoritma : ML-KEM-512 + ML-DSA-44 + AES-256-GCM`);
  console.log(`  Endpoint  : POST http://127.0.0.1:${PORT}/api/pqc/verify-decrypt`);
  console.log(`========================================================`);
});
