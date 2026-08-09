/**
 * Sinh `packages/schemas/src/vn-address.ts` — chạy TAY, không nằm trong `pnpm build`.
 *
 *   node scripts/build-address-data.mjs
 *
 * KHI NÀO CHẠY LẠI: chỉ khi danh mục hành chính đổi (sáp nhập/đổi tên/lập đặc khu). Vài năm một
 * lần. Chạy xong PHẢI đọc diff rồi mới commit — script gọi hai dịch vụ ngoài, và một ngày nào đó
 * chúng sẽ trả dữ liệu khác đi mà không báo gì.
 *
 * VÌ SAO SINH FILE TĨNH THAY VÌ GỌI API LÚC CHẠY: xem docblock đầu `vn-address.ts`.
 *
 * MÔ HÌNH 2 CẤP. Từ 01/07/2025 Việt Nam bỏ cấp huyện: chỉ còn Tỉnh/TP trực thuộc TW → Xã/Phường/
 * Đặc khu. Đây là lý do cây dữ liệu ở đây sâu đúng 2 tầng chứ không phải 3.
 *
 * TOẠ ĐỘ CHỈ LẤY CHO TỈNH TRONG `GEOCODE_PROVINCES`. Geocode + đối chiếu 3.321 xã là hơn 2 giờ gọi
 * Nominatim, vượt xa mức lịch sự với một dịch vụ miễn phí, và không ai kiểm lại nổi từng dòng.
 * Tỉnh không geocode thì xã không có toạ độ — trang khách vẫn chọn được xã bình thường, chỉ là bản
 * đồ không tự mở ở giữa xã (quay về đúng hành vi cũ: có GPS thì có bản đồ). Muốn thêm tỉnh thì
 * thêm mã vào mảng rồi chạy lại.
 *
 * NĂM BƯỚC, và bước 3–4 mới là phần đáng giá:
 *   1. Lấy 34 tỉnh + toàn bộ xã của từng tỉnh (provinces.open-api.vn v2).
 *   2. Với tỉnh trong `GEOCODE_PROVINCES`: geocode tên xã qua Nominatim.
 *   3. Reverse-geocode NGƯỢC LẠI từng toạ độ để đối chiếu. Không bỏ được bước này: geocode thuận
 *      trả điểm của một xã khác mà KHÔNG báo lỗi — lần chạy đầu cho Bắc Ninh có 2 xã nhận cùng
 *      một toạ độ y hệt, và 2 xã lệch gần 40 km.
 *   4. Xã nào lệch thì thử lại bằng truy vấn khác, và CHỈ nhận ứng viên nào phân cấp địa chỉ của
 *      chính OSM khẳng định là nằm trong xã đó.
 *   5. Kiểm tổng thể rồi mới ghi file. Không đạt là DỪNG, không ghi đè file đang chạy được.
 *
 * Vì sao KHÔNG lấy centroid từ ranh giới OSM (Overpass `admin_level=8`): sau sáp nhập, ranh giới
 * xã cũ đã bị xoá khỏi OSM còn xã mới chưa ai vẽ — truy vấn cả tỉnh Bắc Ninh chỉ còn đúng 1 quan
 * hệ. Nếu sau này OSM vẽ xong thì đổi sang Overpass sẽ cho toạ độ chuẩn hơn Nominatim.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'schemas',
  'src',
  'vn-address.ts',
);

/** Tỉnh được geocode toạ độ xã. Xem docblock đầu file trước khi thêm. */
const GEOCODE_PROVINCES = ['24']; // Tỉnh Bắc Ninh — nơi quán đang giao hàng.

const UA = 'quanbalun-address-build/1.0 (+https://github.com/quanbalun)';
const SLEEP_MS = 1200; // Nominatim cho tối đa 1 req/s. Để dư, đừng hạ xuống.

/** Hộp bao dùng để bắt kết quả geocode lạc sang tỉnh khác. Chỉ cần cho tỉnh có geocode. */
const BBOX = {
  24: { minLat: 20.95, maxLat: 21.9, minLng: 105.65, maxLng: 107.15 },
};

/**
 * Toạ độ chốt TAY. Chỉ thêm khi bước 4 đã thử hết mà vẫn không ra điểm nào OSM xác nhận — mỗi
 * dòng phải kèm lý do và căn cứ, vì đây là chỗ dữ liệu thoát khỏi mọi kiểm tra tự động.
 */
const MANUAL = {
  // OSM chưa gắn địa danh nào vào xã này (phân cấp địa chỉ của OSM đang xếp cả Cao Đức lẫn Thái
  // Bảo dưới "Nhân Thắng", không dùng được). Lấy cụm Trường THCS Nhân Thắng + Chợ Ngụ làm mốc —
  // lõi xã Nhân Thắng cũ, nay là trung tâm xã mới.
  9475: { lat: 21.064, lng: 106.2326 },
};

/**
 * MỌI request phải có hạn giờ. `fetch` của Node KHÔNG có timeout mặc định: một dịch vụ nhận kết
 * nối rồi im lặng là script treo vĩnh viễn, không log, không lỗi, không cách nào biết ngoài việc
 * đi xem tiến trình. Đã bị đúng lần này — chạy 6 tiếng với 0.9s CPU.
 */
const REQUEST_TIMEOUT_MS = 20_000;
const fetchJson = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round5 = (v) => Number(Number(v).toFixed(5));
const bare = (name) => name.replace(/^(Xã|Phường|Thị trấn|Đặc khu)\s+/, '');

const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/^(xa|phuong|thi tran|dac khu)\s+/, '')
    .replace(/[^a-z0-9]/g, '');

const TYPE_OF = { phường: 'phuong', xã: 'xa', 'đặc khu': 'dac_khu' };

async function nominatim(path) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchJson(`https://nominatim.openstreetmap.org/${path}`);
    } catch (e) {
      if (attempt === 3) throw new Error(`Nominatim hỏng sau 3 lần: ${e.message}`);
      await sleep(2000 * attempt);
    }
  }
  return null;
}

const search = (q, extra = '') =>
  nominatim(`search?format=jsonv2&limit=10&countrycodes=vn&${extra}q=${encodeURIComponent(q)}`);
const reverse = (lat, lng) => nominatim(`reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lng}`);

const inBbox = (box, lat, lng) =>
  lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;

/** Phân cấp địa chỉ của OSM có khẳng định điểm này nằm trong `wardName` không? */
function belongsTo(candidate, wardName) {
  const target = norm(wardName);
  const a = candidate.address ?? {};
  if (
    [a.suburb, a.quarter, a.village, a.town, a.city_district, a.municipality].some(
      (p) => p && norm(p) === target,
    )
  )
    return true;
  return (
    candidate.category === 'boundary' &&
    candidate.type === 'administrative' &&
    norm(candidate.name ?? '') === target
  );
}

function pick(box, results) {
  const valid = (results ?? []).filter((r) => inBbox(box, Number(r.lat), Number(r.lon)));
  return (
    valid.find((r) => r.category === 'boundary' && r.type === 'administrative') ??
    valid.find((r) => r.addresstype === 'village' || r.addresstype === 'suburb') ??
    valid[0] ??
    null
  );
}

// ── 1. Danh mục toàn quốc ────────────────────────────────────────────────────
console.log('1/5  Lấy danh mục 34 tỉnh + xã (provinces.open-api.vn) ...');
const provinceList = await fetchJson('https://provinces.open-api.vn/api/v2/p/');

const provinces = [];
for (const p of provinceList) {
  const full = await fetchJson(`https://provinces.open-api.vn/api/v2/p/${p.code}?depth=2`);
  provinces.push({
    code: String(p.code),
    name: p.name,
    wards: (full.wards ?? []).map((w) => ({
      code: String(w.code),
      name: w.name,
      type: TYPE_OF[w.division_type] ?? 'xa',
      lat: null,
      lng: null,
    })),
  });
  process.stdout.write('.');
}
const totalWards = provinces.reduce((n, p) => n + p.wards.length, 0);
console.log(`\n     ${provinces.length} tỉnh/thành · ${totalWards} đơn vị cấp xã\n`);

// ── 2-4. Toạ độ cho các tỉnh được chọn ───────────────────────────────────────
for (const provinceCode of GEOCODE_PROVINCES) {
  const province = provinces.find((p) => p.code === provinceCode);
  if (!province) throw new Error(`GEOCODE_PROVINCES có mã ${provinceCode} không tồn tại`);
  const box = BBOX[provinceCode];
  if (!box) throw new Error(`Thiếu BBOX cho tỉnh ${provinceCode} — không có nó thì không bắt được geocode lạc tỉnh`);

  const shortName = bare(province.name.replace(/^(Tỉnh|Thành phố)\s+/, ''));
  console.log(`2/5  Geocode ${province.wards.length} xã của ${province.name} (~${Math.ceil((province.wards.length * SLEEP_MS) / 1000)}s) ...`);
  for (const [i, w] of province.wards.entries()) {
    let hit = pick(box, await search(`${w.name}, ${shortName}`));
    await sleep(SLEEP_MS);
    if (!hit) {
      hit = pick(box, await search(`${bare(w.name)}, ${shortName}, Việt Nam`));
      await sleep(SLEEP_MS);
    }
    if (hit) {
      w.lat = round5(hit.lat);
      w.lng = round5(hit.lon);
    }
    process.stdout.write(`${hit ? '·' : '✗'}${(i + 1) % 40 === 0 ? ` ${i + 1}\n` : ''}`);
  }

  console.log(`\n\n3/5  Reverse-geocode đối chiếu (~${Math.ceil((province.wards.length * SLEEP_MS) / 1000)}s) ...`);
  const suspect = [];
  for (const [i, w] of province.wards.entries()) {
    if (w.lat === null) {
      suspect.push(w);
      process.stdout.write('✗');
      continue;
    }
    const r = await reverse(w.lat, w.lng);
    const hay = norm(
      [r?.display_name, r?.address?.suburb, r?.address?.village, r?.address?.town, r?.address?.quarter]
        .filter(Boolean)
        .join(' | '),
    );
    const ok = hay.includes(norm(w.name));
    if (!ok) suspect.push(w);
    process.stdout.write(`${ok ? '·' : '✗'}${(i + 1) % 40 === 0 ? ` ${i + 1}\n` : ''}`);
    await sleep(SLEEP_MS);
  }
  console.log(`\n\n4/5  Kiểm lại ${suspect.length} xã lệch ...`);

  for (const w of suspect) {
    let picked = null;
    for (const q of [
      `Uỷ ban nhân dân ${w.name}, ${shortName}`,
      `${w.name}, ${shortName}, Việt Nam`,
      `${bare(w.name)}, ${shortName}, Việt Nam`,
    ]) {
      const results = await search(q, 'addressdetails=1&');
      await sleep(SLEEP_MS);
      picked = (results ?? []).find((r) => belongsTo(r, w.name)) ?? null;
      if (picked) break;
    }
    if (!picked) {
      console.log(`     · ${w.name}: không tìm được điểm OSM xác nhận → chờ MANUAL`);
      continue;
    }
    const lat = round5(picked.lat);
    const lng = round5(picked.lon);
    const moved = w.lat === null ? null : Math.hypot((lat - w.lat) * 111, (lng - w.lng) * 104);
    if (moved !== null && moved > 1)
      console.log(`     · ${w.name}: dời ${moved.toFixed(1)} km về ${lat},${lng}`);
    w.lat = lat;
    w.lng = lng;
  }

  for (const [code, coord] of Object.entries(MANUAL)) {
    const row = province.wards.find((r) => r.code === String(code));
    if (row) {
      Object.assign(row, coord);
      console.log(`     · ${row.name}: dùng toạ độ chốt tay`);
    }
  }
}

// ── 5. Kiểm rồi ghi ──────────────────────────────────────────────────────────
console.log('\n5/5  Kiểm dữ liệu ...');
const problems = [];
if (provinces.length !== 34) problems.push(`có ${provinces.length} tỉnh, phải là 34`);
if (totalWards < 3000) problems.push(`chỉ có ${totalWards} đơn vị cấp xã — nghi API trả thiếu`);

const seenWard = new Set();
const seenProvince = new Set();
for (const p of provinces) {
  if (seenProvince.has(p.code)) problems.push(`mã tỉnh ${p.code} trùng`);
  seenProvince.add(p.code);
  if (p.wards.length === 0) problems.push(`${p.name}: không có xã nào`);
  for (const w of p.wards) {
    if (seenWard.has(w.code)) problems.push(`mã xã ${w.code} (${w.name}) trùng trên toàn quốc`);
    seenWard.add(w.code);
  }
}

// Tỉnh có geocode thì phải đủ toạ độ, không trùng, và nằm trong hộp bao.
for (const provinceCode of GEOCODE_PROVINCES) {
  const p = provinces.find((x) => x.code === provinceCode);
  const box = BBOX[provinceCode];
  const coords = new Map();
  for (const w of p.wards) {
    if (w.lat === null || w.lng === null) {
      problems.push(`${p.name} / ${w.name}: thiếu toạ độ`);
      continue;
    }
    if (!inBbox(box, w.lat, w.lng)) problems.push(`${p.name} / ${w.name}: toạ độ ngoài tỉnh`);
    const k = `${w.lat},${w.lng}`;
    if (coords.has(k)) problems.push(`${w.name} trùng toạ độ với ${coords.get(k)}`);
    coords.set(k, w.name);
  }
}

if (problems.length) {
  console.error('\n❌ KHÔNG ghi file — dữ liệu chưa đạt:');
  problems.forEach((x) => console.error(`   ${x}`));
  process.exit(1);
}
console.log(`     ✓ ${provinces.length} tỉnh · ${totalWards} đơn vị cấp xã · mã không trùng`);
for (const c of GEOCODE_PROVINCES) {
  const p = provinces.find((x) => x.code === c);
  console.log(`     ✓ ${p.name}: ${p.wards.length}/${p.wards.length} xã có toạ độ đã đối chiếu`);
}

provinces.sort((a, b) => Number(a.code) - Number(b.code));
for (const p of provinces) p.wards.sort((a, b) => Number(a.code) - Number(b.code));

const esc = (s) => s.replace(/'/g, "\\'");
const body = provinces
  .map((p) => {
    const wards = p.wards
      .map((w) => {
        const coord = w.lat === null ? '' : `, lat: ${w.lat}, lng: ${w.lng}`;
        return `      { code: '${w.code}', name: '${esc(w.name)}', type: '${w.type}'${coord} },`;
      })
      .join('\n');
    return `  {
    code: '${p.code}',
    name: '${esc(p.name)}',
    wards: [
${wards}
    ],
  },`;
  })
  .join('\n');

writeFileSync(
  OUT,
  `/**
 * Danh mục hành chính Việt Nam — DỮ LIỆU TĨNH, không phải API.
 *
 * FILE NÀY DO SCRIPT SINH RA: \`node scripts/build-address-data.mjs\`. Sửa tay thì lần chạy sau mất.
 *
 * VÌ SAO LÀ FILE TĨNH CHỨ KHÔNG PHẢI ENDPOINT
 * Ô địa chỉ nằm giữa luồng đặt đơn, chỗ khách dễ bỏ giỏ nhất. Một API danh mục địa chỉ chậm hoặc
 * chết là khách kẹt ở đó — trong khi toàn bộ dữ liệu này chỉ ~30 KB gzip và vài năm mới đổi một
 * lần. Nằm sẵn trong bundle thì không có timeout phải xử lý, không có trạng thái loading, không
 * có fallback phải viết, và không có gì để hỏng giữa chừng.
 *
 * MÔ HÌNH 2 CẤP — KHÔNG CÒN CẤP HUYỆN. Từ 01/07/2025 Việt Nam bỏ cấp huyện; cả nước còn 34 tỉnh/
 * thành phố trực thuộc trung ương và ${totalWards} đơn vị cấp xã (phường / xã / đặc khu). Đây là lý do
 * cây dữ liệu này sâu đúng 2 tầng, và trang khách chỉ có HAI ô chọn chứ không phải ba.
 *
 * \`lat\`/\`lng\` LÀ TUỲ CHỌN, VÀ THIẾU LÀ CHUYỆN BÌNH THƯỜNG. Chỉ những tỉnh trong
 * \`GEOCODE_PROVINCES\` của script mới có toạ độ (hiện là Bắc Ninh — nơi quán giao hàng); geocode
 * cả ${totalWards} xã là hơn 2 giờ gọi Nominatim và không ai kiểm lại nổi từng dòng. Xã không có toạ
 * độ vẫn chọn được bình thường, chỉ là bản đồ không tự mở ở giữa xã.
 *
 * KHI CÓ TOẠ ĐỘ THÌ NÓ LÀ ĐIỂM GIỮA XÃ, KHÔNG PHẢI NHÀ KHÁCH. Xã ở Bắc Ninh trung bình ~48 km²,
 * nên điểm này lệch chỗ ở thật của khách vài km là chuyện bình thường. Hệ quả bắt buộc phải nhớ:
 *
 *     Toạ độ ở đây CHỈ dùng để mở bản đồ đúng vùng. TUYỆT ĐỐI không dùng để tính phí giao hay
 *     quyết định "ngoài bán kính giao" — chỉ toạ độ do khách tự ghim mới được làm việc đó. Xem
 *     \`delivery-radius.ts\`: lấy điểm giữa xã làm chỗ ở của khách là từ chối oan những người ở rìa
 *     xã, mà họ sẽ không bao giờ biết vì sao.
 */

export type VnWardType = 'xa' | 'phuong' | 'dac_khu';

export type VnWard = {
  /** Mã đơn vị hành chính (Cục Thống kê). Đây là thứ lưu xuống DB — KHÔNG lưu tên. */
  code: string;
  name: string;
  type: VnWardType;
  /** Điểm giữa xã. Vắng mặt với tỉnh chưa geocode — đọc cảnh báo ở docblock đầu file. */
  lat?: number;
  lng?: number;
};

export type VnProvince = {
  code: string;
  name: string;
  wards: readonly VnWard[];
};

/** Tỉnh chọn sẵn ở trang khách — nơi quán đang giao hàng. Khách vẫn đổi sang tỉnh khác được. */
export const DEFAULT_PROVINCE_CODE = '24';

export const VN_PROVINCES: readonly VnProvince[] = [
${body}
];

/**
 * Chỉ mục dựng LƯỜI (lần tra đầu tiên mới dựng) chứ không phải \`const\` ở tầng module: một vòng
 * lặp chạy ngay khi import là tác dụng phụ ở tầng module, và bundler không dám bỏ module có tác
 * dụng phụ — app không dùng danh mục vẫn phải tải đủ ${totalWards} dòng.
 */
let wardIndex: Map<string, { ward: VnWard; province: VnProvince }> | null = null;

function index(): Map<string, { ward: VnWard; province: VnProvince }> {
  if (wardIndex === null) {
    wardIndex = new Map();
    for (const province of VN_PROVINCES) {
      for (const ward of province.wards) wardIndex.set(ward.code, { ward, province });
    }
  }
  return wardIndex;
}

/**
 * Tra xã theo mã, kèm tỉnh chứa nó. Trả \`undefined\` khi không có, và mọi nơi gọi PHẢI coi đó là
 * chuyện bình thường chứ không phải lỗi: mã có thể đến từ localStorage của khách cũ, từ đơn đặt
 * trước lần đổi danh mục hành chính, hoặc từ client tự gọi API. Không bao giờ được ném lỗi hay từ
 * chối đơn vì lẽ đó — xã là dữ liệu làm giàu cho địa chỉ, không phải điều kiện hợp lệ của đơn.
 */
export function findWard(
  code: string | null | undefined,
): { ward: VnWard; province: VnProvince } | undefined {
  return code == null ? undefined : index().get(code);
}

export function findProvince(code: string | null | undefined): VnProvince | undefined {
  return code == null ? undefined : VN_PROVINCES.find((p) => p.code === code);
}

export function isValidWardCode(code: string | null | undefined): boolean {
  return findWard(code) !== undefined;
}
`,
  'utf8',
);

console.log(`\n✓ Đã ghi ${OUT}`);
console.log('  Đọc lại diff trước khi commit.');
