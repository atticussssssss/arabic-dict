import { useEffect, useState } from 'react';
import { getEntry, sameRoot, posZh, tagZh, type Entry, type IndexRow } from '../lib/dict';
import { isSaved, toggleSave, useWordbook } from '../lib/wordbook';

interface Props {
  id: number;
  onClose: () => void;
  onNavigate: (id: number) => void;
  onSearchRoot: (root: string) => void;
}

export default function EntryDetail({ id, onClose, onNavigate }: Props) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [related, setRelated] = useState<IndexRow[]>([]);
  const [showAllForms, setShowAllForms] = useState(false);
  useWordbook(); // 订阅生词本变化,保证星标即时刷新

  useEffect(() => {
    setEntry(null);
    setShowAllForms(false);
    getEntry(id).then((e) => {
      setEntry(e);
      if (e?.root) setRelated(sameRoot(e.root, e.id).slice(0, 20));
      else setRelated([]);
    });
  }, [id]);

  if (!entry) return <div className="notice">加载中…</div>;

  const saved = isSaved(entry.id);
  const zhAll = [...new Set(entry.senses.flatMap((s) => s.zh))].slice(0, 4).join(';');
  const forms = showAllForms ? entry.forms : entry.forms.slice(0, 12);

  return (
    <div className="detail">
      <div className="detail-toolbar">
        <button className="btn-plain" onClick={onClose}>
          ← 返回结果
        </button>
        <button
          className={saved ? 'btn-star saved' : 'btn-star'}
          onClick={() =>
            toggleSave({
              id: entry.id, word: entry.word, voc: entry.voc, roman: entry.roman,
              pos: entry.pos, zh: zhAll,
              en: entry.senses.map((s) => s.gloss).slice(0, 2).join('; '),
            })
          }
        >
          {saved ? '★ 已加入生词本' : '☆ 加入生词本'}
        </button>
      </div>

      <div className="detail-head">
        <div className="detail-word" dir="rtl" lang="ar">
          {entry.voc}
        </div>
        <div className="detail-sub">
          {entry.roman && <span className="detail-roman">{entry.roman}</span>}
          <span className="badge pos">{posZh(entry.pos)}</span>
          {entry.vform && <span className="badge vform">动词 {entry.vform} 式</span>}
          {entry.root && (
            <span className="badge root" title="词根">
              词根 <span dir="rtl" lang="ar">{entry.root}</span>
            </span>
          )}
        </div>
      </div>

      <section className="senses">
        {entry.senses.map((s, i) => (
          <div key={i} className="sense">
            <div className="sense-line">
              <span className="sense-num">{i + 1}.</span>
              {s.zh.length > 0 && <span className="sense-zh">{s.zh.join('、')}</span>}
              <span className="sense-en">{s.gloss}</span>
              {s.tags.map((t) => (
                <span key={t} className="badge tag">
                  {tagZh(t)}
                </span>
              ))}
            </div>
            {s.ex.map((ex, j) => (
              <div key={j} className="example">
                <span dir="rtl" lang="ar" className="example-ar">
                  {ex.ar}
                </span>
                {ex.en && <span className="example-en">{ex.en}</span>}
              </div>
            ))}
          </div>
        ))}
      </section>

      {related.length > 0 && (
        <section>
          <h3 className="section-title">
            同根词 <span dir="rtl" lang="ar" className="root-inline">({entry.root})</span>
          </h3>
          <div className="chips">
            {related.map((r) => (
              <button key={r.id} className="chip" onClick={() => onNavigate(r.id)}>
                <span dir="rtl" lang="ar">{r.voc}</span>
                <span className="chip-gloss">{r.zh ? r.zh.split(';')[0] : r.en.split(';')[0]}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {entry.forms.length > 0 && (
        <section>
          <h3 className="section-title">词形变化({entry.forms.length})</h3>
          <table className="forms-table">
            <tbody>
              {forms.map((f, i) => (
                <tr key={i}>
                  <td dir="rtl" lang="ar" className="form-ar">
                    {f.f}
                  </td>
                  <td className="form-roman">{f.r}</td>
                  <td className="form-tags">{f.t.map(tagZh).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entry.forms.length > 12 && (
            <button className="btn-plain" onClick={() => setShowAllForms(!showAllForms)}>
              {showAllForms ? '收起' : `展开全部 ${entry.forms.length} 个词形 ↓`}
            </button>
          )}
        </section>
      )}

      <div className="attribution">
        释义数据来自 <a href={`https://en.wiktionary.org/wiki/${encodeURIComponent(entry.word)}#Arabic`} target="_blank" rel="noreferrer">Wiktionary</a> (CC BY-SA 4.0),中文由 CC-CEDICT 桥接生成,仅供参考
      </div>
    </div>
  );
}
