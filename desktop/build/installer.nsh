; Trước khi cài/cập nhật: đóng app tên cũ "Meta Assistant" nếu còn chạy (đổi tên nên bộ cài không tự đóng nó).
; KHÔNG dùng /T và KHÔNG đóng "Get Helps.exe" ở đây: khi cập nhật, bộ cài là tiến trình con của Get Helps,
; /T sẽ đóng luôn chính bộ cài (app tắt mà không cài được bản mới). Bộ cài mặc định tự lo việc đóng "Get Helps.exe".
!macro customInit
  nsExec::Exec 'taskkill /F /IM "Meta Assistant.exe"'
!macroend
