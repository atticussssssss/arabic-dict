import { useEffect, useState } from 'react';
import { loadIndex, type Meta } from './lib/dict';
import SearchPage from './pages/SearchPage';
import WordbookPage from './pages/WordbookPage';
import './App.css';

type Tab = 'search' | 'wordbook';

export default function App() {
  const [tab, setTab] = useState<Tab>('search');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadIndex()
      .then(({ meta }) => setMeta(meta))
      .catch((e) => setError(String(e.message || e)));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="logo">
          <span className="logo-ar">قاموس</span> 阿拉伯语词典
        </h1>
        <nav className="tabs">
          <button className={tab === 'search' ? 'tab active' : 'tab'} onClick={() => setTab('search')}>
            查词
          </button>
          <button className={tab === 'wordbook' ? 'tab active' : 'tab'} onClick={() => setTab('wordbook')}>
            生词本
          </button>
        </nav>
      </header>

      {error && <div className="notice error">{error}</div>}
      {!meta && !error && <div className="notice">正在加载词典数据…</div>}

      {meta && (
        <main className="main">
          <div style={{ display: tab === 'search' ? 'block' : 'none' }}>
            <SearchPage />
          </div>
          {tab === 'wordbook' && <WordbookPage />}
        </main>
      )}

      {meta && tab === 'search' && (
        <footer className="footer">
          收录 {meta.lemmas.toLocaleString()} 个词条 · {meta.withRoot.toLocaleString()} 个含词根 ·{' '}
          {meta.withZh.toLocaleString()} 个含中文释义 · 数据来自 Wiktionary (CC BY-SA) 与 CC-CEDICT
        </footer>
      )}
    </div>
  );
}
