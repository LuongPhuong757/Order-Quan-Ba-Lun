// Trang con "Giờ mở cửa" (đợt 2, 2026-11-16) — tách từ khối "Giờ mở cửa" của OnlineOrderSettingsPanel.
// Logic giữ NGUYÊN (ô chọn giờ 24h, nhiều khoảng mỗi ngày, ngoại lệ theo thứ, kiểm lỗi); chỉ đổi vỏ:
// thẻ hàng + thanh Lưu dính đáy thay nút "Lưu giờ mở cửa".
import { useState } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { Dropdown } from '../../components/ui/Dropdown.tsx';
import { CdSection, SaveBar, useServerDraft } from './parts.tsx';
import type { OpenHoursDow, OpenHoursInput, OpenHoursSpan, SettingsResponse } from './settings-data.ts';

const DOW_LABELS: Record<OpenHoursDow, string> = {
  0: 'Chủ nhật',
  1: 'Thứ hai',
  2: 'Thứ ba',
  3: 'Thứ tư',
  4: 'Thứ năm',
  5: 'Thứ sáu',
  6: 'Thứ bảy',
};
const DOW_VALUES: OpenHoursDow[] = [0, 1, 2, 3, 4, 5, 6];

// ══ Ô chọn giờ 24h (2026-08-16) ══
// Thay `<input type="time">`: input đó hiện AM/PM hay 24h là TUỲ NGÔN NGỮ HỆ ĐIỀU HÀNH của từng
// máy — chủ dự án dùng máy tiếng Anh nên toàn thấy AM/PM. Dropdown tự dựng thì luôn 00:00 → 24:00.
// Bước 30 phút. Giá trị lẻ ĐÃ LƯU (vd "07:15") được chèn thêm để ô không âm thầm hiện sai.
// Giờ đóng muộn nhất là 24:00 (2026-08-30): ca đêm viết thành `17:00–24:00` + `00:00–05:00`.
const LAST_CLOSE_MINUTES = 24 * 60;

function timeOptions(current: string, endOfDay: boolean): string[] {
  const opts: string[] = [];
  const lastMinutes = endOfDay ? LAST_CLOSE_MINUTES : 23 * 60 + 30;
  for (let mins = 0; mins <= lastMinutes; mins += 30) opts.push(hhmm(mins));
  if (current && !opts.includes(current)) opts.push(current);
  // So chuỗi là đủ: mọi giá trị đều dạng HH:mm 2 chữ số nên thứ tự chữ = thứ tự thời gian.
  return opts.sort();
}

/** 1560 → "26:00". */
function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "26:00" → 1560. */
function minutesOf(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

/** Giá trị QUÁ 24:00 còn trong DB từ bản trước ("26:00") — một mình con số đó là câu đố, nên kèm nghĩa. */
function timeOptionLabel(v: string): string {
  const [h, m] = v.split(':').map(Number);
  if (h <= 24) return v;
  return `${v} → ${String(h - 24).padStart(2, '0')}:${String(m).padStart(2, '0')} hôm sau`;
}

function TimeSelect({ value, onChange, endOfDay = false }: { value: string; onChange: (v: string) => void; endOfDay?: boolean }) {
  return (
    <Dropdown
      ariaLabel={endOfDay ? 'Giờ đóng' : 'Giờ mở'}
      value={value}
      neutralValue={value}
      options={timeOptions(value, endOfDay).map((t) => ({ value: t, label: timeOptionLabel(t) }))}
      onChange={onChange}
    />
  );
}

/**
 * Khoảng mới rơi vào CHỖ TRỐNG đầu tiên còn lại trong ngày, không phải nối đuôi khoảng cuối — ca đêm
 * `17:00–24:00` thì sau 24:00 không còn chỗ, nút "+ Thêm khoảng" bấm vào sẽ không ra gì.
 */
function appendSpan(spans: OpenHoursSpan[]): OpenHoursSpan[] {
  if (spans.length === 0) return [{ from: '17:00', to: '22:00' }];
  const sorted = [...spans].sort((a, b) => minutesOf(a.from) - minutesOf(b.from));
  const MIN_GAP = 30;
  let cursor = 0;
  let gapStart: number | null = null;
  for (const sp of sorted) {
    if (minutesOf(sp.from) - cursor >= MIN_GAP) {
      gapStart = cursor;
      break;
    }
    cursor = Math.max(cursor, minutesOf(sp.to));
  }
  const gapEnd =
    gapStart === null ? 24 * 60 : minutesOf(sorted.find((sp) => minutesOf(sp.from) > gapStart!)!.from);
  if (gapStart === null) {
    if (24 * 60 - cursor < MIN_GAP) return spans; // Ngày đã kín.
    gapStart = cursor;
  }
  return [...spans, { from: hhmm(gapStart), to: hhmm(Math.min(gapStart + 120, gapEnd)) }].sort(
    (a, b) => minutesOf(a.from) - minutesOf(b.from),
  );
}

/** Ca đêm ghi bằng giờ chạy tiếp nên phép so vẫn là `from < to`. BE chặn lần nữa — đây là để chủ
 *  quán thấy lỗi ngay tại ô. */
function dayErr(spans: OpenHoursSpan[]): string | null {
  const sorted = [...spans].sort((a, b) => (a.from < b.from ? -1 : 1));
  let prevEnd: number | null = null;
  for (const sp of sorted) {
    if (sp.from >= sp.to) return 'Giờ đóng phải sau giờ mở';
    if (minutesOf(sp.to) - minutesOf(sp.from) > 24 * 60) return 'Một ca không được dài quá 24 tiếng';
    if (prevEnd !== null && minutesOf(sp.from) < prevEnd) return 'Hai khoảng trong cùng một ngày đang đè lên nhau';
    prevEnd = minutesOf(sp.to);
  }
  return null;
}

/** Danh sách khoảng giờ của MỘT ngày. Danh sách RỖNG hiện "Nghỉ cả ngày" — khoảng trắng không nói
 *  được nó là "nghỉ" hay "chưa cấu hình", mà hai thứ đó dẫn tới hai hành vi ngược nhau. */
function SpanList({ spans, onChange, err }: { spans: OpenHoursSpan[]; onChange: (s: OpenHoursSpan[]) => void; err?: string }) {
  const update = (i: number, p: Partial<OpenHoursSpan>) => onChange(spans.map((sp, idx) => (idx === i ? { ...sp, ...p } : sp)));
  return (
    <>
      {spans.length === 0 && <div className="cd-row"><span className="cd-row__s">Nghỉ cả ngày — khách không đặt được đơn.</span></div>}
      {spans.map((sp, i) => (
        <div className="cd-row cd-span" key={i}>
          <TimeSelect value={sp.from} onChange={(v) => update(i, { from: v })} />
          <span aria-hidden="true">–</span>
          <TimeSelect value={sp.to} onChange={(v) => update(i, { to: v })} endOfDay />
          <button type="button" className="secondary cd-sm cd-span__x" aria-label="Xoá khoảng giờ này"
                  onClick={() => onChange(spans.filter((_, idx) => idx !== i))}>
            Xoá
          </button>
        </div>
      ))}
      {err && <div className="cd-row"><span className="field-error">{err}</span></div>}
      <button type="button" className="cd-morebtn" onClick={() => onChange(appendSpan(spans))}>+ Thêm khoảng</button>
    </>
  );
}

export function OpenHoursPage({ data, onSaved }: { data: SettingsResponse; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const { draft, setDraft, dirty, reset } = useServerDraft<OpenHoursInput>(data.open_hours_input);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { exceptions } = draft;
  const usedDows = new Set(exceptions.map((e) => e.dow));

  const setDefault = (spans: OpenHoursSpan[]) => setDraft((d) => ({ ...d, default: spans }));
  const setEx = (i: number, p: Partial<OpenHoursInput['exceptions'][number]>) =>
    setDraft((d) => ({ ...d, exceptions: d.exceptions.map((e, idx) => (idx === i ? { ...e, ...p } : e)) }));
  const addException = () => {
    const free = DOW_VALUES.find((d) => !usedDows.has(d));
    if (free === undefined) return;
    setDraft((d) => ({ ...d, exceptions: [...d.exceptions, { dow: free, spans: d.default.map((sp) => ({ ...sp })) }] }));
  };

  const save = async () => {
    const e: Record<string, string> = {};
    const de = dayErr(draft.default);
    if (de) e.default = de;
    exceptions.forEach((ex, i) => {
      const x = dayErr(ex.spans);
      if (x) e[String(i)] = x;
    });
    // Xoá sạch mọi khoảng thì `open_hours` rỗng = "mở 24/24" — đúng ngược ý chủ quán. BE cũng chặn.
    const total = draft.default.length * (7 - exceptions.length) + exceptions.reduce((n, ex) => n + ex.spans.length, 0);
    if (total === 0) e.default = 'Phải còn ít nhất một khoảng giờ mở. Muốn ngừng nhận đơn thì tắt công tắc Đang nhận đơn.';
    setErrs(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    try {
      await api.put('/admin/settings', { open_hours_input: draft });
      toast.push('success', 'Đã lưu giờ mở cửa');
      await onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cd-stack">
      {/* 2026-08-16 — ngoài giờ CHẶN đặt đơn thật (trang khách hiện đồng hồ đếm ngược tới giờ mở). */}
      <p className="cd-lead">
        {data.open_hours_configured
          ? 'Ngoài các khoảng này khách không đặt được đơn. Nghỉ trưa hoặc bán xuyên đêm thì tách làm nhiều khoảng.'
          : 'Chưa cài giờ — quán nhận đơn 24/24. Giờ bên dưới chỉ là gợi ý, bấm Lưu mới áp dụng.'}
      </p>

      <CdSection label="Mọi ngày">
        <SpanList spans={draft.default} onChange={setDefault} err={errs.default} />
      </CdSection>

      {exceptions.map((ex, i) => (
        <CdSection
          key={i}
          label="Ngày riêng"
          action={
            <button type="button" className="secondary cd-sm" onClick={() => setDraft((d) => ({ ...d, exceptions: d.exceptions.filter((_, idx) => idx !== i) }))}>
              Bỏ ngày riêng
            </button>
          }
        >
          <div className="cd-row">
            <Dropdown
              ariaLabel="Ngày áp dụng"
              value={String(ex.dow)}
              neutralValue={String(ex.dow)}
              options={DOW_VALUES.filter((d) => d === ex.dow || !usedDows.has(d)).map((d) => ({ value: String(d), label: DOW_LABELS[d] }))}
              onChange={(v) => setEx(i, { dow: Number(v) as OpenHoursDow })}
            />
          </div>
          <SpanList spans={ex.spans} onChange={(spans) => setEx(i, { spans })} err={errs[String(i)]} />
        </CdSection>
      ))}

      {exceptions.length < 7 && (
        <button type="button" className="secondary cd-addbtn" onClick={addException}>+ Thêm ngày riêng (vd Chủ nhật nghỉ trưa)</button>
      )}

      <SaveBar dirty={dirty} saving={saving} what="Giờ mở cửa" onSave={() => void save()} onCancel={() => { reset(); setErrs({}); }} />
    </div>
  );
}
