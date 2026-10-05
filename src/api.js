const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const okId = id => /^[0-9a-f-]{36}$/.test(id || '');

export async function onRequest({ request, env, params }) {
  const route = [].concat(params.path)[0];
  const q = new URL(request.url).searchParams;
  const id = q.get('id');
  const post = request.method === 'POST';

  if (route === 'build' && post) {
    let f;
    try { f = await request.formData(); } catch { return json({ error: 'درخواست نامعتبر است' }, 400); }
    const name = String(f.get('name') || '').trim();
    const icon = f.get('icon');
    let u;
    try { u = new URL(String(f.get('url') || '').trim()); } catch { return json({ error: 'لینک سایت معتبر نیست' }, 400); }
    if (!['http:', 'https:'].includes(u.protocol)) return json({ error: 'لینک باید با http یا https شروع شود' }, 400);
    if (!name || name.length > 30) return json({ error: 'اسم اپ باید بین ۱ تا ۳۰ حرف باشد' }, 400);
    if (!icon || typeof icon === 'string' || !/^image\/(png|jpeg|webp)$/.test(icon.type) || icon.size > 1048576)
      return json({ error: 'آیکون باید png، jpg یا webp و کمتر از ۱ مگابایت باشد' }, 400);
    const nid = crypto.randomUUID();
    await env.BUCKET.put(`icons/${nid}`, await icon.arrayBuffer(), { httpMetadata: { contentType: icon.type } });
    await env.BUCKET.put(`status/${nid}.json`, JSON.stringify({ status: 'building' }));
    const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/build-apk.yml/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'site2app', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main', inputs: { id: nid, name, url: u.href } }),
    });
    if (!r.ok) { await env.BUCKET.put(`status/${nid}.json`, JSON.stringify({ status: 'failed' })); return json({ error: 'شروع ساخت ناموفق بود' }, 502); }
    return json({ id: nid });
  }

  if (!okId(id)) return json({ error: 'bad id' }, 400);

  if (route === 'status') {
    const o = await env.BUCKET.get(`status/${id}.json`);
    return o ? new Response(o.body, { headers: { 'content-type': 'application/json' } }) : json({ error: 'not found' }, 404);
  }
  if (route === 'icon') {
    const o = await env.BUCKET.get(`icons/${id}`);
    return o ? new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'image/png' } }) : json({ error: 'not found' }, 404);
  }
  if (route === 'download') {
    const o = await env.BUCKET.get(`apks/${id}.apk`);
    return o ? new Response(o.body, { headers: { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': 'attachment; filename="app.apk"' } }) : json({ error: 'not found' }, 404);
  }
  if (route === 'upload' && post) {
    if (request.headers.get('x-secret') !== env.UPLOAD_SECRET) return json({ error: 'forbidden' }, 403);
    if (q.get('fail')) { await env.BUCKET.put(`status/${id}.json`, JSON.stringify({ status: 'failed' })); return json({ ok: true }); }
    await env.BUCKET.put(`apks/${id}.apk`, await request.arrayBuffer());
    await env.BUCKET.put(`status/${id}.json`, JSON.stringify({ status: 'done' }));
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}
