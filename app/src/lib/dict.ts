// 词典数据加载与搜索

export interface IndexRow {
  id: number;
  word: string; // 页面标题(通常不带元音)
  voc: string; // 带元音写法
  roman: string;
  pos: string;
  root: string;
  vform: string;
  zh: string; // 简短中文释义 (; 分隔)
  en: string; // 简短英文释义
}

export interface Sense {
  gloss: string;
  zh: string[];
  tags: string[];
  ex: { ar: string; en: string; roman: string }[];
}

export interface Entry {
  id: number;
  word: string;
  voc: string;
  roman: string;
  pos: string;
  root: string;
  vform: string;
  senses: Sense[];
  forms: { f: string; r: string; t: string[] }[];
}

export interface Meta {
  lemmas: number;
  chunkSize: number;
  withZh: number;
  withRoot: number;
  formShards: string[];
  tagList: string[];
}

const BASE = import.meta.env.BASE_URL + 'dict';

// ---------- 阿拉伯文归一化(与管线保持一致) ----------
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/g;
export function normalizeAr(s: string): string {
  return s
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}
export const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
export const hasCJK = (s: string) => /[一-鿿]/.test(s);

// ---------- 数据加载 ----------
let indexRows: IndexRow[] | null = null;
let meta: Meta | null = null;
let normCache: string[] | null = null;
const chunkCache = new Map<number, Entry[]>();
const formShardCache = new Map<string, Record<string, number[]>>();

export async function loadIndex(): Promise<{ rows: IndexRow[]; meta: Meta }> {
  if (indexRows && meta) return { rows: indexRows, meta };
  const [idxRes, metaRes] = await Promise.all([
    fetch(`${BASE}/index.json`),
    fetch(`${BASE}/meta.json`),
  ]);
  if (!idxRes.ok || !metaRes.ok) throw new Error('词典数据加载失败,请先运行数据管线');
  const raw: [string, string, string, string, string, string, string, string][] = await idxRes.json();
  meta = await metaRes.json();
  indexRows = raw.map((r, i) => ({
    id: i, word: r[0], voc: r[1], roman: r[2], pos: r[3], root: r[4], vform: r[5], zh: r[6], en: r[7],
  }));
  normCache = indexRows.map((r) => normalizeAr(r.word));
  return { rows: indexRows, meta: meta! };
}

// chunk 里的 forms 是压缩数组 [form, roman, tagIdx[]],这里解码
type RawEntry = Omit<Entry, 'forms'> & { forms: [string, string, number[]][] };

export async function getEntry(id: number): Promise<Entry | null> {
  const m = meta!;
  const c = Math.floor(id / m.chunkSize);
  if (!chunkCache.has(c)) {
    const res = await fetch(`${BASE}/chunks/${c}.json`);
    if (!res.ok) return null;
    const raw: RawEntry[] = await res.json();
    chunkCache.set(
      c,
      raw.map((e) => ({
        ...e,
        forms: e.forms.map(([f, r, t]) => ({ f, r, t: t.map((i) => m.tagList[i] ?? '') })),
      })),
    );
  }
  return chunkCache.get(c)!.find((e) => e.id === id) ?? null;
}

async function lookupFormShard(norm: string): Promise<number[]> {
  const hex = norm.codePointAt(0)!.toString(16);
  if (!meta!.formShards.includes(hex)) return [];
  if (!formShardCache.has(hex)) {
    const res = await fetch(`${BASE}/forms/${hex}.json`);
    formShardCache.set(hex, res.ok ? await res.json() : {});
  }
  return formShardCache.get(hex)![norm] ?? [];
}

// ---------- 搜索 ----------
export interface SearchResult {
  row: IndexRow;
  via?: string; // 命中方式说明,如 "变化形匹配"
}

const LIMIT = 60;

export async function search(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  await loadIndex();
  const rows = indexRows!;
  const norms = normCache!;

  if (hasArabic(q)) {
    const nq = normalizeAr(q);
    if (!nq) return [];
    const exact: SearchResult[] = [];
    const prefix: SearchResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (norms[i] === nq) exact.push({ row: rows[i] });
      else if (norms[i].startsWith(nq)) {
        if (prefix.length < LIMIT) prefix.push({ row: rows[i] });
      }
    }
    // 变化形反查(词形变化表 + form-of 词条)
    const formIds = await lookupFormShard(nq);
    const seen = new Set(exact.map((r) => r.row.id));
    const viaForm: SearchResult[] = [];
    for (const id of formIds) {
      if (!seen.has(id)) {
        viaForm.push({ row: rows[id], via: '变化形' });
        seen.add(id);
      }
    }
    return [...exact, ...viaForm, ...prefix.filter((r) => !seen.has(r.row.id))].slice(0, LIMIT);
  }

  if (hasCJK(q)) {
    // 中文 → 阿:匹配预生成的中文释义
    const exact: SearchResult[] = [];
    const partial: SearchResult[] = [];
    for (const r of rows) {
      if (!r.zh) continue;
      const parts = r.zh.split(';');
      if (parts.includes(q)) exact.push({ row: r });
      else if (r.zh.includes(q) && partial.length < LIMIT) partial.push({ row: r });
    }
    return [...exact, ...partial].slice(0, LIMIT);
  }

  // 拉丁字母:匹配罗马音或英文释义
  const lq = q.toLowerCase();
  const romanHits: SearchResult[] = [];
  const enExact: SearchResult[] = [];
  const enPartial: SearchResult[] = [];
  const wordRe = new RegExp(`\\b${lq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  for (const r of rows) {
    const roman = r.roman.toLowerCase();
    if (roman === lq || roman.replace(/[ʔʕāīūḥṣḍṭẓġš-]/g, (c) => ({ 'ā': 'a', 'ī': 'i', 'ū': 'u', 'ʔ': '', 'ʕ': '', 'ḥ': 'h', 'ṣ': 's', 'ḍ': 'd', 'ṭ': 't', 'ẓ': 'z', 'ġ': 'g', 'š': 'sh', '-': '' }[c] ?? c)) === lq) {
      romanHits.push({ row: r, via: '读音' });
    } else if (wordRe.test(r.en.toLowerCase())) {
      if (r.en.toLowerCase().split(/;\s*/).some((g) => g === lq || g.replace(/^to /, '') === lq)) enExact.push({ row: r });
      else if (enPartial.length < LIMIT) enPartial.push({ row: r });
    }
    if (romanHits.length + enExact.length > LIMIT) break;
  }
  return [...romanHits, ...enExact, ...enPartial].slice(0, LIMIT);
}

// 同根词
export function sameRoot(root: string, excludeId?: number): IndexRow[] {
  if (!root || !indexRows) return [];
  return indexRows.filter((r) => r.root === root && r.id !== excludeId);
}

// ---------- 标签中文化 ----------
export const POS_ZH: Record<string, string> = {
  noun: '名词', verb: '动词', adj: '形容词', adv: '副词', pron: '代词',
  prep: '介词', conj: '连词', particle: '小品词', interj: '感叹词',
  num: '数词', det: '限定词', phrase: '短语', prep_phrase: '介词短语',
  'proper-noun': '专有名词', name: '专有名词', root: '词根',
};

export const TAG_ZH: Record<string, string> = {
  past: '过去时', 'non-past': '现在/将来时', imperative: '命令式',
  jussive: '祈使/切分式', subjunctive: '虚拟式', indicative: '陈述式',
  active: '主动', passive: '被动', participle: '分词',
  masculine: '阳性', feminine: '阴性', singular: '单数', dual: '双数',
  plural: '复数', paucal: '少数复数', collective: '集合名词', singulative: '单指名词',
  'first-person': '第一人称', 'second-person': '第二人称', 'third-person': '第三人称',
  nominative: '主格', accusative: '宾格', genitive: '属格',
  definite: '确指', indefinite: '泛指', construct: '正偏组合',
  'verbal-noun': '词根名词(马斯达尔)', 'active-participle': '主动分词',
  informal: '口语', formal: '书面', elative: '比较/最高级',
  common: '通性', 'form-i': '一式', invariable: '不变形',
  triptote: '三段变格', diptote: '二段变格',
  perfective: '完成体', imperfective: '未完成体',
  'broken-form': '破碎形', 'sound-form': '完整形',
  oblique: '间接格', 'long-construct': '长正偏组合',
  'noun-from-verb': '动名词', obsolete: '古旧', archaic: '古语',
  colloquial: '口语', alternative: '变体写法', enclitic: '附着形',
  dated: '过时', rare: '罕用', 'form-of': '变化形',
  Morocco: '摩洛哥', Egypt: '埃及', Yemen: '也门', Palestine: '巴勒斯坦',
  dialectal: '方言', nonstandard: '非标准', 'error-unrecognized-form': '',
};

export const tagZh = (t: string) => TAG_ZH[t] ?? t;
export const posZh = (p: string) => POS_ZH[p] ?? p;
