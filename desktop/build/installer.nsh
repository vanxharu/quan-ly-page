; Trước khi cài/cập nhật: đóng hẳn app tên cũ "Meta Assistant" (bộ cài chỉ tự đóng "Get Helps.exe"),
; để không còn tiến trình nào giữ file khiến bộ cài ghi dở (app.asar 0 byte, mất app).
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM "Meta Assistant.exe"'
  nsExec::Exec 'taskkill /F /T /IM "Get Helps.exe"'
  Sleep 1500
!macroend
