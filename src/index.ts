import express from 'express';
import cors from 'cors';
import https from 'https';
import http from 'http';

const app = express();
app.use(cors());
app.use(express.static('public'));

function httpsGet(url: string, headers?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: headers || {} }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location!, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
  return httpsGet(url, headers).then((d) => {
    try { return JSON.parse(d); } catch { return null; }
  }).catch(() => null);
}

function fetchXml(url: string): Promise<string> {
  return httpsGet(url).catch(() => '');
}

function extractVideoId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) { const m = input.match(p); if (m) return m[1]; }
  return null;
}

function parseRssFeed(xml: string): any[] {
  const videos: any[] = [];
  const entries = xml.split('<entry>').slice(1);
  for (const entry of entries) {
    const videoId = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    const title = (entry.match(/<media:group>[\s\S]*?<media:title>(.*?)<\/media:title>/) || [])[1];
    const channelTitle = (entry.match(/<media:group>[\s\S]*?<media:credit[^>]*>(.*?)<\/media:credit>/) || [])[1];
    const thumbnail = (entry.match(/<media:thumbnail url="(.*?)"/) || [])[1];
    const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1];
    const description = (entry.match(/<media:description>(.*?)<\/media:description>/) || [])[1];
    if (videoId) {
      videos.push({
        videoId,
        title: title?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') || '',
        channelTitle: channelTitle?.replace(/&amp;/g, '&') || '',
        thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        published: published || '',
        description: description || '',
      });
    }
  }
  return videos;
}

function isShortDuration(lengthStr: string): boolean {
  if (!lengthStr) return false;
  const parts = lengthStr.split(':').map(Number);
  if (parts.length === 1) return parts[0] <= 59;
  if (parts.length === 2) return parts[0] === 0 && parts[1] <= 59;
  return false;
}

function extractVideosFromContents(contents: any[]): { videos: any[]; continuationToken: string | null } {
  const videos: any[] = [];
  let continuationToken: string | null = null;

  for (const item of contents) {
    const v = item.videoRenderer;
    if (v) {
      videos.push({
        videoId: v.videoId,
        title: v.title?.runs?.map((r: any) => r.text).join('') || '',
        channelTitle: v.ownerText?.runs?.[0]?.text || '',
        thumbnail: v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || '',
        viewCount: v.viewCountText?.simpleText || v.viewCountText?.runs?.map((r: any) => r.text).join('') || '',
        published: v.publishedTimeText?.simpleText || '',
        length: v.lengthText?.simpleText || '',
        description: v.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map((r: any) => r.text).join('') || '',
      });
    }
    const richVid = item.richItemRenderer?.content?.videoRenderer;
    if (richVid) {
      videos.push({
        videoId: richVid.videoId,
        title: richVid.title?.runs?.map((r: any) => r.text).join('') || '',
        channelTitle: richVid.ownerText?.runs?.[0]?.text || '',
        thumbnail: richVid.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || '',
        viewCount: richVid.viewCountText?.simpleText || richVid.viewCountText?.runs?.map((r: any) => r.text).join('') || '',
        published: richVid.publishedTimeText?.simpleText || '',
        length: richVid.lengthText?.simpleText || '',
        description: '',
      });
    }
    const lvm = item.lockupViewModel;
    if (lvm) {
      const title = lvm.metadata?.lockupMetadataViewModel?.title?.content || '';
      const videoId = lvm.contentId;
      if (videoId && videoId.length === 11) {
        const metaRows = lvm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
        let channel = '';
        let length = '';
        for (const row of metaRows) {
          for (const part of row.metadataParts || []) {
            const txt = part.text?.content || '';
            if (txt.includes('Playlist') || txt.includes('Updated') || txt.includes('View full')) continue;
            if (txt.includes('•')) {
              const parts = txt.split('•').map((s: string) => s.trim());
              for (const p of parts) {
                if (p.match(/\d+:\d+/)) length = p;
                else if (!channel && p && !p.includes('view')) channel = p;
              }
            }
          }
        }
        const thumbSrc = lvm.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources?.[0]?.url || '';
        videos.push({
          videoId,
          title,
          channelTitle: channel,
          thumbnail: thumbSrc || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          viewCount: '',
          published: '',
          length,
          description: '',
        });
      }
    }
    const shelf = item.gridShelfViewModel;
    if (shelf) {
      const items = shelf?.content?.gridItemsViewModel?.items || [];
      for (const si of items) {
        const vid = si.lockupViewModel?.contentId;
        const vTitle = si.lockupViewModel?.metadata?.lockupMetadataViewModel?.title?.content || '';
        if (vid && vid.length === 11) {
          const thumbSrc = si.lockupViewModel?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources?.[0]?.url || '';
          videos.push({
            videoId: vid,
            title: vTitle,
            channelTitle: '',
            thumbnail: thumbSrc || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            viewCount: '',
            published: '',
            length: '',
            description: '',
          });
        }
      }
    }
    const cont = item.continuationItemRenderer;
    if (cont) {
      continuationToken = cont.continuationEndpoint?.continuationCommand?.token || null;
    }
  }

  return { videos, continuationToken };
}

function parseSearchResults(data: any): { videos: any[]; continuationToken: string | null } {
  const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
  let { videos, continuationToken } = extractVideosFromContents(contents);

  const subContents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  for (const section of subContents) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const cont = item?.continuationItemRenderer;
      if (cont?.continuationEndpoint?.continuationCommand?.token) {
        continuationToken = cont.continuationEndpoint.continuationCommand.token;
      }
    }
  }

  return { videos, continuationToken };
}

const POPULAR_CHANNELS: Record<string, string> = {
  'ABS-CBN News': 'UCE2606prvXQc_noEqKxVJXA',
  'GMA News': 'UCqYw-CTd1dU2yGI71sEyqNw',
  'Vice Ganda': 'UCZ1PkXDIb_ybGu-3cxMm6oQ',
  'Cong TV': 'UC73zqrs0Th_a9dFUivEmv2A',
  'Ranz Kyle': 'UCdAt_KUKt0g9ZRQ7gwKaN3A',
  'Niana Guerrero': 'UCLysbxhOO_JPOPgcsPCMb8w',
  'Eat Bulaga': 'UCby04dl3oIxkDoZil8xP_FA',
};

const TAGS = [
  { id: 'trending', label: 'Trending PH', query: 'pinoy' },
  { id: 'music', label: 'OPM Music', query: 'opm music' },
  { id: 'gaming', label: 'Gaming', query: 'gaming' },
  { id: 'news', label: 'News PH', query: 'philippine news' },
  { id: 'sports', label: 'Sports', query: 'sports highlights' },
  { id: 'tech', label: 'Tech', query: 'technology reviews' },
  { id: 'cooking', label: 'Cooking', query: 'filipino recipes' },
  { id: 'comedy', label: 'Comedy', query: 'funny filipino' },
  { id: 'education', label: 'Education', query: 'educational videos' },
  { id: 'vlogs', label: 'Vlogs', query: 'filipino vlog' },
  { id: 'movies', label: 'Movies', query: 'philippine movies' },
  { id: 'podcasts', label: 'Podcasts', query: 'filipino podcasts' },
];

const YT_CONTEXT = { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'PH' } };
const YT_HEADERS = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' };
const YT_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

// --- API Routes ---

app.get('/', (_req, res) => {
  res.json({ message: 'YT Clone API', version: '3.0' });
});

app.get('/api/tags', (_req, res) => {
  res.json({ tags: TAGS });
});

app.get('/api/trending', async (_req, res) => {
  try {
    const allVideos: any[] = [];
    const channelEntries = Object.entries(POPULAR_CHANNELS);
    const promises = channelEntries.map(async ([name, id]) => {
      try {
        const xml = await fetchXml(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
        const videos = parseRssFeed(xml).slice(0, 5);
        videos.forEach((v) => { v.channelName = name; });
        return videos;
      } catch { return []; }
    });
    const results = await Promise.allSettled(promises);
    results.forEach((r) => {
      if (r.status === 'fulfilled') allVideos.push(...r.value);
    });
    allVideos.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());
    res.json({ videos: allVideos.slice(0, 50) });
  } catch {
    res.status(500).json({ message: 'Error fetching trending videos.' });
  }
});

app.get('/api/channel/:id', async (req, res) => {
  const channelId = req.params.id;
  try {
    const xml = await fetchXml(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    const videos = parseRssFeed(xml);
    const channelName = videos[0]?.channelTitle || channelId;
    res.json({ channelName, channelId, videos });
  } catch {
    res.status(500).json({ message: 'Error fetching channel.' });
  }
});

app.get('/api/suggest', async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.json({ suggestions: [] });
  try {
    const raw = await httpsGet(
      `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&gl=PH&q=${encodeURIComponent(q)}`
    );
    const jsonStr = raw.replace(/^window\.google\.ac\.h\(/, '').replace(/\);?\s*$/, '');
    const parsed = JSON.parse(jsonStr);
    const suggestions = (parsed[1] || []).map((item: any) => typeof item === 'string' ? item : item[0] || '');
    res.json({ suggestions: suggestions.slice(0, 10) });
  } catch {
    res.json({ suggestions: [] });
  }
});

app.get('/api/search', async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ message: 'No query.' });
  try {
    const body = JSON.stringify({ context: { ...YT_CONTEXT, client: { ...YT_CONTEXT.client, gl: 'PH' } }, query: q });
    const data = await httpsPost(
      `https://www.youtube.com/youtubei/v1/search?key=${YT_KEY}&prettyPrint=false`,
      body, YT_HEADERS
    );
    const parsed = JSON.parse(data);
    const result = parseSearchResults(parsed);
    res.json(result);
  } catch {
    res.status(500).json({ message: 'Search failed.' });
  }
});

app.get('/api/search/shorts', async (req, res) => {
  const q = req.query.q as string || 'shorts';
  const token = req.query.token as string || null;
  try {
    if (token) {
    const body = JSON.stringify({
      context: { ...YT_CONTEXT, client: { ...YT_CONTEXT.client, gl: 'PH' } },
      continuation: token,
    });
      const data = await httpsPost(
        `https://www.youtube.com/youtubei/v1/search?key=${YT_KEY}&prettyPrint=false`,
        body, YT_HEADERS
      );
      const parsed = JSON.parse(data);
      const actions = parsed?.onResponseReceivedCommands || parsed?.onResponseReceivedActions || [];
      const videos: any[] = [];
      let nextToken: string | null = null;
      for (const action of actions) {
        const items = action?.appendContinuationItemsAction?.continuationItems ||
                      action?.reloadContinuationItemsCommand?.continuationItems || [];
        for (const item of items) {
          const v = item.compactVideoRenderer || item.videoRenderer;
          if (v) {
            const len = v.lengthText?.simpleText || '';
            if (isShortDuration(len)) {
              videos.push({
                videoId: v.videoId,
                title: v.title?.simpleText || v.title?.runs?.map((r: any) => r.text).join('') || '',
                channelTitle: v.shortBylineText?.runs?.[0]?.text || v.ownerText?.runs?.[0]?.text || '',
                thumbnail: v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || '',
                viewCount: v.viewCountText?.simpleText || '',
                published: v.publishedTimeText?.simpleText || '',
                length: len,
                isShort: true,
              });
            }
          }
          const cont = item.continuationItemRenderer;
          if (cont?.continuationEndpoint?.continuationCommand?.token) {
            nextToken = cont.continuationEndpoint.continuationCommand.token;
          }
        }
      }
      return res.json({ videos, continuationToken: nextToken });
    }

    const body = JSON.stringify({
      context: { ...YT_CONTEXT, client: { ...YT_CONTEXT.client, gl: 'PH' } },
      query: q,
      params: 'EgQQARgF',
    });
    const data = await httpsPost(
      `https://www.youtube.com/youtubei/v1/search?key=${YT_KEY}&prettyPrint=false`,
      body, YT_HEADERS
    );
    const parsed = JSON.parse(data);
    const contents = parsed?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const videos: any[] = [];
    let nextToken: string | null = null;

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item.videoRenderer;
        if (v) {
          const len = v.lengthText?.simpleText || '';
          if (isShortDuration(len)) {
            videos.push({
              videoId: v.videoId,
              title: v.title?.runs?.map((r: any) => r.text).join('') || '',
              channelTitle: v.ownerText?.runs?.[0]?.text || '',
              thumbnail: v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || '',
              viewCount: v.viewCountText?.simpleText || v.viewCountText?.runs?.map((r: any) => r.text).join('') || '',
              published: v.publishedTimeText?.simpleText || '',
              length: len,
              isShort: true,
            });
          }
        }
        const cont = item?.continuationItemRenderer;
        if (cont?.continuationEndpoint?.continuationCommand?.token) {
          nextToken = cont.continuationEndpoint.continuationCommand.token;
        }
      }
    }

    res.json({ videos: videos.slice(0, 20), continuationToken: nextToken });
  } catch {
    res.status(500).json({ message: 'Shorts search failed.' });
  }
});

app.get('/api/video/:id', async (req, res) => {
  const videoId = req.params.id;
  try {
    const [oembed, html] = await Promise.all([
      fetchJson(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`),
      fetchXml(`https://www.youtube.com/watch?v=${videoId}`),
    ]);
    if (!oembed) return res.status(404).json({ message: 'Video not found.' });
    let description = '';
    const descMatch = html.match(/"shortDescription"\s*:\s*"(.*?)(?<!\\)"/);
    if (descMatch) {
      description = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    let viewCount = '';
    const viewMatch = html.match(/"viewCount"\s*:\s*"(\d+)"/);
    if (viewMatch) viewCount = viewMatch[1];
    let lengthSeconds = '';
    const lenMatch = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
    if (lenMatch) lengthSeconds = lenMatch[1];
    res.json({ videoId, ...oembed, description, viewCount, lengthSeconds });
  } catch {
    res.status(500).json({ message: 'Error.' });
  }
});

app.get('/api/related/:id', async (req, res) => {
  const videoId = req.params.id;
  try {
    const body = JSON.stringify({ context: { ...YT_CONTEXT, client: { ...YT_CONTEXT.client, gl: 'PH' } }, videoId });
    const data = await httpsPost(
      `https://www.youtube.com/youtubei/v1/player?key=${YT_KEY}&prettyPrint=false`,
      body, YT_HEADERS
    );
    const parsed = JSON.parse(data);
    const secondaryItems = parsed?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];
    const videos: any[] = [];
    for (const item of secondaryItems) {
      const v = item.compactVideoRenderer;
      if (v) {
        videos.push({
          videoId: v.videoId,
          title: v.title?.simpleText || v.title?.runs?.map((r: any) => r.text).join('') || '',
          channelTitle: v.shortBylineText?.runs?.[0]?.text || '',
          thumbnail: v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || '',
          viewCount: v.viewCountText?.simpleText || '',
          published: v.publishedTimeText?.simpleText || '',
          length: v.lengthText?.simpleText || '',
        });
      }
    }
    res.json({ videos });
  } catch {
    res.json({ videos: [] });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
