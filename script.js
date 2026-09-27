// 遊戲復盤網站 — 從 Google Drive 自動讀取影片並顯示
// 需要 config.js 提供 API_KEY 與 ROOT_FOLDER_ID

const state = {
  folders: [],
  searchTerm: "",
};

function driveListURL(query, fields) {
  const params = new URLSearchParams({
    q: query,
    fields: `files(${fields})`,
    key: API_KEY,
    pageSize: "1000",
  });
  return `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Drive API 回應錯誤 (${res.status})`);
  }
  return res.json();
}

// 取得「遊戲復盤」底下所有子資料夾(不論命名格式)
async function fetchAllFolders() {
  const q = `'${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const data = await fetchJSON(driveListURL(q, "id,name"));
  return data.files || [];
}

// 資料夾名稱符合 YYYY-MM-DD 就回傳這個日期;不符合回傳 null
function folderDateKey(folderName) {
  return /^\d{4}-\d{2}-\d{2}$/.test(folderName) ? folderName : null;
}

// 從 ISO 時間字串取出 YYYY-MM-DD
function toDateKey(isoString) {
  return isoString.slice(0, 10);
}

const VIDEO_FIELDS =
  "id,name,createdTime,modifiedTime,thumbnailLink,videoMediaMetadata(width,height)";

// 取得單一資料夾內的影片(也用來查詢「遊戲復盤」根目錄本身)
async function fetchVideosInFolder(folderId) {
  const q = `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`;
  const data = await fetchJSON(driveListURL(q, VIDEO_FIELDS));
  return (data.files || []).sort(compareVideos);
}

// 檔名開頭如果是 2026/09/27/14:30 這種格式,拿來當排序時間、也拿來當分類日期
const NAME_DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2})\/(\d{2}):(\d{2})/;

function nameDateMatch(video) {
  return video.name.match(NAME_DATE_RE);
}

// 影片檔名開頭有日期格式就回傳 YYYY-MM-DD,沒有回傳 null
function videoNameDateKey(video) {
  const m = nameDateMatch(video);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function extractSortTime(video) {
  const m = nameDateMatch(video);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    const t = new Date(`${y}-${mo}-${d}T${h}:${mi}:00`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return new Date(video.createdTime).getTime();
}

function compareVideos(a, b) {
  return extractSortTime(b) - extractSortTime(a);
}

// 決定一支影片要歸到哪一天:
// 1. 所在資料夾名稱是 YYYY-MM-DD → 用資料夾的日期(根目錄本身沒有這一層,folderDate 傳 null)
// 2. 影片檔名開頭是日期格式 → 用檔名的日期
// 3. 都沒有 → 用影片自己上傳到 Google Drive 的日期
function resolveDateKey(video, folderDate) {
  return folderDate || videoNameDateKey(video) || toDateKey(video.createdTime);
}

function formatDateLabel(dateKey) {
  return dateKey.replace(/-/g, "/");
}

async function loadAll() {
  const root = document.getElementById("date-groups");
  root.innerHTML = '<p class="status">正在讀取 Google Drive…</p>';

  try {
    // 子資料夾,以及直接放在「遊戲復盤」根目錄本身的影片,兩者要同時查
    const [folders, rootVideos] = await Promise.all([
      fetchAllFolders(),
      fetchVideosInFolder(ROOT_FOLDER_ID),
    ]);

    if (folders.length === 0 && rootVideos.length === 0) {
      root.innerHTML =
        '<p class="status">找不到任何資料夾或影片,請確認 Folder ID 與分享權限是否正確。</p>';
      return;
    }

    // dateKey (YYYY-MM-DD) -> videos[]
    const dateMap = new Map();

    const addVideo = (video, folderDate) => {
      const key = resolveDateKey(video, folderDate);
      if (!dateMap.has(key)) dateMap.set(key, []);
      dateMap.get(key).push(video);
    };

    for (const video of rootVideos) addVideo(video, null);

    await Promise.all(
      folders.map(async (folder) => {
        const videos = await fetchVideosInFolder(folder.id);
        const namedDate = folderDateKey(folder.name);
        for (const video of videos) addVideo(video, namedDate);
      })
    );

    for (const videos of dateMap.values()) videos.sort(compareVideos);

    state.folders = [...dateMap.entries()]
      .filter(([, videos]) => videos.length > 0)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([name, videos]) => ({ name, videos }));

    render();
  } catch (err) {
    root.innerHTML = `<p class="status error">讀取失敗:${err.message}</p>`;
    console.error(err);
  }
}

function render() {
  const root = document.getElementById("date-groups");
  const term = state.searchTerm.trim().toLowerCase();
  root.innerHTML = "";

  let anyVisible = false;

  for (const folder of state.folders) {
    const videos = term
      ? folder.videos.filter((v) => v.name.toLowerCase().includes(term))
      : folder.videos;

    if (videos.length === 0) continue;
    anyVisible = true;

    const section = document.createElement("section");
    section.className = "date-group";

    const header = document.createElement("div");
    header.className = "date-group-header";

    const heading = document.createElement("h2");
    heading.textContent = formatDateLabel(folder.name);
    header.appendChild(heading);

    const count = document.createElement("span");
    count.className = "date-group-count";
    count.textContent = `${videos.length} 支影片`;
    header.appendChild(count);

    section.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "video-grid";
    for (const video of videos) {
      grid.appendChild(buildVideoCard(video));
    }
    section.appendChild(grid);

    root.appendChild(section);
  }

  if (!anyVisible) {
    root.innerHTML = '<p class="status">沒有符合的影片。</p>';
  }
}

// 相容各瀏覽器前綴,請求把該元素(連同裡面的 iframe)全螢幕顯示
function requestFullscreenOn(el) {
  const req =
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.mozRequestFullScreen ||
    el.msRequestFullscreen;
  if (!req) return;
  const result = req.call(el);
  if (result && result.catch) result.catch(() => {});
}

// 縮圖網址預設只有 220px 寬,換成大一點的尺寸比較清楚
function largeThumbnail(url) {
  return url.replace(/=s\d+$/, "=s640");
}

// 卡片會先顯示縮圖(有的話)或黑底 + 播放圖示,點擊後才建立 iframe 播放器
function buildVideoCard(video) {
  const card = document.createElement("div");
  card.className = "video-card";

  const frame = document.createElement("div");
  frame.className = "video-frame";

  // 有拍攝解析度資料的話,格子比例跟著影片的真實比例走,避免直式/橫式影片被裁掉
  const meta = video.videoMediaMetadata;
  if (meta && meta.width && meta.height) {
    frame.style.aspectRatio = `${meta.width} / ${meta.height}`;
  }

  if (video.thumbnailLink) {
    const thumb = document.createElement("img");
    thumb.className = "video-thumb";
    thumb.src = largeThumbnail(video.thumbnailLink);
    thumb.loading = "lazy";
    thumb.alt = "";
    frame.appendChild(thumb);
  }

  const playIcon = document.createElement("div");
  playIcon.className = "play-placeholder";
  playIcon.textContent = "▶";
  frame.appendChild(playIcon);

  const nameMatch = nameDateMatch(video);
  if (nameMatch) {
    const chip = document.createElement("span");
    chip.className = "clip-time";
    chip.textContent = `${nameMatch[4]}:${nameMatch[5]}`;
    frame.appendChild(chip);
  }

  // 建立播放器 iframe,取代縮圖/播放圖示
  const embedPlayer = () => {
    frame.classList.add("is-playing");
    frame.innerHTML = `<iframe src="https://drive.google.com/file/d/${video.id}/preview" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>`;
  };

  // 縮圖、中間播放圖示:在原本的小窗格內嵌入播放,大小、位置都跟卡片一致
  frame.addEventListener("click", embedPlayer, { once: true });

  const title = document.createElement("p");
  title.className = "video-title";
  title.textContent = video.name;

  // 下方這顆按鈕:直接全螢幕播放
  const button = document.createElement("button");
  button.className = "play-button";
  button.textContent = "⛶ 全螢幕播放";
  button.addEventListener(
    "click",
    () => {
      embedPlayer();
      requestFullscreenOn(frame);
    },
    { once: true }
  );

  card.append(frame, title, button);
  return card;
}

document.getElementById("search-input").addEventListener("input", (e) => {
  state.searchTerm = e.target.value;
  render();
});

// ---------- 上傳影片(用擁有者自己的 Google 帳號 OAuth 登入) ----------
// 需要 config.js 額外提供 CLIENT_ID(Google Cloud Console 建立的 OAuth 用戶端 ID)
// 沒有設定 CLIENT_ID 的話,直接隱藏上傳按鈕,網站其他功能照常運作
const uploadButton = document.getElementById("upload-button");
const uploadInput = document.getElementById("upload-input");
const uploadStatus = document.getElementById("upload-status");

const hasClientId = typeof CLIENT_ID !== "undefined" && CLIENT_ID;

if (!hasClientId) {
  uploadButton.hidden = true;
} else {
  let tokenClient = null;
  let accessToken = null;

  function getTokenClient() {
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: "https://www.googleapis.com/auth/drive.file",
        callback: () => {}, // 每次請求時會覆寫成當下要用的 callback
      });
    }
    return tokenClient;
  }

  // 跳出 Google 登入/授權畫面,拿到可以呼叫 Drive API 的 access token
  function requestAccessToken() {
    return new Promise((resolve, reject) => {
      const client = getTokenClient();
      client.callback = (resp) => {
        if (resp.error) {
          reject(new Error("Google 登入失敗或已取消"));
          return;
        }
        accessToken = resp.access_token;
        resolve(accessToken);
      };
      client.requestAccessToken();
    });
  }

  function setUploadStatus(text, isError) {
    uploadStatus.hidden = !text;
    uploadStatus.textContent = text;
    uploadStatus.classList.toggle("error", Boolean(isError));
  }

  // 用 Drive 的 resumable upload:先建立上傳工作階段,再把檔案內容 PUT 上去
  async function uploadToDrive(file, token) {
    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": file.type,
          "X-Upload-Content-Length": String(file.size),
        },
        body: JSON.stringify({ name: file.name, parents: [ROOT_FOLDER_ID] }),
      }
    );
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `建立上傳工作階段失敗 (${initRes.status})`);
    }
    const uploadUrl = initRes.headers.get("Location");
    if (!uploadUrl) throw new Error("沒有取得上傳網址");

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `上傳檔案失敗 (${putRes.status})`);
    }
    return putRes.json();
  }

  // 先登入(乾淨的點擊,不會被 Chrome 擋),登入成功後才打開選檔案視窗
  uploadButton.addEventListener("click", async () => {
    try {
      if (!accessToken) {
        setUploadStatus("請用你的 Google 帳號登入…");
        await requestAccessToken();
        setUploadStatus("");
      }
      uploadInput.click();
    } catch (err) {
      setUploadStatus(`登入失敗:${err.message}`, true);
      console.error(err);
    }
  });

  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files[0];
    uploadInput.value = ""; // 清空,讓同一支檔案還能再選一次
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      setUploadStatus("只能上傳影片檔案", true);
      return;
    }

    try {
      setUploadStatus(`正在上傳:${file.name}…`);
      if (!accessToken) throw new Error("尚未登入");
      try {
        await uploadToDrive(file, accessToken);
      } catch (err) {
        // token 可能過期,重新登入一次再試一次(這裡的彈窗一樣是乾淨點擊觸發,不會被擋)
        setUploadStatus("登入逾期,請重新登入…");
        await requestAccessToken();
        setUploadStatus(`正在上傳:${file.name}…`);
        await uploadToDrive(file, accessToken);
      }
      setUploadStatus(`上傳完成:${file.name}`);
      await loadAll();
    } catch (err) {
      setUploadStatus(`上傳失敗:${err.message}`, true);
      console.error(err);
    }
  });
}

loadAll();
