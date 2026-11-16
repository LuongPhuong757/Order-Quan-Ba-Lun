// Trang con "Câu chữ khi đóng cửa" (đợt 2, 2026-11-16) — tách từ khối D-14.
// Soạn được BẤT CỨ LÚC NÀO, kể cả lúc quán đang mở (đó chính là lúc người ta soạn trước cho lần đóng
// sau) — vì vậy là trang riêng, không nằm trong tấm "Chuyển sang Đóng cửa". Độ dài không giới hạn.
import { useState } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { CdRow, CdSection, SaveBar, useServerDraft } from './parts.tsx';
import type { SettingsResponse } from './settings-data.ts';

export function ClosedTextsPage({ data, onSaved }: { data: SettingsResponse; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const s = data.settings;
  const { draft, setDraft, dirty, reset } = useServerDraft({
    banner: s.closed_banner_text,
    confirm: s.closed_submit_confirm_text,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', {
        closed_banner_text: draft.banner,
        closed_submit_confirm_text: draft.confirm,
      });
      toast.push('success', 'Đã lưu câu chữ lúc Đóng cửa');
      await onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cd-stack">
      <p className="cd-lead">Đổi chữ là khách thấy ngay, không cần làm gì thêm.</p>
      <CdSection label="Khách đọc">
        <CdRow title="Câu hiện trên trang khách" sub="Khách đọc nguyên văn câu này khi quán đóng" stack>
          <textarea id="closed-banner-text" className="cd-input" rows={3} value={draft.banner}
                    aria-label="Câu hiện trên trang khách"
                    onChange={(e) => setDraft((d) => ({ ...d, banner: e.target.value }))} />
        </CdRow>
        {/* 2026-08-16 — quán đóng CHẶN gửi đơn mới: câu này chỉ còn gặp ở khách đang xem đơn cũ trên
            /o/:token, không phải khách vừa gửi đơn lúc đóng. */}
        <CdRow title="Câu hiện cho khách đang theo dõi đơn" sub="Khách có đơn cũ mở trang theo dõi lúc quán đóng" stack
               info="Đơn MỚI lúc quán đóng đã bị chặn từ 08/2026, nên câu này chỉ hiện cho khách đang xem lại đơn đã đặt trước đó.">
          <textarea id="closed-confirm-text" className="cd-input" rows={3} value={draft.confirm}
                    aria-label="Câu hiện cho khách đang theo dõi đơn"
                    onChange={(e) => setDraft((d) => ({ ...d, confirm: e.target.value }))} />
        </CdRow>
      </CdSection>
      <SaveBar dirty={dirty} saving={saving} what="Câu chữ khi đóng cửa" onSave={() => void save()} onCancel={reset} />
    </div>
  );
}
