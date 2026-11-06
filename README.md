# Meta Assistant (bản web)

Trang quản lý Page bằng Graph API, chuyển từ tiện ích Chrome "Meta Business Chat Assistant". Mở: https://vanxharu.github.io/quan-ly-page/

- **Tin nhắn:** Hộp thư (một/tất cả Page, lọc, thời gian chờ, tự gắn nhãn, mẫu "/", ảnh, CRM), Mẫu tin, Khách hàng (Kanban), Gửi hàng loạt.
- **Đăng bài:** Lịch đăng (Studio AI, soạn tay, tải ảnh, đăng ngay, xếp giờ tự động, duyệt và hẹn hàng loạt lên Facebook), Đã hẹn trên FB, Cách AI viết.
- **Tương tác:** Bình luận (trả lời, thích, ẩn, xoá), Quét bài viết (CSV).
- **Quản lý:** Tổng quan mọi Page, Lịch nội dung, Số liệu + giờ đăng hiệu quả, Bán hàng, Cài đặt (nhập dữ liệu từ tiện ích, sao lưu, thông báo).

Dữ liệu lưu trên trình duyệt (IndexedDB). Trang không lưu token Facebook.
Giới hạn Graph API: Page chỉ nhắn được trong 24 giờ kể từ tin cuối của khách; không làm được chia sẻ vào nhóm, quét UID, thả cảm xúc lên bài người khác.

Mã nguồn: `index.html`, `css/app.css`, `js/core.js` (đăng nhập, API, lưu trữ, điều hướng), mỗi tab một file `js/*.js`; `js/lib/` chép phần tính toán thuần từ tiện ích.


Studio AI 2.5.0 có tab **Cài đặt** để sửa prompt viết bài, prompt ảnh và trang bắt đầu GPT (chatgpt.com hoặc GPT tuỳ chỉnh). Cài đặt được lưu riêng trong tiện ích, chụp lại khi bắt đầu mỗi lượt; không thay đổi lượt đang chạy. Mặc định ảnh ngang 5:4, số 0899779488, chữ dưới 25%, phù hợp chính sách Facebook. Mỗi cặp bài/ảnh được lưu trước khi làm bài tiếp.

Logo robot dùng trong đầu web, favicon, đầu Studio AI và biểu tượng tiện ích. Avatar Fanpage/khách giữ ảnh riêng. Avatar khách truy cập trực tiếp link Graph /ID/picture của đúng khách/Page, lấy URL CDN để hiển thị; User Profile API làm dự phòng. Bỏ ảnh mặc định, không đưa token vào URL ảnh hiển thị. Cache theo Page+PSID; tự tải khi mở danh sách/hội thoại, ảnh nào về hiện ngay và cập nhật cả đầu hội thoại lẫn tin nhắn; ảnh lỗi tự tải lại, khách chưa có ảnh được thử lại sau ít nhất một phút, không cần nút tải thủ công.

Bộ cập nhật Windows: [tải gói cài một lần](https://vanxharu.github.io/quan-ly-page/meta-assistant-updater.zip). Giải nén và chạy MetaAssistantUpdater.exe, chọn đúng tiện ích đang dùng. Bộ kết nối ghi HKCU cho trình duyệt đã chọn, chỉ chấp nhận đúng ID tiện ích, tải từ gói cố định trên GitHub Pages, sao lưu và ghi đè đúng thư mục cũ. Lần đầu bấm Tải lại ở trang tiện ích; sau đó dùng nút Cập nhật trong Studio AI. Không tự mở rộng quyền, hạ phiên bản hoặc cập nhật giữa lượt tạo. Bản nháp và cấu hình trong storage không bị xoá.

Kiểm thử: `npm --prefix extension/tests test`; Windows: `powershell.exe -NoProfile -File extension/windows-updater/Test.ps1` và `node extension/tests/updater-native.test.cjs`. Biên dịch: `powershell.exe -NoProfile -File extension/windows-updater/Build.ps1` (.NET Framework có sẵn trên Windows).


Avatar khách (2.4.2): hoàn toàn tự động, không có hộp nhập link hay gắn từng khách. Web dùng ảnh do API Messenger trả về, thử trực tiếp hồ sơ Messenger, đọc link/picture từ node khách và các ID người gửi được Facebook trả trong đúng hội thoại. UID chỉ được lưu khi có bằng chứng từ dữ liệu Facebook; không ghép theo tên. Liên kết/ID khách đã cung cấp trước đó có thể lưu riêng tại %LOCALAPPDATA%\MetaAssistantUpdater\customer-identities.json (không đưa vào mã nguồn công khai). Bộ kết nối đọc trang công khai để xác minh UID/ảnh, không lấy cookie hoặc token từ trình duyệt; giữ nguyên PSID dùng nhắn tin. Ảnh được tự đồng bộ và thử lại có giới hạn. Khách bị Facebook giới hạn thông tin có thể vẫn chưa có ảnh; lỗi gốc được giữ để chẩn đoán, không yêu cầu người dùng nhập link.


Cập nhật 2.4.3 phân biệt phiên bản tệp đã cài, bộ nền đang chạy và giao diện đang mở. Khi tệp đã mới nhưng bộ nền/giao diện còn cũ, vẫn tự nạp lại. Nhãn phiên bản lấy từ mã giao diện thực sự đang chạy; chỉ báo mới nhất khi các phiên bản khớp. Trước cập nhật lưu phần sửa nháp, prompt, Page, số bài và lựa chọn ảnh. Lỗi tạo bài cũ vẫn nằm trong ChatGPT/Bản nháp, không lẫn với thông báo cập nhật trên tab Soạn bài. Bộ Windows hỗ trợ yêu cầu cập nhật từ bản cũ để hoàn tất nạp lại mà không cần giải nén lại.


Ảnh 2.5.0: yêu cầu avatar không còn chặn hàng đợi lệnh tạo bài/giao diện. Bộ kết nối tạo thumbnail PNG 128×128 từ ảnh Facebook đã xác minh, giữ bản riêng trên máy và chép cache vào thư mục tiện ích. Bộ nền chỉ đọc cache này cho đúng ID rồi chuyển ảnh trực tiếp về web, không đưa cache vào gói công khai hay mở cho website khác. Ảnh cache được hiển thị trước khi chờ các khách/API còn lại; trường hợp mất kết nối native hoặc ảnh CDN không nhúng được vẫn dùng bản đã lưu. Cache tối đa 850 KB, giữ ba ngày phía giao diện; lưu riêng, không có token/cookie.


KẾT NỐI 2.5.0: khi cập nhật/nạp lại tiện ích, bộ nền kiểm tra cầu nối của các tab Meta Assistant. Tab mất cầu nối hoặc còn bản cầu nối cũ được tải lại tự động để nạp kết nối mới; tab đang kết nối và tab GPT được giữ. Có giới hạn chống tải lại liên tục, giữ nháp đã lưu trong web/tiện ích. Web tạm dừng yêu cầu khi kết nối mất, chỉ báo một lần và tự tiếp tục nhận bài/ảnh khi cầu nối mới sẵn sàng.


Avatar hộp thư: giữ bằng chứng ID người gửi từ lịch sử đầy đủ khi làm mới danh sách chỉ có một tin cuối; bằng chứng mới bỏ thời gian chờ của ảnh lỗi và được thử lại sau yêu cầu đang chạy. Tách đọc trường ảnh/link và người tham gia/người gửi khi một trường không được cấp quyền. Thử ảnh từ ID người gửi trong đúng hội thoại trước trang công khai; không tìm hay ghép khách theo tên. Chỉ sửa web, dùng với tiện ích 2.5.0 hiện có.


BÁO LỖI AVATAR 2.5.0: tự ghi phản hồi API theo Page/ID khách vào inbox-avatar-diagnostic.json trong thư mục bộ kết nối Windows. Chỉ gồm ID, có/thiếu ảnh và mã/bước/thông báo lỗi đã làm sạch; không có token, cookie, nội dung hội thoại hoặc ảnh. Tệp riêng ở trên máy, không nằm trong gói công khai. Dùng để tìm nguyên nhân khách còn thiếu ảnh trên phiên thực tế; đây không phải xác nhận đã lấy được mọi avatar.


STUDIO 2.5.0: bỏ chặn tổng 6 bài/lượt và 3 bài/Page. Tiếp tục tạo từng bài → ảnh → lưu nháp trước bài kế tiếp. Bản nháp lớn lưu trong IndexedDB; Chrome storage giữ con trỏ nhỏ, ảnh xem theo nhu cầu. Chuyển toàn bộ số bài sang web theo các phần nhỏ có xác nhận lưu, không cắt còn 6 bài. Chỉ dọn bản lưu của lượt cũ sau khi tất cả bài đã được web xác nhận và bắt đầu lượt mới.
Lên lịch có ảnh: tải ảnh chưa xuất bản, gắn mã ảnh vào bài feed được hẹn giờ. Không chuyển sang bài chỉ có chữ khi tải ảnh lỗi; bài AI cần ảnh bị chặn duyệt/lên lịch nếu chưa nhận ảnh. Nhận lại ảnh có thể sửa nháp lỗi thiếu ảnh mà không đè nội dung người dùng đã sửa. Ảnh xem trước hỗ trợ attachments của Facebook.
Avatar: dùng profile_pic của PSID trước; từng khách tự chuyển nguồn dự phòng, không đợi cả nhóm. Ảnh nhận được lưu ngay. Yêu cầu ảnh Facebook có ngắt chờ 12 giây để thử nguồn khác; không đổi thời gian chờ GPT. Mã 100/33 trên /picture không được dùng để kết luận mọi khách đều bị chặn. Bộ Windows báo hostVersion và tính năng để phân biệt mã đang chạy với phiên bản tệp tiện ích.


HẠN MỨC META (rate-limit2): Hộp thư không còn đọc lại hội thoại đang mở mỗi 8 giây; chỉ đọc lại khi danh sách báo có tin mới. Danh sách và báo tin mới dùng một bộ hẹn giờ và một bản lưu chung cho mọi tab (mở nhiều tab không nhân số lần gọi); Tổng quan dùng lại bản lưu này. Page đã nối máy chủ webhook được quét thưa (5 phút danh sách, 10 phút báo tin) và tải lại ngay khi webhook báo. Lỗi giới hạn của một Page (32/800xx) chỉ khoá Page đó theo estimated_time_to_regain_access, không khoá cả ứng dụng; khi header x-business-use-case-usage, x-app-usage hoặc x-page-usage báo từ 75%, việc chạy nền (quét, avatar) tạm giãn 15 phút, gửi tin và đăng bài vẫn chạy. Mô phỏng 10 Page × 2 tab: khoảng 300 lần gọi/giờ (trước khoảng 1.400 lần mỗi tab), 120 lần/giờ khi có webhook.
AVATAR THIẾU QUYỀN: khi Meta trả 100/33 cho hồ sơ của từ 3 khách khác nhau trên cùng Page (ứng dụng chưa có Business Asset User Profile Access hoặc chưa Live), web ngừng hỏi ảnh khách của Page đó 6 giờ, nhớ qua F5/tab mới, không tốn hạn mức 40 lần/giờ. Gửi tin, đăng bài không bị ảnh hưởng. Một ảnh tải thành công sẽ tự bỏ trạng thái tạm ngừng.
