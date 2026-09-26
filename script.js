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

// 取得「遊戲復盤」底下所有符合 YYYY-MM-DD 命名的日期資料夾,依日期新到舊排序
async function fetchDateFolders() {
  const q = `'${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const data = await fetchJSON(driveListURL(q, "id,name"));
  return (data.files || [])
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name));
}

// 取得單一日期資料夾內的影片
async function fetchVideosInFolder(folderId) {
  const q = `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`;
  const data = await fetchJSON(
    driveListURL(q, "id,name,createdTime,modifiedTime")
  );
  return (data.files || []).sort(compareVideos);
}

// 檔名開頭如果是 20xx/xx/xx/xx:xx 格式,優先用這個時間排序;否則用上傳時間
const NAME_DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2})\/(\d{2}):(\d{2})/;

function extractSortTime(video) {
  const m = video.name.match(NAME_DATE_RE);
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

function formatDateLabel(folderName) {
  return folderName.replace(/-/g, "/");
}

async function loadAll() {
  const root = document.getElementById("date-groups");
  root.innerHTML = '<p class="status">正在讀取 Google Drive…</p>';

  try {
    const folders = await fetchDateFolders();
    if (folders.length === 0) {
      root.innerHTML =
        '<p class="status">找不到任何日期資料夾,請確認 Folder ID 與分享權限是否正確。</p>';
      return;
    }

    const withVideos = await Promise.all(
      folders.map(async (f) => ({
        ...f,
        videos: await fetchVideosInFolder(f.id),
      }))
    );

    state.folders = withVideos.filter((f) => f.videos.length > 0);
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

    const heading = document.createElement("h2");
    heading.textContent = formatDateLabel(folder.name);
    section.appendChild(heading);

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

// 卡片預設只顯示「▶ 播放」按鈕,點擊後才建立 iframe 播放器(避免一次載入大量影片)
function buildVideoCard(video) {
  const card = document.createElement("div");
  card.className = "video-card";

  const frame = document.createElement("div");
  frame.className = "video-frame";
  frame.innerHTML = '<div class="play-placeholder">▶</div>';

  const startPlayback = () => {
    frame.innerHTML = `<iframe src="https://drive.google.com/file/d/${video.id}/preview" allow="autoplay" allowfullscreen loading="lazy"></iframe>`;
  };
  frame.addEventListener("click", startPlayback, { once: true });

  const title = document.createElement("p");
  title.className = "video-title";
  title.textContent = video.name;

  const button = document.createElement("button");
  button.className = "play-button";
  button.textContent = "▶ 播放";
  button.addEventListener("click", startPlayback, { once: true });

  card.append(frame, title, button);
  return card;
}

document.getElementById("search-input").addEventListener("input", (e) => {
  state.searchTerm = e.target.value;
  render();
});

loadAll();
