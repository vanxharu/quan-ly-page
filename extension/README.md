# Studio AI · Meta Assistant 2.0.0

## Sử dụng

1. Tải lại tiện ích đã giải nén tại `chrome://extensions` (thư mục có `manifest.json`).
2. Mở Meta Assistant, đăng nhập Page. Web đồng bộ tên Page, hồ sơ và chủ đề; không chuyển token Facebook vào tiện ích.
3. Bấm biểu tượng tiện ích hoặc **Mở Studio AI** trên web. Nếu trình duyệt chưa hỗ trợ bảng bên cạnh, tiện ích mở cửa sổ nhỏ.
4. Chọn Page và chủ đề, bấm **Tạo bài & ảnh**. Dùng phiên ChatGPT đang đăng nhập trong tab riêng.
5. Mỗi cặp bài/ảnh được lưu trong tiện ích trước khi tạo cặp tiếp. Đóng bảng không làm mất bản nháp. Chuyển các bản nháp sang web trước khi bắt đầu lượt mới.
6. Bấm nút **Đưa sang web** để mở Meta Assistant và nhận bài vào **Lịch đăng · Chờ duyệt**, giữ đúng Page. Website xác nhận sau khi ghi bản nháp, chuyển lại không tạo bản trùng. Không tự đăng.

## Mã nguồn

`chatgpt-connector/` là nguồn của gói `chatgpt-connector.zip` ở thư mục gốc repository. Bảng bên cạnh nằm trong `sidepanel.html`, `sidepanel.css`, `sidepanel.js`; `background.js` giữ công việc và chuyển nháp; `chatgpt-agent.js` đọc/ghi tab ChatGPT.

Bộ nhận dạng đã tham khảo `gaming-mode-1.0.29.110.zip` người dùng cung cấp: dấu vai trò `data-content-search-unit-key`, thẻ `chatgpt-writing-block`, phân biệt ô chat với Write/Canvas, gắn mã yêu cầu và đối chiếu trạng thái trước/sau khi gửi. Các đoạn tham khảo được dùng làm dữ liệu đối chiếu, không chạy tiện ích ZIP.

## Kiểm tra

Chạy từ thư mục gốc repository:

```powershell
node extension/tests/studio-background.test.cjs
```

Kiểm tra đồng bộ danh mục không chứa token, xác thực lệnh bảng AI, lưu từng bài tại tiện ích, chuyển theo nút bấm, giới hạn đúng tab web nhận, xác nhận nhận bài và giữ nháp sau tải lại.
