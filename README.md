# Meta Assistant (bản web)

Trang quản lý Page bằng Graph API, chuyển từ tiện ích Chrome "Meta Business Chat Assistant". Mở: https://vanxharu.github.io/quan-ly-page/

- **Tin nhắn:** Hộp thư (một/tất cả Page, lọc, thời gian chờ, tự gắn nhãn, mẫu "/", ảnh, CRM), Mẫu tin, Khách hàng (Kanban), Gửi hàng loạt.
- **Đăng bài:** Lịch đăng (Studio AI, soạn tay, tải ảnh, đăng ngay, xếp giờ tự động, duyệt và hẹn hàng loạt lên Facebook), Đã hẹn trên FB, Cách AI viết.
- **Tương tác:** Bình luận (trả lời, thích, ẩn, xoá), Quét bài viết (CSV).
- **Quản lý:** Tổng quan mọi Page, Lịch nội dung, Số liệu + giờ đăng hiệu quả, Bán hàng, Cài đặt (nhập dữ liệu từ tiện ích, sao lưu, thông báo).

Dữ liệu lưu trên trình duyệt (IndexedDB). Trang không lưu token Facebook.
Giới hạn Graph API: Page chỉ nhắn được trong 24 giờ kể từ tin cuối của khách; không làm được chia sẻ vào nhóm, quét UID, thả cảm xúc lên bài người khác.

Mã nguồn: `index.html`, `css/app.css`, `js/core.js` (đăng nhập, API, lưu trữ, điều hướng), mỗi tab một file `js/*.js`; `js/lib/` chép phần tính toán thuần từ tiện ích.


Studio AI 2.4.0 có tab **Cài đặt** để sửa prompt viết bài, prompt ảnh và trang bắt đầu GPT (chatgpt.com hoặc GPT tuỳ chỉnh). Cài đặt được lưu riêng trong tiện ích, chụp lại khi bắt đầu mỗi lượt; không thay đổi lượt đang chạy. Mặc định ảnh ngang 5:4, số 0899779488, chữ dưới 25%, phù hợp chính sách Facebook. Mỗi cặp bài/ảnh được lưu trước khi làm bài tiếp.

Logo robot dùng trong đầu web, favicon, đầu Studio AI và biểu tượng tiện ích. Avatar Fanpage/khách giữ ảnh riêng. Avatar khách truy cập trực tiếp link Graph /ID/picture của đúng khách/Page, lấy URL CDN để hiển thị; User Profile API làm dự phòng. Bỏ ảnh mặc định, không đưa token vào URL ảnh hiển thị. Cache theo Page+PSID; tự tải khi mở danh sách/hội thoại, ảnh nào về hiện ngay và cập nhật cả đầu hội thoại lẫn tin nhắn; ảnh lỗi tự tải lại, khách chưa có ảnh được thử lại sau ít nhất một phút, không cần nút tải thủ công.

Bộ cập nhật Windows: [tải gói cài một lần](https://vanxharu.github.io/quan-ly-page/meta-assistant-updater.zip). Giải nén và chạy MetaAssistantUpdater.exe, chọn đúng tiện ích đang dùng. Bộ kết nối ghi HKCU cho trình duyệt đã chọn, chỉ chấp nhận đúng ID tiện ích, tải từ gói cố định trên GitHub Pages, sao lưu và ghi đè đúng thư mục cũ. Lần đầu bấm Tải lại ở trang tiện ích; sau đó dùng nút Cập nhật trong Studio AI. Không tự mở rộng quyền, hạ phiên bản hoặc cập nhật giữa lượt tạo. Bản nháp và cấu hình trong storage không bị xoá.

Kiểm thử: `npm --prefix extension/tests test`; Windows: `powershell.exe -NoProfile -File extension/windows-updater/Test.ps1` và `node extension/tests/updater-native.test.cjs`. Biên dịch: `powershell.exe -NoProfile -File extension/windows-updater/Build.ps1` (.NET Framework có sẵn trên Windows).
