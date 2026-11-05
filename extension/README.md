# Studio AI · Meta Assistant 2.1.0

## Sử dụng

1. Tải lại tiện ích đã giải nén tại `chrome://extensions` (thư mục có `manifest.json`).
2. Mở Meta Assistant, đăng nhập Page. Web đồng bộ tên Page, hồ sơ và chủ đề; không chuyển token Facebook vào tiện ích.
3. Bấm biểu tượng tiện ích hoặc **Mở Studio AI** trên web. Nếu trình duyệt chưa hỗ trợ bảng bên cạnh, tiện ích mở cửa sổ nhỏ.
4. Chọn Page và chủ đề, bấm **Tạo bài & ảnh**. Mặc định dùng ChatGPT nhúng trong tab ChatGPT của tiện ích. Có lựa chọn tab riêng khi cần đăng nhập hoặc khi trình duyệt không hỗ trợ khung.
5. Mỗi cặp bài/ảnh được lưu trong tiện ích trước khi tạo cặp tiếp. Chuyển giữa ba tab không tải lại iframe. Giữ bảng mở khi GPT nhúng đang tạo; đóng bảng sẽ ngắt lượt đang chạy nhưng không mất bản nháp đã nhận. Chuyển các bản nháp sang web trước khi bắt đầu lượt mới.
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

## Giao diện và khung GPT

- Avatar và theme sáng/tối nhận từ web. URL avatar không giữ các tham số token; ảnh hỏng có chữ viết tắt dự phòng.
- Quy tắc nhúng được đăng ký động qua `declarativeNetRequestWithHostAccess`, chỉ khớp `https://chatgpt.com/`, loại `sub_frame`, và initiator là ID của chính tiện ích. Không áp dụng cho tab GPT độc lập hay trang khác. Quy tắc gỡ header cấm frame/CSP cho tài liệu khung này, tương tự cơ chế của file tham khảo nhưng giới hạn phạm vi.
- Khung và bảng bắt tay qua origin/source cùng mã lượt; background gắn command stream với `documentId`, nonce và mã bài, không yêu cầu iframe có `sender.tab`.
- Đăng nhập, CAPTCHA và quyền của trình duyệt do người dùng thực hiện. Nếu khung chưa phản hồi, UI báo rõ và có nút dùng tab riêng; không tự gửi lặp.
- Thêm kiểm tra: `node extension/tests/embedded-frame.test.cjs`.
