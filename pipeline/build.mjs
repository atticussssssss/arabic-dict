#!/usr/bin/env node
/**
 * 词典数据管线:kaikki (en.wiktionary) 阿拉伯语抽取 + CC-CEDICT 中文桥接
 *
 * 输入:
 *   data/raw/kaikki-arabic.jsonl.gz
 *   data/raw/cedict.txt.gz
 * 输出 (app/public/dict/):
 *   index.json          搜索索引(全部词条的紧凑记录)
 *   chunks/{n}.json     词条详情分片(按 id / CHUNK_SIZE)
 *   forms/{letter}.json 变化形 → 词条id 索引,按归一化首字母分片
 *   meta.json           统计信息
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'app/public/dict');
const CHUNK_SIZE = 400;

// ---------- 阿拉伯文归一化(用于搜索匹配) ----------
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/g;
export function normalizeAr(s) {
  return s
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}
const AR_LETTER = /[؀-ۿ]/;

// ---------- 0. jieba 词频表:用于给中文候选排序 ----------
function loadZhFreq() {
  const freq = new Map();
  const text = fs.readFileSync(path.join(RAW, 'jieba-dict.txt'), 'utf8');
  for (const line of text.split('\n')) {
    const [w, n] = line.split(' ');
    if (w && n) freq.set(w, parseInt(n, 10) || 0);
  }
  console.log(`jieba 词频表: ${freq.size} 个词`);
  return freq;
}

// ---------- 1. CC-CEDICT:构建 英文释义 → 中文 反向索引 ----------
function buildEnToZh() {
  const gz = fs.readFileSync(path.join(RAW, 'cedict.txt.gz'));
  const text = zlib.gunzipSync(gz).toString('utf8');
  const map = new Map(); // en (lowercase) -> Set<zh simplified>
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+) (\S+) \[[^\]]*\] \/(.+)\/$/);
    if (!m) continue;
    const simp = m[2];
    if (simp.length > 4) continue; // 过长的词组噪音大
    for (let def of m[3].split('/')) {
      def = def
        .replace(/\([^)]*\)/g, '') // 去括号注释
        .replace(/\[[^\]]*\]/g, '')
        .trim()
        .toLowerCase();
      if (!def || def.length > 40) continue;
      if (/[A-Z]/.test(def[0]) && simp.length <= 1) continue;
      if (def.includes('cl:') || def.startsWith('see ') || def.startsWith('variant of') || def.startsWith('old variant') || def.startsWith('used ')) continue;
      // 主词形式:去掉 "to " 前缀方便动词匹配
      const keys = new Set([def]);
      if (def.startsWith('to ')) keys.add(def.slice(3));
      if (def.startsWith('the ')) keys.add(def.slice(4));
      for (const k of keys) {
        if (!map.has(k)) map.set(k, new Map());
        const counter = map.get(k);
        counter.set(simp, (counter.get(simp) || 0) + 1);
      }
    }
  }
  console.log(`CEDICT 反向索引: ${map.size} 个英文键`);
  return map;
}

// 从英文 gloss 找中文候选
function zhForGloss(enToZh, zhFreq, gloss) {
  let g = gloss
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[.;:!?]+$/, '');
  if (!g) return [];
  const results = new Map(); // zh -> score
  const tryKey = (k, weight) => {
    const counter = enToZh.get(k);
    if (!counter) return;
    for (const [zh, n] of counter) {
      // 匹配权重 × 真实词频(jieba),词频表查无此词的强降权
      const f = zhFreq.get(zh) || 0;
      let score = weight * (Math.log1p(f) + n * 0.3 - (f === 0 ? 6 : 0));
      results.set(zh, Math.max(results.get(zh) || 0, score));
    }
  };
  tryKey(g, 3);
  if (g.startsWith('to ')) tryKey(g.slice(3), 3);
  // 逗号/分号/or 分隔的子释义
  for (const part of g.split(/[,;]| or /)) {
    const p = part.trim().replace(/^to /, '');
    if (p && p !== g && p.length > 1) tryKey(p, 2);
  }
  return [...results.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([zh]) => zh);
}

// ---------- 2. 流式解析 kaikki JSONL ----------
const LEMMA_POS = new Set([
  'noun', 'verb', 'adj', 'adv', 'pron', 'prep', 'conj', 'particle',
  'interj', 'num', 'det', 'phrase', 'prep_phrase', 'proper-noun', 'name', 'root',
]);

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'chunks'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'forms'), { recursive: true });

  const enToZh = buildEnToZh();
  const zhFreq = loadZhFreq();

  const lemmas = []; // 详情记录
  const formIndex = new Map(); // normForm -> Set<lemmaKey>  (lemmaKey = word|pos)
  const formOfEdges = []; // [inflectedPageTitle, targetWord]
  let total = 0, skippedLang = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(RAW, 'kaikki-arabic.jsonl.gz')).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    total++;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.lang_code !== 'ar') { skippedLang++; continue; }
    if (!e.word || !AR_LETTER.test(e.word)) continue;

    const senses = e.senses || [];
    const formOf = senses.flatMap((s) => s.form_of || s.alt_of || []);
    const isFormEntry = formOf.length > 0 && senses.every((s) => (s.form_of || s.alt_of || (s.tags || []).includes('form-of')));

    if (isFormEntry) {
      for (const t of formOf) {
        if (t.word) formOfEdges.push([e.word, t.word.replace(/[ً-ْٰ]/g, '')]);
      }
      continue;
    }
    if (!LEMMA_POS.has(e.pos)) continue;

    // 提取释义
    const senseOut = [];
    for (const s of senses) {
      const glosses = s.glosses || [];
      if (!glosses.length) continue;
      const gloss = glosses[glosses.length - 1];
      if (/form of|inflection of/.test(gloss)) continue;
      const zh = zhForGloss(enToZh, zhFreq, gloss);
      const ex = (s.examples || [])
        .filter((x) => x.text)
        .slice(0, 2)
        .map((x) => ({ ar: x.text, en: x.english || '', roman: x.roman || '' }));
      senseOut.push({
        gloss,
        zh,
        tags: (s.tags || []).filter((t) => !['no-gloss'].includes(t)).slice(0, 4),
        ex,
      });
    }
    if (!senseOut.length) continue;

    // 规范形(带元音)与罗马音
    let voc = '', roman = '';
    const formsOut = [];
    for (const f of e.forms || []) {
      if (!f.form || f.form === '-') continue;
      const tags = f.tags || [];
      if (tags.includes('canonical')) { if (!voc) voc = f.form; continue; }
      if (tags.includes('romanization')) { if (!roman) roman = f.form; continue; }
      if (tags.includes('table-tags') || tags.includes('inflection-template') || tags.includes('class')) continue;
      if (!AR_LETTER.test(f.form)) continue;
      formsOut.push({ f: f.form, r: f.roman || '', t: tags.filter((t) => t !== 'informal' && t !== 'invariable').slice(0, 6) });
    }
    // 去重(同一个形 + 同一组标签只保留一条)
    const seenForms = new Set();
    for (let i = formsOut.length - 1; i >= 0; i--) {
      const key = formsOut[i].f + '|' + formsOut[i].t.join(',');
      if (seenForms.has(key)) formsOut.splice(i, 1);
      else seenForms.add(key);
    }

    // 词根:etymology_templates 里的 ar-root / 分类名
    let root = '';
    for (const t of e.etymology_templates || []) {
      if (t.name === 'ar-root' || (t.name === 'root' && t.args && t.args['1'] === 'ar')) {
        const args = t.args || {};
        const letters = [];
        for (const k of ['1', '2', '3', '4', '5']) {
          const v = args[k];
          if (v && v !== 'ar' && AR_LETTER.test(v)) letters.push(v);
        }
        if (letters.length >= 2) { root = letters.join(' '); break; }
      }
    }
    if (!root) {
      for (const s of senses) {
        for (const c of s.categories || []) {
          const m = (c.name || '').match(/belonging to the root (.+)$/);
          if (m) { root = m[1].trim(); break; }
        }
        if (root) break;
      }
    }

    // 动词形式 (Form I-X)
    let verbForm = '';
    for (const h of e.head_templates || []) {
      if (h.name === 'ar-verb' && h.args && h.args['1']) {
        const m1 = String(h.args['1']).match(/^([IVX]+q?)(?![A-Za-z])/);
        if (m1) { verbForm = m1[1].toUpperCase(); break; }
      }
      const m = (h.expansion || '').match(/\bform ([IVX]+q?)\b/);
      if (m) { verbForm = m[1]; break; }
    }

    lemmas.push({
      word: e.word,
      voc: voc || e.word,
      roman,
      pos: e.pos,
      root,
      vform: verbForm,
      senses: senseOut,
      forms: formsOut,
    });
  }

  console.log(`总行数 ${total},非阿语跳过 ${skippedLang},词条 ${lemmas.length},form-of 边 ${formOfEdges.length}`);

  // ---------- 3. 编号、建索引 ----------
  lemmas.sort((a, b) => a.word.localeCompare(b.word, 'ar'));
  const byWord = new Map(); // normWord -> ids
  lemmas.forEach((l, i) => {
    l.id = i;
    const n = normalizeAr(l.word);
    if (!byWord.has(n)) byWord.set(n, []);
    byWord.get(n).push(i);
  });

  const addForm = (formStr, id) => {
    const n = normalizeAr(formStr);
    if (!n || n.length < 2) return;
    if (!formIndex.has(n)) formIndex.set(n, new Set());
    formIndex.get(n).add(id);
  };
  // 词形变化表内的每个形
  for (const l of lemmas) {
    addForm(l.word, l.id);
    for (const f of l.forms) addForm(f.f, l.id);
  }
  // form-of 词条页
  let edgeHits = 0;
  for (const [inflected, target] of formOfEdges) {
    const ids = byWord.get(normalizeAr(target));
    if (!ids) continue;
    for (const id of ids) addForm(inflected, id);
    edgeHits++;
  }
  console.log(`form 索引键 ${formIndex.size}(form-of 命中 ${edgeHits}/${formOfEdges.length})`);

  // ---------- 4. 输出 ----------
  // 搜索索引:紧凑数组 [word, voc, roman, pos, root, vform, zhShort, enShort]
  const index = lemmas.map((l) => {
    const zh = [...new Set(l.senses.flatMap((s) => s.zh))].slice(0, 4).join(';');
    const en = l.senses.map((s) => s.gloss).slice(0, 2).join('; ').slice(0, 80);
    return [l.word, l.voc, l.roman, l.pos, l.root, l.vform, zh, en];
  });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));

  // 详情分片:词形标签用全局字典编码以压缩体积
  const tagList = [];
  const tagIdx = new Map();
  const encodeTags = (tags) =>
    tags.map((t) => {
      if (!tagIdx.has(t)) {
        tagIdx.set(t, tagList.length);
        tagList.push(t);
      }
      return tagIdx.get(t);
    });
  for (let c = 0; c * CHUNK_SIZE < lemmas.length; c++) {
    const slice = lemmas.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE).map((l) => ({
      id: l.id, word: l.word, voc: l.voc, roman: l.roman, pos: l.pos,
      root: l.root, vform: l.vform, senses: l.senses,
      forms: l.forms.map((f) => [f.f, f.r, encodeTags(f.t)]),
    }));
    fs.writeFileSync(path.join(OUT, 'chunks', `${c}.json`), JSON.stringify(slice));
  }

  // form 索引分片(按归一化首字母)
  const shards = new Map();
  for (const [form, ids] of formIndex) {
    const letter = form[0];
    if (!shards.has(letter)) shards.set(letter, {});
    shards.get(letter)[form] = [...ids];
  }
  for (const [letter, obj] of shards) {
    fs.writeFileSync(path.join(OUT, 'forms', `${letter.codePointAt(0).toString(16)}.json`), JSON.stringify(obj));
  }

  const withZh = index.filter((r) => r[6]).length;
  const withRoot = index.filter((r) => r[4]).length;
  const meta = {
    built: new Date().toISOString(),
    lemmas: lemmas.length,
    chunkSize: CHUNK_SIZE,
    withZh, withRoot,
    formKeys: formIndex.size,
    formShards: [...shards.keys()].map((l) => l.codePointAt(0).toString(16)),
    tagList,
  };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log('完成:', meta);

  // 输出大小统计
  const du = (p) => {
    let sum = 0;
    for (const f of fs.readdirSync(p)) {
      const st = fs.statSync(path.join(p, f));
      sum += st.isDirectory() ? 0 : st.size;
    }
    return (sum / 1024 / 1024).toFixed(1) + 'MB';
  };
  console.log(`index.json: ${(fs.statSync(path.join(OUT, 'index.json')).size / 1024 / 1024).toFixed(1)}MB, chunks: ${du(path.join(OUT, 'chunks'))}, forms: ${du(path.join(OUT, 'forms'))}`);
}

main();
