// 這裡放的是「唯讀、限制過」的公開 API 金鑰,不是帳號密碼。
// 記得在 Google Cloud Console 把這組金鑰限制成:
//   - 應用程式限制:HTTP 參照網址 → https://<你的帳號>.github.io/*
//   - API 限制:只允許 Google Drive API

const API_KEY = "貼上你的 Google API 金鑰";
const ROOT_FOLDER_ID = "貼上「遊戲復盤」資料夾的 ID";
