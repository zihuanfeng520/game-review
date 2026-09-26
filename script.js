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

// 資料夾名稱符合 YYYY-MM-DD 就回傳這個日期;不符合回傳 null(代表要改用影片自己的上傳時間)
function folderDateKey(folderName) {
  return /^\d{4}-\d{2}-\d{2}$/.test(folderName) ? folderName : null;
}

// 從 ISO 時間字串取出 YYYY-MM-DD
function toDateKey(isoString) {
  return isoString.slice(0, 10);
}

// 取得單一資料夾內的影片(這個函式也會拿來查詢「遊戲復盤」根目錄本身)
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
    // 「遊戲復盤」底下的子資料夾,以及直接放在根目錄本身的影片,兩者要同時查詢
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

    // 根目錄本身直接放的影片,沒有「資料夾名稱」可以參考,
    // 一律用該支影片自己的上傳時間分類(等同於「資料夾名稱不是 YYYY-MM-DD」的規則)
    for (const video of rootVideos) {
      const key = toDateKey(video.createdTime);
      if (!dateMap.has(key)) dateMap.set(key, []);
      dateMap.get(key).push(video);
    }

    await Promise.all(
      folders.map(async (folder) => {
        const videos = await fetchVideosInFolder(folder.id);
        const namedDate = folderDateKey(folder.name);
        for (const video of videos) {
          // 資料夾名稱是 YYYY-MM-DD 格式就用資料夾的日期;
          // 不是的話,改用這支影片自己的上傳時間當日期
          const key = namedDate || toDateKey(video.createdTime);
          if (!dateMap.has(key)) dateMap.set(key, []);
          dateMap.get(key).push(video);
        }
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
