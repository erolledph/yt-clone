const https = require('https');
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {}, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return httpsGet(res.headers.location).then(resolve).catch(reject);
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
async function findChannel(query) {
  const body = JSON.stringify({
    context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'PH' } },
    query
  });
  const data = await httpsPost(
    'https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false',
    body, { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
  );
  const parsed = JSON.parse(data);
  const contents = parsed?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
  for (const item of contents) {
    const ch = item.channelRenderer;
    if (ch) return { name: ch.title?.simpleText || query, id: ch.channelId };
  }
  return null;
}
async function testRss(channelId, name) {
  const r = await httpsGet('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId);
  const count = (r.match(/yt:videoId/g) || []).length;
  console.log(name + ' | ' + channelId + ' | ' + count + ' videos');
  return count > 0;
}
async function run() {
  const channels = ['ABS-CBN News', 'GMA News', 'Vice Ganda', 'Cong TV', 'Ranz Kyle', 'Niana Guerrero', 'Eat Bulaga'];
  for (const ch of channels) {
    const info = await findChannel(ch + ' youtube channel');
    if (info) {
      await testRss(info.id, info.name);
    } else {
      console.log(ch + ': not found');
    }
  }
}
run();
