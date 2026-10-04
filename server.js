import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ===================== SECURITY: BLOCK SENSITIVE FILES =====================
// Anything matching these patterns returns 404 before static middleware runs.
const BLOCKED_PATTERNS = [
  /^\/server\.js$/,
  /^\/package(-lock)?\.json$/,
  /^\/\.env(\.|$)/,           // .env, .env.local, .env.example, etc.
  /^\/\.nojekyll$/,
  /^\/metadata\.json$/,
  /^\/README\.md$/i,
  /^\/node_modules(\/|$)/,
  /^\/\.git(\/|$)/,
  /^\/\.github(\/|$)/
];

app.use((req, res, next) => {
  if (BLOCKED_PATTERNS.some(rx => rx.test(req.path))) {
    return res.status(404).send('Not found');
  }
  next();
});

// ===================== STATIC ASSETS =====================
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  }
}));

// ===================== SPA FALLBACK =====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Studyquantifier running at http://0.0.0.0:${PORT}`);
});