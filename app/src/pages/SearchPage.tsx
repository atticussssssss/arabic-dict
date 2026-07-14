import { useEffect, useRef, useState } from 'react';
import { search, posZh, type SearchResult } from '../lib/dict';
import EntryDetail from '../components/EntryDetail';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      setSelectedId(null);
      return;
    }
    timer.current = setTimeout(async () => {
      const r = await search(query);
      setResults(r);
      setSearched(true);
      setSelectedId((prev) => (r.some((x) => x.row.id === prev) ? prev : null));
    }, 200);
    return () => clearTimeout(timer.current);
  }, [query]);

  return (
    <div className="search-page">
      <div className="search-box">
        <input
          className="search-input"
          type="search"
          placeholder="输入阿拉伯语 / 中文 / 英文或读音…  مثال: كتاب"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          dir="auto"
        />
      </div>

      {selectedId !== null && (
        <EntryDetail
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onNavigate={(id) => setSelectedId(id)}
          onSearchRoot={(root) => {
            setSelectedId(null);
            setQuery(root.replace(/ /g, ''));
          }}
        />
      )}

      {selectedId === null && (
        <div className="results">
          {searched && results.length === 0 && (
            <div className="notice">没有找到「{query}」,试试去掉元音符号或换个写法</div>
          )}
          {results.map((r) => (
            <button key={r.row.id} className="result-card" onClick={() => setSelectedId(r.row.id)}>
              <div className="result-head">
                <span className="result-word" dir="rtl" lang="ar">
                  {r.row.voc}
                </span>
                <span className="result-roman">{r.row.roman}</span>
                <span className="badge pos">{posZh(r.row.pos)}</span>
                {r.row.vform && <span className="badge vform">{r.row.vform} 式</span>}
                {r.via && <span className="badge via">{r.via}</span>}
              </div>
              <div className="result-gloss">
                {r.row.zh && <span className="gloss-zh">{r.row.zh.split(';').join('、')}</span>}
                <span className="gloss-en">{r.row.en}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {!searched && selectedId === null && (
        <div className="hints">
          <p>💡 使用提示:</p>
          <ul>
            <li>阿拉伯语查词不需要打元音符号,输入 كتاب 或 كِتَاب 都可以</li>
            <li>输入动词变位形式(如 يكتب / كتبت)也能找到原形动词</li>
            <li>中文查词:直接输入「书」「图书馆」等</li>
            <li>点开词条可以看词根、同根词和完整的词形变化表</li>
          </ul>
        </div>
      )}
    </div>
  );
}
