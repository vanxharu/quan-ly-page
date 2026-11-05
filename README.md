# Meta Assistant (bản web)

Trang quản lý Page bằng Graph API, chuyển từ tiện ích Chrome "Meta Business Chat Assistant". Mở: https://vanxharu.github.io/quan-ly-page/

- **Tin nhắn:** Hộp thư (một/tất cả Page, lọc, thời gian chờ, tự gắn nhãn, mẫu "/", ảnh, CRM), Mẫu tin, Khách hàng (Kanban), Gửi hàng loạt.
- **Đăng bài:** Đăng Fanpage, Lịch đăng (xếp giờ tự động, duyệt, hẹn hàng loạt lên Facebook), Đã hẹn trên FB, Cách AI viết.
- **Tương tác:** Bình luận (trả lời, thích, ẩn, xoá), Quét bài viết (CSV).
- **Quản lý:** Tổng quan mọi Page, Lịch nội dung, Số liệu + giờ đăng hiệu quả, Bán hàng, Cài đặt (nhập dữ liệu từ tiện ích, sao lưu, thông báo).

Dữ liệu lưu trên trình duyệt (IndexedDB). Trang không lưu token Facebook.
Giới hạn Graph API: Page chỉ nhắn được trong 24 giờ kể từ tin cuối của khách; không làm được chia sẻ vào nhóm, quét UID, thả cảm xúc lên bài người khác.

Mã nguồn: `index.html`, `css/app.css`, `js/core.js` (đăng nhập, API, lưu trữ, điều hướng), mỗi tab một file `js/*.js`; `js/lib/` chép phần tính toán thuần từ tiện ích.
