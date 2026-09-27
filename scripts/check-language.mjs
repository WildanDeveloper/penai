import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Guard against Indonesian leaking into the source tree.
 *
 * Comments, identifiers and user-facing strings are all English by design. This
 * walks the repository looking for words that are Indonesian and not English,
 * so a slip is caught in CI rather than in review.
 *
 *   node scripts/check-language.mjs
 */

const INDONESIAN = [
  'ada', 'adalah', 'agar', 'akan', 'antara', 'apa', 'atau', 'bagaimana', 'bagi',
  'bahwa', 'banyak', 'beberapa', 'belum', 'berada', 'berikut', 'bersama', 'bila',
  'bisa', 'boleh', 'buat', 'bukan', 'cukup', 'dalam', 'dan', 'dapat', 'dari',
  'dengan', 'di', 'dll', 'dua', 'guna', 'hal', 'hanya', 'harus', 'hingga',
  'ini', 'itu', 'jadi', 'jangan', 'jika', 'juga', 'kalau', 'kamu', 'karena',
  'kata', 'kita', 'lagi', 'lain', 'lebih', 'maka', 'masih', 'mau', 'melakukan',
  'memang', 'mempunyai', 'menjadi', 'mereka', 'meski', 'mungkin', 'namun',
  'nanti', 'oleh', 'pada', 'paling', 'pernah', 'pertama', 'pihak', 'pula',
  'pun', 'punya', 'saat', 'saja', 'sama', 'sampai', 'sangat', 'satu', 'saya',
  'sebagai', 'sebuah', 'secara', 'sedang', 'sehingga', 'sejak', 'sekali',
  'sekarang', 'selain', 'seluruh', 'semua', 'sendiri', 'seorang', 'seperti',
  'serta', 'sesuatu', 'setelah', 'setiap', 'siapa', 'suatu', 'sudah', 'supaya',
  'tadi', 'tanpa', 'tapi', 'telah', 'tentang', 'terhadap', 'terjadi',
  'tersebut', 'tetapi', 'tiap', 'tidak', 'untuk', 'waktu', 'yaitu', 'yang',
  'perubahan', 'diperbaiki', 'ditambahkan', 'dihapus', 'dibuang', 'ditulis',
  'dibaca', 'dipisah', 'dipindahkan', 'terdapat', 'beserta', 'dipakai',
];

const ID = new Set(INDONESIAN);
const ROOTS = ['model', 'scope', 'policy', 'tools', 'ai', 'report', 'tui', 'cli', 'internal', 'cmd', 'test', 'scripts', 'src'];
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js', '.md', '.json', '.example']);
const SKIP = new Set(['node_modules', 'dist', '.git', '.cache']);
// This file necessarily contains the word list it searches for.
const SELF = 'scripts/check-language.mjs';

const hits = [];

function walk(dir, depth = 0) {
  if (depth > 2) return;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walk(full, depth + 1);
    else if ((EXTS.has(extname(entry)) || entry === '.env.example') && full !== SELF) {
      readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const word of line.toLowerCase().match(/[a-z]+/g) ?? []) {
            if (ID.has(word)) {
              hits.push({ file: full, line: i + 1, word, text: line.trim().slice(0, 110) });
              break;
            }
          }
        });
    }
  }
}

for (const root of ROOTS) walk(root);
for (const file of ['README.md', 'package.json', '.env.example', 'LICENSE']) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const word of line.toLowerCase().match(/[a-z]+/g) ?? []) {
      if (ID.has(word)) {
        hits.push({ file, line: i + 1, word, text: line.trim().slice(0, 110) });
        break;
      }
    }
  });
}

if (hits.length === 0) {
  process.stdout.write('language check: clean\n');
  process.exit(0);
}
process.stdout.write(`${hits.length} line(s) contain Indonesian:\n`);
for (const hit of hits) process.stdout.write(`  ${hit.file}:${hit.line} [${hit.word}] ${hit.text}\n`);
process.exit(1);
