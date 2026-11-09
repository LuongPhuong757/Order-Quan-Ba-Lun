import { useState } from 'react';
import { Calendar, DateField } from '../components/ui/Calendar.tsx';
import { Dropdown, type DropdownOption } from '../components/ui/Dropdown.tsx';
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import { TimeFilter, TimePresetChips } from '../components/ui/TimeFilter.tsx';
import { presetToRange, DAY_SCREEN, ONLINE_SCREEN, SHIFT_SCREEN, presetToHours, type TimePreset } from '../lib/time-presets.ts';
import { vnDayIso, type DayRange } from '../lib/date-range.ts';

/**
 * Trang MẪU GIAO DIỆN (/mau-giao-dien, chỉ admin) — Đợt 0 đồng bộ giao diện, 2026-11-09.
 *
 * Chủ quán chốt: mọi thay đổi nhìn thấy được phải cho xem thử TRƯỚC khi áp vào màn thật. Trang
 * này dựng CHÍNH các component chung (không phải ảnh vẽ lại) với dữ liệu mẫu, để bấm thử trên
 * điện thoại/iPad thật rồi mới chuyển từng màn sang. Không gọi API, không ghi gì.
 */
const ICON_GROUPS: Array<[string, Array<[IconName, string]>]> = [
  ['Thao tác', [['them', 'Thêm'], ['sua', 'Sửa'], ['xoa', 'Xoá'], ['in', 'In'], ['tim', 'Tìm'], ['loc', 'Lọc'], ['sap-xep', 'Sắp xếp'], ['lam-moi', 'Làm mới'], ['chep', 'Chép'], ['tai-xuong', 'Tải xuống'], ['hoan-tac', 'Trả lại'], ['them-thao-tac', 'Thêm thao tác'], ['dong', 'Đóng'], ['cai-dat', 'Cài đặt']]],
  ['Trạng thái', [['xong', 'Xong / đã trả'], ['dang-cho', 'Đang chờ'], ['dang-nau', 'Đang nấu'], ['da-huy', 'Đã huỷ'], ['canh-bao', 'Cảnh báo'], ['het-mon', 'Hết món'], ['uu-tien', 'Ưu tiên'], ['de-xuat', 'Đề xuất']]],
  ['Tiền', [['thanh-toan', 'Thanh toán'], ['tien-mat', 'Tiền mặt'], ['chuyen-khoan', 'Chuyển khoản'], ['ghi-no', 'Ghi nợ']]],
  ['Nghiệp vụ', [['order', 'Order'], ['hoa-don', 'Hoá đơn'], ['lich-su', 'Lịch sử'], ['bep', 'Bếp'], ['menu', 'Menu'], ['ban', 'Bàn'], ['online', 'Online'], ['ncc', 'Nhà cung cấp'], ['nhan-vien', 'Nhân viên'], ['tai-khoan', 'Tài khoản'], ['bao-cao', 'Báo cáo'], ['ghi-chu', 'Ghi chú'], ['giao-hang', 'Giao hàng'], ['mang-ve', 'Mang về'], ['qr', 'QR'], ['goi-nhan-vien', 'Khách gọi'], ['anh', 'Ảnh'], ['gio', 'Giờ'], ['lich', 'Lịch']]],
];

const PAY_OPTS: DropdownOption<string>[] = [
  { value: '', label: 'Mọi hình thức' },
  { value: 'cash', label: 'Tiền mặt', icon: 'tien-mat' },
  { value: 'transfer', label: 'Chuyển khoản', icon: 'chuyen-khoan' },
  { value: 'mixed', label: 'Cả hai' },
];
const TABLE_OPTS: DropdownOption<string>[] = [
  { value: '', label: 'Tất cả bàn' },
  ...Array.from({ length: 14 }, (_, i) => ({ value: `b${i + 1}`, label: `Bàn ${i + 1}`, group: 'Bàn ngồi' })),
  { value: 'mv1', label: 'Mang về 1', group: 'Mang về' },
  { value: 'mv2', label: 'Mang về 2', group: 'Mang về' },
  { value: 'gh', label: 'Giao hàng', group: 'Giao hàng' },
];
const NCC_OPTS: DropdownOption<string>[] = [
  { value: '', label: 'Tất cả nhà cung cấp' },
  { value: 'a', label: 'Chị Hoa – rau củ', hint: '0912 345 678' },
  { value: 'b', label: 'Anh Tuấn – hải sản', hint: '0987 654 321' },
  { value: 'c', label: 'Nhóm Lấy Rượu Các Loại', hint: '0903 111 222' },
  { value: 'd', label: 'Đá viên Bình An', hint: '0938 000 111' },
  { value: 'e', label: 'Bia Sài Gòn – đại lý Q.7', hint: '0909 222 333' },
  { value: 'f', label: 'Thịt bò Út Mập', hint: '0911 444 555' },
  { value: 'g', label: 'Gà ta Củ Chi', hint: '0912 666 777' },
];

export function UiSamplePage() {
  const [pay, setPay] = useState('');
  const [table, setTable] = useState('');
  const [ncc, setNcc] = useState('');
  const [shiftRange, setShiftRange] = useState<DayRange>(() => presetToRange('shift', Date.now()));
  const [dayRange, setDayRange] = useState<DayRange>(() => presetToRange('30d', Date.now()));
  const [online, setOnline] = useState<TimePreset>('all');
  const [day, setDay] = useState(() => vnDayIso(Date.now()));
  const hours = presetToHours(online, Date.now());

  return (
    <div className="wide" style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: '16px 16px 120px' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0 }}>Mẫu giao diện</h1>
        <p style={{ margin: 0, color: 'var(--gray-600)' }}>
          Bộ icon, ô chọn, bộ lọc thời gian và lịch dùng chung. Bấm thử ở đây trước khi áp vào từng màn. Trang này không lưu gì.
        </p>
      </header>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0 }}>1. Bộ icon</h2>
        {ICON_GROUPS.map(([g, items]) => (
          <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="ds-label">{g}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {items.map(([n, t]) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 8, background: '#fff', fontSize: 16 }}>
                  <Icon name={n} size={22} />
                  {t}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0 }}>2. Ô chọn</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          <Dropdown label="Hình thức thu" value={pay} options={PAY_OPTS} onChange={setPay} neutralValue="" />
          <Dropdown label="Bàn (có ô tìm, có nhóm)" value={table} options={TABLE_OPTS} onChange={setTable} neutralValue="" sheetTitle="Chọn bàn" />
          <Dropdown label="Nhà cung cấp (có dòng phụ)" value={ncc} options={NCC_OPTS} onChange={setNcc} neutralValue="" />
        </div>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h2 style={{ margin: 0 }}>3. Lọc thời gian</h2>
        <TimeFilter label="Màn có ca (Lịch sử, Món đã bán)" value={shiftRange} onChange={setShiftRange} presets={SHIFT_SCREEN} />
        <TimeFilter label="Màn không có ca (Nhà cung cấp, Sổ tiền…)" value={dayRange} onChange={setDayRange} presets={DAY_SCREEN} />
        <div>
          <TimePresetChips label="Đơn online (lọc theo giờ, không có Chọn ngày)" value={online} onChange={setOnline} presets={ONLINE_SCREEN} />
          <div className="ds-seeing" style={{ marginTop: 8 }}>
            Gửi lên máy chủ: <b>{hours === null ? 'không giới hạn' : `${hours} giờ gần đây`}</b>
          </div>
        </div>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0 }}>4. Ô nhập một ngày</h2>
        <div style={{ maxWidth: 320 }}>
          <DateField label="Ngày giao hàng" value={day} onChange={setDay} max={vnDayIso(Date.now())} quick />
        </div>
        <span className="ds-label">Lịch mở sẵn (để xem kích cỡ ô)</span>
        <div style={{ maxWidth: 360, border: '1px solid var(--gray-200)', borderRadius: 12, background: '#fff', paddingBottom: 8 }}>
          <Calendar value={day} onPick={setDay} max={vnDayIso(Date.now())} />
        </div>
      </section>
    </div>
  );
}
