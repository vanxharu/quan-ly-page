# Studio AI · Meta Assistant 2.2.2

## Sử dụng

1. Tải lại tiện ích đã giải nén tại `chrome://extensions` (thư mục có `manifest.json`).
2. Mở Meta Assistant, đăng nhập Page. Web đồng bộ tên Page, avatar và các bài gần đây; không chuyển token Facebook vào tiện ích.
3. Bấm biểu tượng tiện ích hoặc **Mở Studio AI** trên web. Nếu trình duyệt chưa hỗ trợ bảng bên cạnh, tiện ích mở cửa sổ nhỏ.
4. Chọn Page và số bài, bấm **Tạo bài & ảnh**. Mặc định dùng ChatGPT nhúng trong tab ChatGPT của tiện ích. Có lựa chọn tab riêng khi cần đăng nhập hoặc khi trình duyệt không hỗ trợ khung.
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

Kiểm tra đầy đủ, gồm hồi quy nhận bài GPT (cần Node.js và thư viện DOM dùng riêng cho kiểm tra):

```powershell
cd extension/tests
npm install --ignore-scripts
npm test
```

### Bản 2.1.2: nhận bài khi GPT trả kết quả chậm

- Không gửi câu dẫn hoặc JSON còn thiếu sang bộ lưu bài. Chỉ tiếp tục sau khi đọc được bài có đúng mã được giao, hoặc thẻ Viết đã có nội dung và hashtag theo yêu cầu.
- Đọc cả các khối Markdown nằm cạnh nhau, khối mã JSON và nội dung trong thẻ Viết; giữ nguyên mã bài và Page.
- Yêu cầu GPT trả JSON trong khối mã của tin nhắn, tránh tự mở Canvas/Viết. Khả năng đọc thẻ Viết vẫn được giữ.
- Báo lỗi bổ sung số lượng/độ dài vùng kết quả và việc có đọc được JSON; không đưa nội dung bài hoặc prompt vào báo lỗi.
- Kiểm tra hồi quy tái hiện đúng lỗi định dạng của bản 2.1.1; bản mới hoàn thành chuỗi hai bài/ảnh, lưu từng cặp trước khi tạo tiếp, kể cả khi GPT tạm ngừng hơn 20 phút mà không có nút Dừng hiển thị.

## Giao diện và khung GPT

- Avatar và theme sáng/tối nhận từ web. URL avatar không giữ các tham số token; ảnh hỏng có chữ viết tắt dự phòng.
- Quy tắc nhúng được đăng ký động qua `declarativeNetRequestWithHostAccess`, chỉ khớp `https://chatgpt.com/`, loại `sub_frame`, và initiator là ID của chính tiện ích. Không áp dụng cho tab GPT độc lập hay trang khác. Quy tắc gỡ header cấm frame/CSP cho tài liệu khung này, tương tự cơ chế của file tham khảo nhưng giới hạn phạm vi.
- Khung và bảng bắt tay qua origin/source cùng mã lượt; background gắn command stream với `documentId`, nonce và mã bài, không yêu cầu iframe có `sender.tab`.
- Đăng nhập, CAPTCHA và quyền của trình duyệt do người dùng thực hiện. Nếu khung chưa phản hồi, UI báo rõ và có nút dùng tab riêng; không tự gửi lặp.
- Thêm kiểm tra: `node extension/tests/embedded-frame.test.cjs`.

## Bản 2.2.0 · Một quy trình Reddit cho mọi Page

- Hai lệnh duy nhất nằm trong `protocol.js` (`POST_PROMPT`, `IMAGE_PROMPT`); web và tiện ích cùng đọc tệp này. Các prompt cũ theo ngày/Page không còn được dùng; dữ liệu cũ không bị xoá.
- Lệnh bài yêu cầu GPT tìm và đọc nguồn marketing công khai trên Reddit, viết mới bằng tiếng Việt và chọn chủ đề khác các bài trước. Không sao chép hoặc tự bịa nguồn. Nếu không đọc được Reddit, GPT trả lỗi rõ ràng để người dùng kiểm tra tìm kiếm web.
- Lệnh ảnh dùng bài vừa viết, ảnh dọc 4:5, 0899779488, chữ dưới 25%, nội dung phù hợp chính sách Facebook.
- `marketingHistoryV1` giữ tối đa 8 bài gần đây mỗi Page, ghi ngay khi nhận được nội dung, không phụ thuộc chuyển bài sang web. Lượt sau và bài tiếp trong cùng lượt nhận đúng lịch sử của Page đó. Web bổ sung những bài đã có trong lịch đăng.
- Bài mới phải có URL bài Reddit dạng HTTPS /comments/; nguồn nằm ngoài nội dung đăng và đi cùng bản nháp khi chuyển web. Xác thực này kiểm tra cấu trúc URL, không thay thế việc người dùng kiểm tra nguồn.
- UI chỉ còn chọn Page có avatar, số bài và kèm ảnh. Tab Chủ đề trên web thành Cách AI viết, hiển thị hai lệnh chung. Giữ sáng/tối, tiến độ, nháp lưu từng cặp và chuyển web theo nút bấm.
- Kiểm tra thêm giao diện, nguồn và lịch sử qua lượt mới, cùng đường chuyển nháp về web bằng `npm test` trong `extension/tests`. Thử nghiệm dùng DOM và dữ liệu mô phỏng, không gửi prompt đến ChatGPT thật.

## Bản 2.2.1 · Tự do sáng tạo và nhận diện Page

- Prompt bài trao quyền chọn góc nhìn, giọng văn, cách mở đầu, cấu trúc, độ dài và việc có tiêu đề hay không; bỏ khoảng số từ và số hashtag cố định. Vẫn dùng nguồn Reddit thật, tránh lặp các bài gần đây và có hashtag phù hợp.
- Prompt ảnh cho phép tự chọn ngôn ngữ thị giác, bố cục, màu và tiêu đề. Giữ tỉ lệ dọc 4:5, 0899779488, chất lượng cao, chữ đúng tiếng Việt, tổng chữ dưới 25%, tuân thủ chính sách Facebook.
- Lịch đăng có avatar Page ngay cạnh ô chọn của từng bài. Khi đổi Page, avatar cập nhật theo; tên trùng được phân biệt bằng 6 chữ số cuối ID. Ảnh lỗi có chữ cái dự phòng; Page của bài đã lên lịch vẫn bị khoá.
- Đã kiểm tra DOM thao tác đổi Page, giữ nguyên ảnh bài, trường hợp Page mất kết nối và avatar lỗi; xem trước giao diện sáng/tối bằng dữ liệu minh hoạ.

## Bản 2.2.2 · Ảnh ngang 5:4

Đổi lệnh tạo ảnh và mô tả tỉ lệ trên web/tiện ích sang ảnh ngang 5:4 (rộng:cao). Giữ phong cách sáng tạo tự do, 0899779488, chữ dưới 25% và tuân thủ chính sách Facebook.

## Bảng chọn Page có avatar trong Lịch đăng

Thay ô chọn HTML chỉ có chữ bằng nút hiện avatar, tên và ID Page. Bấm mở bảng tìm Page: mọi lựa chọn đều có avatar riêng, tên đầy đủ và ID. Tìm theo tên hoặc ID; chọn Page cập nhật đúng bài, giữ nguyên ảnh đính kèm. Các bài đã lên lịch vẫn khoá Page. Đã kiểm tra tìm kiếm, đổi Page, lỗi lưu và ảnh dự phòng.
