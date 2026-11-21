// WeChat Official Account draft API client. Uses only node:https — no SDK.
// Failure is explicit: missing credentials throw E_NO_CREDENTIALS instead of
// pretending a draft was pushed.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.weixin.qq.com/cgi-bin';

export class WeChatError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export function credentialsFromEnv(env = process.env) {
  const appId = env.WECHAT_APPID;
  const appSecret = env.WECHAT_APPSECRET;
  if (!appId || !appSecret) {
    throw new WeChatError(
      'E_NO_CREDENTIALS',
      '缺少 WECHAT_APPID / WECHAT_APPSECRET 环境变量，无法推送草稿',
      '在公众号后台「设置与开发 → 基本配置」获取后注入环境变量；本技能不会用占位凭据伪造成功'
    );
  }
  return { appId, appSecret };
}

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {},
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode, json: JSON.parse(text) });
          } catch {
            reject(new WeChatError('E_BAD_JSON', '微信接口返回非 JSON', text.slice(0, 400)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new WeChatError('E_TIMEOUT', '请求微信接口超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function getAccessToken(appId, appSecret) {
  const url = `${API}/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const { json } = await httpJson('GET', url);
  if (json.errcode) {
    throw new WeChatError(`E_TOKEN_${json.errcode}`, `获取 access_token 失败：${json.errmsg}`, json);
  }
  return json.access_token;
}

// Upload a permanent image material; returns media_id usable as thumb_media_id.
export async function uploadThumb(accessToken, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new WeChatError('E_NO_THUMB', `封面文件不存在：${filePath}`);
  }
  const boundary = '----wechatpublisher' + Date.now();
  const fileBuf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="cover.${ext}"\r\nContent-Type: image/${ext}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const payload = Buffer.concat([head, fileBuf, tail]);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: 'api.weixin.qq.com',
        path: `/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=image`,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            const json = JSON.parse(text);
            if (json.errcode) reject(new WeChatError(`E_UPLOAD_${json.errcode}`, `封面上传失败：${json.errmsg}`, json));
            else resolve(json.media_id);
          } catch {
            reject(new WeChatError('E_BAD_JSON', '封面上传返回非 JSON', text.slice(0, 400)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new WeChatError('E_TIMEOUT', '封面上传超时')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export async function addDraft(accessToken, draft) {
  const { json } = await httpJson('POST', `${API}/draft/add?access_token=${encodeURIComponent(accessToken)}`, { articles: [draft] });
  if (json.errcode) {
    throw new WeChatError(`E_DRAFT_${json.errcode}`, `草稿创建失败：${json.errmsg}`, json);
  }
  return json.media_id;
}

export async function pushDraft(opts) {
  const { appId, appSecret } = credentialsFromEnv(opts.env || process.env);
  if (!opts.thumbMediaId) {
    throw new WeChatError(
      'E_NO_THUMB',
      '草稿必须提供 thumb_media_id（封面图）',
      '用 --cover <本地图片> 让本工具自动上传，或先用 material/add_material 上传后再传 --thumb-media-id'
    );
  }
  const token = await getAccessToken(appId, appSecret);
  let thumbMediaId = opts.thumbMediaId;
  if (opts.coverPath) thumbMediaId = await uploadThumb(token, opts.coverPath);

  const mediaId = await addDraft(token, {
    title: opts.title,
    author: opts.author || '',
    digest: opts.digest || '',
    content: opts.content,
    content_source_url: opts.sourceUrl || '',
    thumb_media_id: thumbMediaId,
    need_open_comment: 1,
    only_fans_can_comment: 0,
  });
  return { mediaId, note: '已推送草稿箱；群发仍需在公众号后台人工点发送' };
}
