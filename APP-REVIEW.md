# Hồ sơ App Review cho ứng dụng INBOX (1062977306762250)

Mục tiêu: hiện tên + avatar của mọi khách và cho bot trả lời mọi khách (không chỉ người có vai trò trong app).

## 1. Điền ở Cài đặt ứng dụng › Thông tin cơ bản
- URL Chính sách quyền riêng tư: https://vanxharu.github.io/quan-ly-page/privacy.html
- URL Điều khoản dịch vụ: https://vanxharu.github.io/quan-ly-page/terms.html
- Hướng dẫn xoá dữ liệu (URL): https://vanxharu.github.io/quan-ly-page/data-deletion.html
- Biểu tượng ứng dụng 1024×1024, Danh mục: Business and Pages, Email liên hệ.
- Miền ứng dụng: vanxharu.github.io

## 2. Xác minh doanh nghiệp
business.facebook.com › Cài đặt › Trung tâm bảo mật › Xác minh doanh nghiệp (giấy phép kinh doanh / MST của công ty). Liên kết app INBOX với hồ sơ doanh nghiệp đó.

## 3. Quyền cần xin Advanced Access (App Review › Quyền và tính năng)
Dán phần tiếng Anh vào ô "Tell us how you'll use this permission".

**pages_messaging**
> Our app is an inbox tool used by our own business to manage customer conversations on Facebook Pages we own. Page admins log in with Facebook Login for Business, open the Inbox tab, read the conversation and reply to the customer within the 24-hour standard messaging window. The server also sends automated keyword replies configured by the Page admin. Without this permission we cannot reply to customers.

**Business Asset User Profile Access** (tính năng)
> We display the customer's name and profile picture next to each conversation in the Inbox so the Page admin can recognise who they are talking to. The data is only shown to the Page admin and is not stored or shared.

**pages_manage_metadata**
> Used to subscribe our app to the Page's webhooks (messages, messaging_postbacks, message_echoes, feed) so our server receives new messages and comments in real time, and to set the Messenger greeting, Get Started button and persistent menu.

**pages_read_engagement / pages_read_user_content**
> Used to list the Page's posts and the comments people leave on them in the Comments tab, so the admin can read and moderate them.

**pages_manage_engagement**
> Used to reply to, hide and delete comments on the Page's posts, both manually by the admin and by the automatic rule that hides comments containing phone numbers or links.

**pages_manage_posts**
> Used in the Post tab to publish and schedule posts (text and images) to Pages the admin manages.

**pages_show_list, business_management**
> Used after login to list the Pages (including Pages owned through Business Manager) the admin manages so they can choose which Pages to work with.

## 4. Video quay màn hình (một video, 2–4 phút, quay bằng OBS / Xbox Game Bar)
1. Mở https://vanxharu.github.io/quan-ly-page/, bấm Đăng nhập Facebook, cho thấy hộp thoại cấp quyền.
2. Chọn Page ở góc trên.
3. Tab Tin nhắn › Hộp thư: mở hội thoại (thấy tên + avatar), gõ tin trả lời, bấm Gửi; mở Messenger trên điện thoại thứ hai để thấy tin đến.
4. Tab Tự động: tạo quy tắc từ khoá "giá", nhắn "giá" từ tài khoản khác → bot trả lời.
5. Tab Tương tác › Bình luận: trả lời một bình luận, ẩn một bình luận có số điện thoại.
6. Tab Đăng bài: đăng thử một bài.
7. Cài đặt › Máy chủ bot: bấm Kết nối Page (minh hoạ pages_manage_metadata).

Ghi chú cho người duyệt (Notes): "This app is for our own business Pages only. Test account: use the reviewer test user added under App Roles; it is an admin of the test Page <tên Page>."

## 5. Sau khi được duyệt
App Dashboard › Xuất bản (Publish) → chuyển sang Live. Không cần sửa code.
