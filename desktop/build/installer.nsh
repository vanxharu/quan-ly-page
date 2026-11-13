; Trước khi cài/cập nhật: đóng hẳn app (cả tên mới "Get Helps.exe" lẫn tên cũ "Meta Assistant.exe").
; Chỉ đóng theo tên tiến trình, KHÔNG dùng /T: khi cập nhật, bộ cài là tiến trình con của Get Helps,
; /T sẽ đóng luôn chính bộ cài. Bộ cài có tên khác (Get-Helps-Setup-x.y.z.exe) nên không bị /IM "Get Helps.exe" đóng nhầm.
!macro customInit
  nsExec::Exec 'taskkill /F /IM "Meta Assistant.exe"'
!macroend

; Thay bước kiểm tra mặc định (chỉ thử đóng nhẹ rồi hiện hộp "Get Helps không thể đóng"):
; đóng mạnh mọi tiến trình Get Helps còn chạy ngầm, đợi Windows nhả file rồi cài tiếp.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM "Get Helps.exe"'
  nsExec::Exec 'taskkill /F /IM "Meta Assistant.exe"'
  Sleep 2000
!macroend
