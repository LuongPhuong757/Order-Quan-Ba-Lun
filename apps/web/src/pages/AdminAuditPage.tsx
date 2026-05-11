import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';

type AuditRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  ip: string;
  ts_ms: number;
  action_kind: string;
  target_kind: string | null;
  target_id: string | null;
  request_id: string | null;
};

const PAGE_SIZE_DEFAULT = 20;

export function AdminAuditPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const page = Number(params.get('page')) || 1;
  const page_size = Number(params.get('page_size')) || PAGE_SIZE_DEFAULT;
  const actor = params.get('actor') || '';
  const action_kind = params.get('action_kind') || '';

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams();
    q.set('page', String(page));
    q.set('page_size', String(page_size));
    if (actor) q.set('actor', actor);
    if (action_kind) q.set('action_kind', action_kind);
    api
      .get<{ data: { items: AuditRow[]; total: number } }>(`/admin/audit?${q.toString()}`)
      .then((res) => {
        setItems(res.data.data.items);
        setTotal(res.data.data.total);
      })
      .catch((err) => toast.push('error', extractError(err).message))
      .finally(() => setLoading(false));
  }, [page, page_size, actor, action_kind, toast]);

  const updateParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.set('page', '1');
    setParams(n);
  };

  const exportCsv = () => {
    const q = new URLSearchParams();
    if (actor) q.set('actor', actor);
    if (action_kind) q.set('action_kind', action_kind);
    window.location.href = `/admin/audit/export.csv?${q.toString()}`;
  };

  const maxPage = Math.max(1, Math.ceil(total / page_size));

  return (
    <div className="container wide with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Audit log</h1>
        <button onClick={exportCsv} disabled={!total}>📥 CSV</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <label htmlFor="ak">Filter action</label>
          <input
            id="ak"
            placeholder="vd: auth.login_success / admin.user_created"
            value={action_kind}
            onChange={(e) => updateParam('action_kind', e.target.value)}
          />
        </div>
        <div className="row">
          <label htmlFor="ac">Filter actor (user_id)</label>
          <input id="ac" value={actor} onChange={(e) => updateParam('actor', e.target.value)} />
        </div>
      </div>

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
      {!loading && items.length === 0 && (
        <div className="empty-state card">Chưa có hoạt động nào được ghi.</div>
      )}
      {items.length > 0 && (
        <>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            {total} bản ghi · trang {page}/{maxPage}
          </p>
          <table className="responsive card" style={{ padding: 0 }}>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người làm</th>
                <th>IP</th>
                <th>Hành động</th>
                <th>Đối tượng</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td data-label="Thời gian">{new Date(r.ts_ms).toLocaleString('vi-VN')}</td>
                  <td data-label="Người làm">{r.actor_name || '(hệ thống)'}</td>
                  <td data-label="IP">{r.ip}</td>
                  <td data-label="Hành động"><code>{r.action_kind}</code></td>
                  <td data-label="Đối tượng">
                    {r.target_kind && r.target_id ? (
                      <code style={{ fontSize: 12 }}>
                        {r.target_kind}#{r.target_id.slice(0, 8)}
                      </code>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex between" style={{ marginTop: 16 }}>
            <button
              className="secondary"
              disabled={page <= 1}
              onClick={() => updateParam('page', String(page - 1))}
            >
              ← Trước
            </button>
            <span>{page}/{maxPage}</span>
            <button
              className="secondary"
              disabled={page >= maxPage}
              onClick={() => updateParam('page', String(page + 1))}
            >
              Sau →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
