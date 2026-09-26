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
