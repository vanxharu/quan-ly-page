/* Giao diện tiếng Anh (cho video App Review của Meta và người dùng nước ngoài).
 * Bật: ?lang=en trên địa chỉ, menu "⋯" › English, hoặc nút trên màn đăng nhập. Lưu ở localStorage "uiLang".
 * Cách làm: mã giao diện vẫn viết tiếng Việt; tệp này dịch chữ hiển thị (nội dung chữ, placeholder, title, aria-label,
 * hộp confirm/alert) theo bảng khớp nguyên câu + vài mẫu có số. Nội dung khách / bài viết không khớp bảng nên giữ nguyên.
 * shortcut: chỉ dịch các màn chính (đăng nhập, chọn Page, Hộp thư, Bình luận, Quét bài, Đăng bài, Lịch, Tổng quan, Số liệu, Cài đặt);
 * màn khác còn tiếng Việt, thêm câu vào EN khi cần. */
(() => {
  let saved = ''; try { saved = localStorage.getItem('uiLang') || ''; } catch {}
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'vi') { saved = q; try { localStorage.setItem('uiLang', q); } catch {} }
  const I18N = window.I18N = { lang: saved === 'en' ? 'en' : 'vi',
    set(l) { try { localStorage.setItem('uiLang', l); } catch {} const u = new URL(location.href); u.searchParams.delete('lang'); location.href = u.href; } };
  const EN = {
    // Đăng nhập, thanh trên, chọn Page
    'Quản lý Page bằng Graph API: Hộp thư, mẫu tin, khách hàng, đăng & hẹn lịch bài, bình luận, số liệu, bán hàng.': 'Manage your Facebook Pages with the Graph API: inbox, saved replies, customers, publishing & scheduling posts, comments, insights and sales.',
    'Đăng nhập bằng Facebook': 'Log in with Facebook', 'Đang tải Facebook SDK…': 'Loading Facebook SDK…', 'Tuỳ chọn khác': 'More options',
    'Lưu App ID': 'Save App ID', 'Dùng token': 'Use token', 'Chưa đăng nhập': 'Not logged in', 'Dán User Access Token (Graph API Explorer)': 'Paste a User Access Token (Graph API Explorer)',
    'Đang kiểm tra phiên Facebook…': 'Checking Facebook session…', 'Bấm nút để đăng nhập.': 'Click the button to log in.',
    'Không tải được Facebook SDK. Dùng "Tuỳ chọn khác" để dán token.': 'Could not load the Facebook SDK. Use "More options" to paste a token.',
    'Đăng nhập bị huỷ.': 'Login cancelled.', 'Chưa đăng nhập xong. Bấm lại để thử.': 'Login not finished. Click again to retry.',
    'Đang tải danh sách Page…': 'Loading your Pages…', 'Tài khoản không quản lý Page nào, hoặc chưa cấp quyền pages_show_list.': 'This account manages no Pages, or pages_show_list was not granted.',
    'Phiên đăng nhập được ghi nhớ trên trình duyệt này. Bấm Đăng xuất để xoá phiên.': 'Your session is remembered in this browser. Click Log out to clear it.',
    'Đã mở Facebook ở cột bên phải. Đăng nhập (nếu được hỏi) rồi bấm Tiếp tục, xong app tự vào.': 'Facebook opened in the right pane. Log in if asked, then click Continue.',
    'Phiên đăng nhập Facebook đã hết hạn.': 'Your Facebook session has expired.', 'Đăng nhập lại': 'Log in again', 'Đóng': 'Close',
    'Chuyển chế độ Sáng / Tối': 'Toggle light / dark mode', 'Chuyển sang giao diện sáng': 'Switch to light mode', 'Chuyển sang giao diện tối': 'Switch to dark mode',
    'Đang dùng giao diện tối · Chuyển sang sáng': 'Dark mode · switch to light', 'Đang dùng giao diện sáng · Chuyển sang tối': 'Light mode · switch to dark',
    'Đăng xuất khỏi trang': 'Log out', 'Điều hướng chức năng': 'Navigation', 'Mở danh mục chức năng': 'Open menu', 'Đóng danh mục': 'Close menu',
    'Quay lại': 'Back', 'Tiếp': 'Forward', 'Tìm kiếm (Ctrl+E)': 'Search (Ctrl+E)', 'Tìm khách hoặc chức năng': 'Search customers or features',
    'Khách': 'Customers', 'Chức năng': 'Features', 'Không tìm thấy khách hay chức năng nào.': 'No customers or features found.',
    'Cài đặt và nhiều hơn': 'Settings and more', 'Giao diện sáng': 'Light mode', 'Giao diện tối': 'Dark mode', 'Khung ngầm': 'Background panes',
    'Kiểm tra cập nhật': 'Check for updates', 'Dùng thanh tiêu đề Windows': 'Use Windows title bar', 'Dùng thanh trên kiểu Teams': 'Use Teams-style top bar',
    'Các chức năng': 'Features', 'Tìm chức năng…': 'Find a feature…', 'Tìm chức năng': 'Find a feature', 'Các nhóm chức năng': 'Feature groups',
    'Không gian quản lý Page': 'Page workspace', 'Page đang chọn': 'Selected Pages', 'Page không rõ': 'Unknown Page',
    'Chỉ Page này': 'Only this Page', 'Tìm tên hoặc ID Page…': 'Search Page name or ID…', 'Tìm Page': 'Find Page', 'Chọn hết': 'Select all', 'Bỏ hết': 'Clear all',
    'Huỷ': 'Cancel', 'Áp dụng': 'Apply', 'Chọn ít nhất 1 Page.': 'Select at least one Page.', 'Thêm vào Mục yêu thích': 'Add to favorites',
    // Menu
    'Tin nhắn': 'Messages', 'Trò chuyện': 'Chat', 'Hộp thư': 'Inbox', 'Mẫu tin': 'Saved replies', 'Khách hàng': 'Customers', 'Gửi hàng loạt': 'Bulk send',
    'Đăng bài': 'Publishing', 'Lịch đăng': 'Post planner', 'Lịch nội dung': 'Content calendar', 'Cách AI viết': 'AI writing style',
    'Tự động': 'Automation', 'Kế hoạch': 'Plan', 'Từ khoá': 'Keywords', 'Bình luận tự động': 'Auto comment replies', 'Kịch bản': 'Flows',
    'Menu & lời chào': 'Menu & greeting', 'Nhật ký & đơn bot': 'Bot log & orders', 'Tương tác': 'Engagement', 'Bình luận': 'Comments', 'Quét bài viết': 'Post scan',
    'Quản lý': 'Manage', 'Tổng quan': 'Overview', 'Số liệu': 'Insights', 'Bán hàng': 'Sales', 'Dịch vụ': 'Services', 'Cài đặt': 'Settings',
    'Tất cả cuộc trò chuyện, trong một không gian.': 'All conversations in one place.', 'Những câu trả lời hay, luôn sẵn sàng.': 'Good answers, always ready.',
    'Theo sát từng khách hàng, từ lần đầu đến đơn tiếp theo.': 'Follow every customer, from the first message to the next order.',
    'Chăm sóc đúng nhóm khách, đúng thời điểm.': 'Reach the right customers at the right time.', 'Sắp xếp nội dung và duyệt lịch đăng theo cách của bạn.': 'Plan content and approve your posting schedule.',
    'Bài đã đăng, bài hẹn trên Facebook và hàng chờ: xem theo danh sách, tuần hoặc tháng.': 'Published posts, posts scheduled on Facebook and the queue: by list, week or month.',
    'Giữ cảm hứng và định hướng nội dung cho từng Page.': 'Keep a content direction for each Page.', 'Thiết lập câu trả lời phù hợp với từng từ khoá.': 'Set a reply for each keyword.',
    'Tiếp nhận khách hàng ngay từ bình luận đầu tiên.': 'Welcome customers from their first comment.', 'Kết nối từng bước để tạo hành trình trò chuyện.': 'Build conversation flows step by step.',
    'Một lời chào rõ ràng. Một khởi đầu dễ dàng.': 'A clear greeting. An easy start.', 'Xem hoạt động của bot và những đơn hàng mới.': 'See bot activity and new orders.',
    'Lắng nghe và phản hồi các cuộc thảo luận.': 'Read and reply to comments on your Page posts.', 'Khám phá những nội dung đang được quan tâm.': 'Explore what your audience engages with.',
    'Một góc nhìn chung cho tất cả Page đang quản lý.': 'One view across all the Pages you manage.', 'Bức tranh nội dung của bạn, theo từng ngày.': 'Your content, day by day.',
    'Hiểu hiệu quả nội dung để quyết định bước tiếp theo.': 'Understand content performance to decide what to post next.', 'Quản lý đơn hàng và theo dõi kết quả kinh doanh.': 'Manage orders and track sales results.',
    'Đơn dịch vụ (like, follow…) tạo qua API web dịch vụ: giá gốc, giá bán, lời.': 'Service orders via the provider API: cost, price, profit.', 'Thiết lập không gian làm việc phù hợp với bạn.': 'Set up your workspace.',
    // Hộp thư
    'Chưa chốt': 'Open', 'Đã chốt': 'Closed', 'Tất cả': 'All', 'Chưa đọc': 'Unread', 'Chưa trả lời': 'Unanswered', 'Báo lỗi ảnh': 'Report image issue',
    'Chưa chọn hội thoại': 'No conversation selected', 'Chọn một hội thoại bên trái để xem tin nhắn.': 'Select a conversation on the left to read the messages.',
    'Tải lại hội thoại': 'Reload conversations', 'Tìm khách hoặc nội dung tin…': 'Search customer or message…', 'Tìm hội thoại': 'Search conversations',
    'Lọc khách theo giai đoạn chốt đơn': 'Filter customers by order stage', 'Chưa có đơn, hoặc có báo giá chưa chuyển tiền': 'No order yet, or a quote not yet paid',
    'Đã có đơn / đã chuyển tiền (không có báo giá nào đang chờ)': 'Has an order / paid (no pending quote)', 'Nhắn hàng loạt: remarketing / AI trả lời khách đang chờ': 'Bulk messaging',
    'Nhắn hàng loạt': 'Bulk messaging', 'Thêm bộ lọc (nền tảng, nhãn)': 'More filters (platform, label)', 'Thêm bộ lọc': 'More filters', 'Lọc theo nền tảng': 'Filter by platform',
    'Mọi nền tảng': 'All platforms', 'Chỉ Business Suite': 'Business Suite only', 'Chỉ Zalo': 'Zalo only', 'Lọc theo nhãn': 'Filter by label', 'Thêm': 'More',
    'Tải báo lỗi ảnh khách trên phiên hiện tại': 'Download customer image report', 'Khách đã nhắn 1 tin chưa đọc': 'Customer sent 1 unread message',
    'Khách đang chờ trả lời': 'Customer is waiting for a reply', 'Về danh sách khách': 'Back to conversations', 'Giai đoạn · Đơn · Nhãn': 'Stage · Order · Labels',
    'Hiện thanh khách hàng': 'Show customer panel', 'Mẫu tin (gõ / trong ô nhập)': 'Saved replies (type / in the box)', 'Đính kèm ảnh': 'Attach image',
    'Tạo đơn dịch vụ cho khách này (mở khung bên trái, vẫn xem được tin nhắn)': 'Create a service order for this customer',
    'Gợi ý trả lời bằng AI (ChatGPT trong app)': 'Suggest a reply with AI', 'Gợi ý trả lời bằng AI': 'Suggest a reply with AI',
    'Nhập tin trả lời… (gõ / để chọn mẫu)': 'Type a reply… (type / for saved replies)', 'Nội dung trả lời': 'Reply text', 'Gửi': 'Send',
    'Enter gửi · Shift+Enter xuống dòng · / chọn mẫu · quá 24 giờ: tự gửi kèm thẻ Nhân viên trả lời (tới 7 ngày)': 'Enter to send · Shift+Enter for a new line · / for saved replies · replies are sent within Messenger\'s standard messaging window',
    'Đang tải tin nhắn…': 'Loading messages…', 'Đang gửi…': 'Sending…', 'Đã gửi.': 'Sent.', 'Đã gửi': 'Sent', 'Hôm nay': 'Today', 'Hôm qua': 'Yesterday', 'bạn': 'you',
    'Nguồn: Business Suite / API': 'Source: Business Suite / API', 'Xem trang cá nhân': 'View profile', 'Ghi chú': 'Notes', 'Nhãn': 'Labels', 'Giai đoạn': 'Stage', 'Đơn hàng': 'Orders',
    'Khách mới': 'New customer', 'Thêm nhãn': 'Add label', 'Thêm ghi chú…': 'Add a note…', 'Lưu': 'Save', 'Xoá': 'Delete', 'Sửa': 'Edit', 'Tải thêm': 'Load more', 'Tải tin cũ hơn': 'Load older messages',
    'tiếp nhận': 'new lead', 'đủ tiêu chuẩn': 'qualified', 'đã chuyển đổi': 'converted', 'không hoạt động': 'inactive', 'khách hàng mới': 'new customer', 'hỏi giá': 'asked price', 'có sđt': 'has phone', 'Có SĐT': 'Has phone', 'Bỏ nhãn': 'Remove label',
    // Bình luận
    'Bài gần đây': 'Recent posts', 'Tải lại': 'Reload', 'Chỉ bình luận Page chưa trả lời': 'Only comments the Page has not replied to',
    'Chọn một bài bên trái để xem bình luận.': 'Select a post on the left to see its comments.', 'Đang tải bài…': 'Loading posts…', 'bình luận': 'comments',
    '(không có chữ)': '(no text)', 'Chưa có bài.': 'No posts yet.', 'Trả lời bình luận…': 'Reply to this comment…', 'Nhập nội dung trả lời.': 'Type a reply first.',
    'Đã trả lời bình luận.': 'Reply posted.', 'Nhắn riêng': 'Private reply', 'Gửi nội dung ô trả lời vào Messenger của người bình luận (1 lần/bình luận, trong 7 ngày)': 'Send the reply text privately to the commenter in Messenger (once per comment, within 7 days)',
    'Nhập nội dung tin nhắn riêng vào ô trả lời.': 'Type the private message in the reply box.', 'người bình luận': 'the commenter', 'Đã nhắn riêng': 'Private reply sent',
    'Bình luận này đã được nhắn riêng rồi (Meta chỉ cho 1 lần).': 'A private reply was already sent for this comment (Meta allows one).', 'Người dùng': 'User', 'Đã ẩn': 'Hidden',
    '👍 Bỏ thích': '👍 Unlike', '👍 Thích': '👍 Like', 'Hiện': 'Unhide', 'Ẩn': 'Hide', 'Xoá bình luận này?': 'Delete this comment?', 'Đã huỷ.': 'Cancelled.', 'Chèn mẫu': 'Insert saved reply', 'Mẫu…': 'Saved reply…',
    'Mọi bình luận đã được Page trả lời.': 'The Page has replied to every comment.', 'Bài này chưa có bình luận.': 'This post has no comments yet.', 'Đang tải bình luận…': 'Loading comments…',
    'Bình luận trên bài của Page': 'Comments on the Page\'s post', 'Bài viết': 'Post',
    // Quét bài
    'Từ': 'From', 'Đến': 'To', 'đến': 'to', 'Tối đa/Page': 'Max per Page', 'Quét các Page': 'Scan Pages', 'Quét bài này': 'Scan this post', 'Chỉ đọc được bài của các Page đang kết nối.': 'Only posts of your connected Pages can be read.',
    'Chọn Page, khoảng ngày rồi bấm Quét các Page, hoặc dán link một bài.': 'Choose Pages and a date range, then click Scan Pages, or paste a post link.',
    'Dán link hoặc ID một bài viết của Page bạn quản lý…': 'Paste the link or ID of a post on a Page you manage…', 'Link bài viết': 'Post link',
    'Lấy link bài của Page bất kỳ': 'Collect post links from any Page', 'Kéo lên thanh dấu trang': 'Drag to the bookmarks bar', '📋 Chép link bài FB': '📋 Copy FB post links',
    // Đăng bài / lịch
    'Soạn tay': 'Write manually', '✦ Mở Studio AI': '✦ Open Studio AI', 'Khung giờ & số bài': 'Time windows & posts per day', 'Khung giờ tương tác': 'Engagement time windows', 'Bài/ngày': 'Posts/day',
    '⭐ Đăng vào giờ vàng (giờ Page có nhiều tương tác nhất)': '⭐ Post at golden hours (the Page\'s most engaged hours)', 'Mặc định thêm nút Gửi tin nhắn cho bài mới lên lịch': 'Add a Send Message button to new scheduled posts by default',
    'Giờ đăng chọn ngẫu nhiên trong khung, bước 5 phút; cùng Page cách nhau ≥ 1 giờ, khác Page cách nhau ≥ 15 phút (giống tiện ích).': 'Times are picked randomly inside the windows in 5-minute steps; ≥ 1 hour apart on the same Page, ≥ 15 minutes across Pages.',
    'Ngày đăng': 'Posting days', 'Bỏ chọn': 'Clear', 'Không chọn ngày nào = xếp trong 14 ngày tới, theo ngày trong tuần của từng Page.': 'No day selected = schedule over the next 14 days using each Page\'s weekdays.',
    'Dò bài thiếu': 'Find missing posts', '🔎 Dò bài thiếu': '🔎 Find missing posts', '📅 Lịch hẹn tất cả Page': '📅 Schedule of all Pages', 'Đối chiếu với Meta': 'Check against Meta',
    'Mỗi Page phải có đủ "Bài/ngày" (ô Khung giờ & số bài) mỗi ngày. Tính cả bài hẹn trên Meta, bài đã đăng hôm nay và bài đã có giờ trong danh sách.': 'Each Page should have its "Posts/day" every day, counting posts scheduled on Meta, posts published today and timed posts in the list.',
    'Xếp giờ tự động': 'Auto-assign times', '✓ Duyệt tất cả (nháp + lỗi)': '✓ Approve all (drafts + failed)', 'Xoá tất cả bài': 'Delete all posts', 'Lên lịch tất cả bài đã duyệt': 'Schedule all approved posts',
    'Chưa có bài trong lịch. Bấm Tạo bài bằng AI, chọn Page và số bài để bắt đầu.': 'No posts yet. Write a post or create posts with AI to start.',
    'Lịch hẹn thật trên Meta của mọi Page đang chọn, gộp theo ngày': 'Real Meta schedule of all selected Pages, by day', 'So danh sách với các bài đã hẹn thật trên Meta (kể cả hẹn trong Business Suite) để tránh đăng trùng': 'Compare the list with posts already scheduled on Meta to avoid duplicates',
    'T2': 'Mon', 'T3': 'Tue', 'T4': 'Wed', 'T5': 'Thu', 'T6': 'Fri', 'T7': 'Sat', 'CN': 'Sun',
    'Chủ Nhật': 'Sunday', 'Thứ Hai': 'Monday', 'Thứ Ba': 'Tuesday', 'Thứ Tư': 'Wednesday', 'Thứ Năm': 'Thursday', 'Thứ Sáu': 'Friday', 'Thứ Bảy': 'Saturday',
    'Bài riêng cho': 'Post for', 'Page của bản nháp chưa kết nối': 'The draft\'s Page is not connected', 'Bài này giữ đúng Page đã gán.': 'This post stays on its assigned Page.', 'Chọn Page ở thanh trên cùng.': 'Choose Pages in the top bar.',
    'Hẹn giờ trên Facebook': 'Schedule on Facebook', 'Đăng ngay': 'Publish now', 'Đang lưu…': 'Saving…', 'Lưu vào danh sách duyệt': 'Save for approval', 'Tiếp tục bản nháp': 'Continue draft',
    'Đang lưu nháp…': 'Saving draft…', 'Đã lưu nháp tự động.': 'Draft saved automatically.', 'Chưa lưu được nháp. Giữ trang mở hoặc sao chép nội dung.': 'Could not save the draft. Keep the page open or copy your text.',
    'Ảnh bài viết': 'Post image', 'Bỏ ảnh': 'Remove image', 'Soạn bài thủ công': 'Write a post', 'Soạn bài': 'Write a post', 'Đóng trình soạn bài': 'Close editor', 'Nội dung': 'Content',
    'Viết nội dung bài đăng…': 'Write your post…', 'Nội dung, ảnh và giờ hẹn được tự lưu nháp trên trình duyệt này.': 'Text, image and schedule time are saved as a draft in this browser.',
    'Ảnh (tuỳ chọn)': 'Image (optional)', 'Hẹn giờ (tuỳ chọn)': 'Schedule time (optional)', 'Thêm nút': 'Add button', 'Gửi tin nhắn': 'Send Message',
    '· Bài có ảnh: tạo qua tài khoản quảng cáo (không tốn tiền) để giữ ảnh + nút; bài hẹn giờ do máy chủ bot đăng.': '· Image posts with a button are created through your ad account (free).',
    'Dùng các Page đang chọn': 'Use the selected Pages', 'Để trống giờ hẹn để đăng ngay hoặc lưu nháp cho Lịch đăng tự xếp giờ.': 'Leave the time empty to publish now, or save it for the planner to schedule.',
    'Không đọc được ảnh. Chọn lại tệp giúp bạn nhé.': 'Could not read the image. Please choose the file again.', 'Đã khôi phục bản nháp trước. Bấm Tiếp tục bản nháp để mở.': 'Your previous draft was restored. Click Continue draft to open it.',
    'Giờ hẹn không hợp lệ.': 'Invalid schedule time.', 'Chưa có nội dung hoặc ảnh.': 'Add text or an image first.', 'Chưa chọn Page hoặc Page của bản nháp chưa kết nối.': 'No Page selected.',
    'Giờ hẹn phải sau hiện tại ít nhất 10 phút.': 'The schedule time must be at least 10 minutes from now.', 'đã hẹn': 'scheduled', 'đã đăng': 'published',
    'Xem lịch hẹn trên Meta ↗': 'View schedule on Meta ↗', 'Xem bài ↗': 'View post ↗', 'Xem trên Meta ↗': 'View on Meta ↗', 'Chưa gửi được bài:': 'Could not publish:',
    'Đã lưu bản nháp. Xem và duyệt ngay trong Lịch đăng.': 'Draft saved. Review and approve it in the planner.', 'Chưa lưu được bản nháp:': 'Could not save the draft:',
    'Quá giờ': 'Overdue', 'Sắp đăng': 'Due soon', 'Đã hẹn': 'Scheduled', 'Hẹn từ app (Lịch đăng)': 'Scheduled from this app', 'Hẹn trong Business Suite / hẹn tay trên Facebook': 'Scheduled in Business Suite / on Facebook',
    'Từ app': 'From app', 'Ngoài app': 'Outside app', 'Sắp đăng (≤ 2 giờ)': 'Due soon (≤ 2 h)', 'Quá giờ, FB chưa đăng': 'Overdue, not published', 'Hẹn từ app': 'From app', 'Hẹn ngoài app': 'Outside app',
    'đã quá giờ': 'overdue', 'Bài viết đã lên lịch': 'Scheduled posts', 'Bài đã lên lịch': 'Scheduled posts', 'Các bài Facebook đang giữ để tự đăng trên các Page đang chọn.': 'Posts Facebook will publish automatically on the selected Pages.',
    'Huỷ đã chọn': 'Cancel selected', 'Huỷ tất cả': 'Cancel all', 'Tìm theo nội dung bài viết…': 'Search post text…', 'Tìm bài': 'Find post', 'Lọc theo Page': 'Filter by Page', 'Kiểu xem': 'View',
    'Danh sách': 'List', 'Tuần': 'Week', 'Tháng': 'Month', 'Không có bài hẹn nào để huỷ.': 'No scheduled posts to cancel.', 'Lỗi:': 'Error:', 'bài đang hiện': 'posts shown', 'bài đã chọn': 'selected posts',
    'Giờ mới phải sau hiện tại ít nhất 10 phút.': 'The new time must be at least 10 minutes from now.', 'Đã đổi giờ đăng:': 'Time changed:', 'Chọn bài': 'Select post', 'Bấm để xem đầy đủ': 'Click to see all',
    '(Bài chỉ có ảnh)': '(Image only)', 'Quá giờ · Facebook chưa đăng': 'Overdue · Facebook has not published', 'Đổi giờ': 'Reschedule', 'Đăng bài này ngay bây giờ?': 'Publish this post now?', 'Đã đăng.': 'Published.',
    'bài hẹn này': 'this scheduled post', '‹ Tuần trước': '‹ Previous week', 'Tuần sau ›': 'Next week ›', 'Chọn tất cả bài đang hiện': 'Select all shown posts', 'Thời gian đăng': 'Publish time',
    'Quá giờ nhưng Facebook chưa đăng · nên Huỷ hoặc Đổi giờ': 'Overdue but not published · cancel or reschedule', 'Không có bài khớp bộ lọc': 'No posts match the filter',
    'Chưa có bài nào được lên lịch': 'No scheduled posts', 'Đổi Page hoặc xoá từ khoá tìm kiếm.': 'Change the Page or clear the search.', 'Soạn bài hoặc dùng Lịch đăng để hẹn giờ; bài sẽ hiện ở đây.': 'Write a post or use the planner to schedule; posts will show here.',
    'Đang tải bài đã lên lịch…': 'Loading scheduled posts…', 'Lên lịch': 'Schedule', 'Đăng': 'Publish', 'hẹn giờ': 'schedule', 'đăng': 'publish',
    // Tổng quan, số liệu
    'Cập nhật': 'Refresh', 'Tổng quan các Page đang chọn': 'Overview of the selected Pages', 'Người theo dõi': 'Followers', 'Hội thoại chưa đọc': 'Unread conversations', 'Bài hẹn trên FB': 'Scheduled on FB',
    'Bài trong Lịch đăng': 'Posts in planner', 'Nhắc hẹn chưa xong': 'Open reminders', 'ngày chưa đăng': 'days without a post', 'chưa có bài': 'no posts yet', 'Theo dõi': 'Followers',
    'Hẹn FB': 'FB scheduled', 'Hàng chờ': 'Queue', 'Bài gần nhất:': 'Latest post:', 'chưa có': 'none', 'Lượt xem': 'Views', 'Người xem': 'Viewers', 'Số liệu 28 ngày qua': 'Insights, last 28 days',
    'Giờ đăng hiệu quả (bài 90 ngày qua)': 'Best posting hours (posts in the last 90 days)', '(28 ngày)': '(28 days)', 'Ngày': 'Day', 'Chưa có bài trong 90 ngày qua.': 'No posts in the last 90 days.',
    'Giờ tốt nhất (≥ 2 bài):': 'Best hours (≥ 2 posts):', 'Chưa đủ dữ liệu (cần ≥ 2 bài cùng giờ).': 'Not enough data (needs ≥ 2 posts at the same hour).',
    'Lượt xem (28 ngày)': 'Views (28 days)', 'Người xem (28 ngày)': 'Viewers (28 days)', 'Tương tác (28 ngày)': 'Engagement (28 days)', 'Người theo dõi (28 ngày)': 'Followers (28 days)',
    // Cài đặt
    '🔒 Bảo mật app': '🔒 App security', 'Đang đọc…': 'Loading…', 'Mật khẩu & tự khoá…': 'Password & auto-lock…', 'Khoá ngay (Ctrl+L)': 'Lock now (Ctrl+L)', 'Dữ liệu': 'Data',
    'Dữ liệu (mẫu tin, khách, đơn, lịch đăng…) lưu trên trình duyệt này. Dùng máy/trình duyệt khác thì xuất sao lưu rồi nhập ở đó.': 'Data (saved replies, customers, orders, planner…) is stored in this browser. Export a backup to use it on another device.',
    'Nhập dữ liệu (từ tiện ích hoặc file sao lưu)': 'Import data (from the extension or a backup)', 'Xuất sao lưu': 'Export backup', 'Xoá dữ liệu trên trình duyệt này': 'Delete data in this browser',
    'Xoá hết mẫu tin, khách, đơn, lịch đăng… trên trình duyệt này? Nên xuất sao lưu trước.': 'Delete all saved replies, customers, orders, planner… in this browser? Export a backup first.',
    'Lấy dữ liệu từ tiện ích: mở bảng tiện ích, bấm nút "Xuất dữ liệu sang trang web" (cạnh nút Cài đặt), rồi nhập file vừa tải về ở đây.': 'To import from the extension: open it, click "Export data to the web app", then import the downloaded file here.',
    'Chính sách quyền riêng tư': 'Privacy Policy', 'Điều khoản': 'Terms', 'Xoá dữ liệu': 'Data deletion', 'Chưa đặt mật khẩu: ai mở máy cũng vào được app.': 'No password set: anyone using this computer can open the app.',
    'Hộp thư & thông báo': 'Inbox & notifications', 'Cảnh báo khách chờ quá (phút)': 'Warn when a customer waits more than (minutes)', 'Kiểm tra tin mới mỗi (phút)': 'Check for new messages every (minutes)',
    'Tự gắn nhãn theo lời khách': 'Auto-label from customer messages', 'Báo tin nhắn mới khi trang đang mở': 'Notify new messages while the page is open', 'Quy tắc gắn nhãn (mỗi dòng: Nhãn: từ khoá 1, từ khoá 2)': 'Label rules (one per line: Label: keyword 1, keyword 2)',
    'Gắn nhãn khi khách gửi số điện thoại:': 'Label when a customer sends a phone number:', 'Giờ yên lặng từ': 'Quiet hours from', 'Lưu cài đặt': 'Save settings', 'Cho phép trình duyệt hiện thông báo': 'Allow browser notifications',
    'Trình duyệt đã cho phép thông báo.': 'Browser notifications are allowed.', 'Trình duyệt đang chặn thông báo: trang sẽ hiện thông báo trong trang.': 'The browser blocks notifications; they will show inside the page.', 'Đã lưu cài đặt.': 'Settings saved.',
    '☁ Lưu theo tài khoản Facebook': '☁ Saved to your Facebook account', 'Đồng bộ ngay': 'Sync now', 'Đang đồng bộ…': 'Syncing…', 'Chưa đăng nhập Facebook': 'Not logged in to Facebook',
    'Tin mẫu, gói bán, bảng giá, API key dịch vụ, tài khoản ngân hàng, Telegram & kế hoạch tự động, thông tin shop cho AI, cài đặt hộp thư và lịch đăng tự lưu theo tài khoản Facebook đang đăng nhập. Đăng nhập ở máy khác hoặc sau khi cài lại app sẽ tự khôi phục.': 'Your saved replies and settings are stored for the Facebook account you are logged in with, and restored on any other device.',
    '🤖 Máy chủ bot (Supabase)': '🤖 Bot server (Supabase)', 'Bot (trả lời từ khoá, bình luận, kịch bản, menu) chạy trên máy chủ 24/7. Đăng nhập để cấu hình. Nhân viên dùng tài khoản riêng.': 'The bot (keyword replies, comments, flows, menu) runs on the server 24/7. Log in to configure it. Staff use their own accounts.',
    'Mật khẩu (≥ 8 ký tự)': 'Password (≥ 8 characters)', 'Đăng nhập': 'Log in', 'Tạo tài khoản chủ (lần đầu)': 'Create owner account (first time)', 'Đang xử lý…': 'Working…',
    'Đã tạo tài khoản. Mở email để xác nhận rồi đăng nhập.': 'Account created. Confirm via email, then log in.', 'Đang đọc trạng thái máy chủ…': 'Reading server status…', 'Đăng xuất máy chủ': 'Log out of server',
    'Đang kết nối…': 'Connecting…', '✓ Máy chủ đã có App Secret của ứng dụng Meta.': '✓ The server has the Meta app secret.', 'bot đang nhận tin': 'receiving messages', 'chưa nhận tin': 'not receiving',
    'Chưa có Page nào kết nối với máy chủ.': 'No Page is connected to the server yet.', 'Lưu token Page dài hạn trên máy chủ và đăng ký nhận tin nhắn, bình luận.': 'Stores a long-lived Page token on the server and subscribes the Page to message and comment webhooks.',
    'Chưa đăng nhập máy chủ bot': 'Not logged in to the bot server', 'Bot chạy trên máy chủ Supabase. Đăng nhập máy chủ ở Quản lý › Cài đặt rồi quay lại đây.': 'The bot runs on the Supabase server. Log in under Manage › Settings, then come back.',
    'Mở Cài đặt': 'Open Settings', 'Đang kiểm tra phiên máy chủ…': 'Checking server session…', 'Không tải được thư viện Supabase.': 'Could not load the Supabase library.',
    'Meta đang giới hạn yêu cầu của ứng dụng. Web đã tạm dừng gọi Facebook; bạn có thể thử lại sau': 'Meta is rate-limiting the app. Calls to Facebook are paused; try again after',
    'Nhận bài từ tiện ích: Cần tiện ích 2.5.0 để tạo từng bài và lưu chờ duyệt. Cập nhật tiện ích rồi tải lại trang.': 'Studio AI extension 2.5.0 or later is needed to import posts.',
    'Chưa có hội thoại.': 'No conversations yet.', 'Đang tải…': 'Loading…', 'Đã lưu.': 'Saved.', 'Đã xoá.': 'Deleted.',
    'Đơn & dịch vụ': 'Orders & services',
    'Tin nhắn đọc gần đây nhất': 'Last read message',
    'Nhập UID Facebook của khách để hiện ảnh đại diện': "Enter the customer's Facebook UID to show their picture",
    'Đọc lại tin của hội thoại': 'Reload this conversation',
    'Đọc lại tin': 'Reload messages',
    'Đơn': 'Orders',
    '+ nhãn': '+ label',
    'Nhắc hẹn': 'Reminders',
    'Đơn, nhắc hẹn, ghi chú': 'Orders, reminders, notes',
    '👥 Quét người tương tác (cảm xúc, bình luận, chia sẻ, số bạn bè / follow) của bài bất kỳ: chỉ có trong app máy tính Get Helps.': '👥 Scanning the people who engaged with any post is only available in the Get Helps desktop app.',
    '· Page đối thủ, nhóm, trang cá nhân công khai': '· competitor Pages, groups, public profiles',
    'Kéo nút này lên thanh dấu trang (Ctrl+Shift+B để hiện thanh):': 'Drag this button to your bookmarks bar (Ctrl+Shift+B shows the bar):',
    'Mở Page cần lấy trên facebook.com, tự cuộn xuống tới khi hiện đủ bài.': 'Open the Page on facebook.com and scroll until the posts you need are shown.',
    'Bấm nút “📋 Chép link bài FB” trên thanh dấu trang → bấm Chép. Cuộn thêm rồi bấm lại để gom tiếp (không trùng).': 'Click “📋 Copy FB post links” on the bookmarks bar → Copy. Scroll and click again to collect more (no duplicates).',
    'Dán vào ô dưới để lọc trùng, xuất CSV, hoặc quét số liệu nếu là bài của Page bạn quản lý.': 'Paste below to remove duplicates, export CSV, or scan insights for posts of Pages you manage.',
    'Dán loạt link bài viết vào đây (mỗi dòng một link, hoặc dán cả đoạn văn có link)…': 'Paste post links here (one per line, or any text containing links)…',
    'Mặc định mọi Page': 'Default for all Pages',
    'Mọi Page': 'All Pages',
    'Mọi trạng thái': 'All statuses',
    'Chờ duyệt': 'Pending approval',
    'Đã duyệt': 'Approved',
    'Đang lên lịch…': 'Scheduling…',
    'Đã hẹn trên FB': 'Scheduled on FB',
    'Chờ đăng (tiện ích)': 'Waiting (extension)',
    'Đã đăng': 'Published',
    'Lỡ giờ': 'Missed',
    'Lỗi': 'Error',
    'Chưa có đơn, nhắc hẹn hay ghi chú.': 'No orders, reminders or notes yet.',
    'Giai đoạn…': 'Stage…',
    'Tiếp nhận': 'New lead',
    'Đủ tiêu chuẩn': 'Qualified',
    'Đã chuyển đổi': 'Converted',
    'Không hoạt động': 'Inactive',
    'Đơn…': 'Order…',
    'Đã đặt hàng': 'Ordered',
    'Đã thanh toán': 'Paid',
    'Đã vận chuyển': 'Shipped',
    'Đã đặt lịch': 'Booked',
    'Ảnh hoặc video (tuỳ chọn)': 'Image or video (optional)',
    'Chọn Page': 'Choose Pages', 'Tất cả Page': 'All Pages', 'Ảnh ·': 'Image ·', 'Chữ ·': 'Text ·', 'Hôm nay ·': 'Today ·', 'Ngày mai ·': 'Tomorrow ·'
  };
  const P = [ // [mẫu tiếng Việt (cả câu), thay bằng]
    [/^Đã kết nối (\d+) Page$/, 'Connected to $1 Pages'], [/^(\d+) đã chọn$/, '$1 selected'], [/^Tất cả (\d+) Page$/, 'All $1 Pages'],
    [/^⏳ (\d+) phút$/, '⏳ $1 min'], [/^⏳ (\d+) giờ$/, '⏳ $1 h'], [/^⏳ (\d+) ngày$/, '⏳ $1 d'], [/^(\d+) phút$/, '$1 min'], [/^(\d+) giờ$/, '$1 h'], [/^(\d+) ngày$/, '$1 d'],
    [/^Bài viết đã lên lịch \((\d+)\)$/, 'Scheduled posts ($1)'], [/^Tất cả Page \((\d+)\)$/, 'All Pages ($1)'], [/^Huỷ đã chọn \((\d+)\)$/, 'Cancel selected ($1)'], [/^Đang hiện (\d+)\/(\d+) bài$/, 'Showing $1/$2 posts'],
    [/^(\d+) bài$/, '$1 posts'], [/^Tổng quan (\d+) Page · cập nhật (.+)$/, 'Overview of $1 Pages · updated $2'], [/^💬 (.+): (\d+) hội thoại chưa đọc$/, '💬 $1: $2 unread conversations'],
    [/^🕒 (.+): đã (\d+) ngày chưa đăng$/, '🕒 $1: no post for $2 days'], [/^🕒 (.+): chưa có bài$/, '🕒 $1: no posts yet'], [/^⚠ (.+): (\d+) bài lỗi\/lỡ giờ trong Lịch đăng$/, '⚠ $1: $2 failed/missed posts in the planner'],
    [/^Số liệu 28 ngày qua · cộng (\d+) Page$/, 'Insights, last 28 days · $1 Pages combined'], [/^Số liệu 28 ngày qua · (.+)$/, 'Insights, last 28 days · $1'], [/^Người theo dõi \((\d+) Page\)$/, 'Followers ($1 Pages)'],
    [/^Đang đọc số liệu của (\d+) Page…$/, 'Reading insights of $1 Pages…'], [/^(\d+)h \(TB (\d+)\)$/, '$1:00 (avg $2)'], [/^(T\d|CN) (\d+)h: (\d+) bài, TB (\d+) tương tác$/, (m, d, hh, n, a) => `${EN[d] || d} ${hh}:00: ${n} posts, avg ${a} engagement`],
    [/^Đặt làm khung giờ Lịch đăng cho (\d+) Page đang chọn$/, 'Use as planner time windows for the $1 selected Pages'], [/^Tính từ (\d+) bài: tương tác = cảm xúc \+ bình luận \+ chia sẻ\. Ô càng đậm, trung bình càng cao\.$/, 'Based on $1 posts: engagement = reactions + comments + shares. Darker = higher average.'],
    [/^(T\d|CN) (\d+\/\d+)$/, (m, d, x) => `${EN[d] || d} ${x}`], [/^Tắt thông báo cho Page \((\d+) đang tắt\)$/, 'Mute notifications for Pages ($1 muted)'],
    [/^Đã lưu theo (.+) \(máy này \+ máy chủ\) · (.+)$/, 'Saved for $1 (this device + server) · $2'], [/^Đã đăng nhập: (.+)$/, 'Logged in: $1'],
    [/^Kết nối (\d+) Page đang chọn với máy chủ$/, 'Connect the $1 selected Pages to the server'], [/^Đã kết nối (\d+)\/(\d+) Page\.$/, 'Connected $1/$2 Pages.'],
    [/^Lỗi: (.+)$/, 'Error: $1'], [/^Đã nhắn riêng cho (.+)\.$/, 'Private reply sent to $1.'], [/^Dùng cho (\d+) Page đang chọn$/, 'For the $1 selected Pages'],
    [/^✓ (.+): đã hẹn (.+) \((.+)\)$/, '✓ $1: scheduled $2 ($3)'], [/^✓ (.+): đã đăng \((.+)\)$/, '✓ $1: published ($2)'], [/^Đã lưu (\d+) bài nháp vào danh sách duyệt\.$/, 'Saved $1 drafts for approval.'],
    [/^còn (\d+) phút$/, 'in $1 min'], [/^còn (\d+) giờ$/, 'in $1 h'], [/^còn (\d+) ngày$/, 'in $1 days'], [/^Hôm nay · (.+)$/, 'Today · $1'], [/^Ngày mai · (.+)$/, 'Tomorrow · $1'],
    [/^Meta Assistant (.+) · bấm để kiểm tra cập nhật$/, 'Meta Assistant $1 · click to check for updates'], [/^Phiên bản (.+)$/, 'Version $1']
  ];
  const tr = s => {
    const t = String(s).trim(); if (!t) return s;
    let r = EN[t];
    if (r === undefined) for (const [re, to] of P) if (re.test(t)) { r = t.replace(re, to); break; }
    return r === undefined ? s : String(s).replace(t, r);
  };
  I18N.t = s => I18N.lang === 'en' ? tr(s) : s;
  if (I18N.lang !== 'en') return;
  document.documentElement.lang = 'en';
  const SKIP = 'script,style,textarea,[contenteditable],[data-no-i18n],.msg-text'; // không dịch nội dung khách / bài viết
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function walk(root) {
    if (root.nodeType === 3) { const p = root.parentElement; if (p && !p.closest(SKIP)) { const v = tr(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; } return; }
    if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
    for (const el of [root, ...root.querySelectorAll('*')]) for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v) { const n = tr(v); if (n !== v) el.setAttribute(a, n); } }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const p = n.parentElement; if (!p || p.closest(SKIP)) continue; const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
  }
  const run = () => { walk(document.body); new MutationObserver(ms => { for (const m of ms) {
    if (m.type === 'characterData') walk(m.target);
    else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v) { const n = tr(v); if (n !== v) m.target.setAttribute(m.attributeName, n); } }
    else m.addedNodes.forEach(walk);
  } }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); };
  if (document.body) run(); else document.addEventListener('DOMContentLoaded', run);
  for (const k of ['alert', 'confirm', 'prompt']) { const f = window[k].bind(window); window[k] = (msg, ...a) => f(msg == null ? msg : tr(msg), ...a); }
})();
