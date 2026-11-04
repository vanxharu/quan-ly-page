# Trang quản lý Page (Graph API)

Một file `index.html`, chạy trong trình duyệt, không cần máy chủ. Gồm: đăng/hẹn lịch bài (có ảnh) lên nhiều Page, Inbox + mẫu trả lời, trả lời bình luận, số liệu 28 ngày.

## 1. Cài đặt ứng dụng Meta (một lần)
Trên developers.facebook.com → ứng dụng của bạn:
1. Thêm sản phẩm **Facebook Login for Business** (hoặc Facebook Login).
2. Trong cài đặt Login, bật **Login with the JavaScript SDK** và thêm tên miền nơi đặt trang vào **Allowed Domains for the JavaScript SDK** (bắt buộc HTTPS, ví dụ `ten-ban.github.io`).
3. Để ứng dụng ở chế độ **Development**: chỉ quản trị viên/tester của ứng dụng đăng nhập được, dùng cho Page của chính bạn thì không cần gửi duyệt.

Quyền trang web xin: pages_show_list, pages_read_engagement, pages_manage_posts, pages_messaging, pages_manage_engagement, pages_read_user_content, read_insights, business_management.

## 2. Mở trang
- **Cách nhanh (không cần tên miền):** mở thẳng `index.html`, vào Graph API Explorer (developers.facebook.com/tools/explorer), chọn ứng dụng của bạn, tick các quyền ở trên, bấm Generate Access Token, dán vào ô token → **Dùng token**. Token này hết hạn sau khoảng 1–2 giờ.
- **Cách đầy đủ:** đưa `index.html` lên GitHub Pages / Netlify (HTTPS), nhập App ID → **Lưu App ID** → **Đăng nhập Facebook**.

## 3. Giới hạn của Graph API
- Hẹn giờ phải sau hiện tại ít nhất 10 phút; Facebook tự đăng đúng giờ, không cần mở máy.
- Inbox: chỉ trả lời được trong 24 giờ kể từ tin nhắn cuối của khách. Không tự trả lời khi trang đang đóng (cần máy chủ + webhook).
- Không làm được: chia sẻ vào nhóm, quét UID, thả cảm xúc, bình luận GIF/nhãn dán.
- Mẫu trả lời lưu trong trình duyệt (bấm để chèn, chuột phải để xoá). Token không lưu, đóng tab là phải đăng nhập lại.
