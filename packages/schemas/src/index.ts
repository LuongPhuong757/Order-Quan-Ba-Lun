export * from './errors.js';
export * from './auth.js';
export * from './admin.js';
export * from './menu.js';
export * from './tables.js';
export * from './orders.js';
export * from './ship-fee.js';
export * from './public-store.js';
export * from './public-menu.js';
export * from './public-orders.js';
export * from './public-top-dishes.js';
export * from './public-otp.js';
export * from './admin-online-orders.js';
// Danh mục hành chính — dữ liệu tĩnh, không phải hợp đồng zod như các file trên. Trang khách nên
// nhập thẳng '@order/schemas/vn-address' để 3.321 dòng dữ liệu không lọt vào bundle của app nào
// không dùng tới; ở đây chỉ để BE lấy chung một chỗ với phần còn lại.
export * from './vn-address.js';
