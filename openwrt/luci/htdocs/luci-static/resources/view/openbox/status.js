'use strict';
'require view';
'require rpc';
'require ui';
'require fs';

// ---------------------------------------------------------------------------
// 自带翻译表
//
// 不用 LuCI 的 _():它查的是已加载的翻译目录,而我们的发布模型只铺文件、不走
// ipk 构建,拿不到 po2lmo 去编译 .po → .lmo。结果是只有恰好存在于 luci-base
// 目录里的串被翻译(Status/Stop/Restart/Emergency),自定义串全是英文,页面
// 中英混杂。这里自己查表,行为确定:简体、繁体各一份,其余语言一律英文。
// ---------------------------------------------------------------------------
var I18N = {
	'zh-Hans': {
		'Fallback controls. Full management lives in the Open-Box panel.':
			'兜底控制。完整管理请到 Open-Box 面板。',
		'sing-box core': 'sing-box 内核',
		'Open-Box panel': 'Open-Box 面板',
		'Status': '状态',
		'Autostart': '开机自启',
		'running': '运行中',
		'stopped': '已停止',
		'unknown': '未知',
		'on': '开',
		'off': '关',
		'Start': '启动',
		'Stop': '停止',
		'Restart': '重启',
		'Enable autostart': '开启自启',
		'Disable autostart': '关闭自启',
		'Emergency': '紧急',
		'Stops the core and restores plain internet access (removes the IPv6 leak block and the dead DNS upstream). The panel stays reachable.':
			'停止内核并恢复正常上网(移除 IPv6 泄漏拦截,摘掉已失效的 DNS 上游)。面板仍然可以访问。',
		'Emergency stop / restore direct': '紧急停止 / 恢复直连',
		'Panel': '面板',
		'Version': '版本',
		'Installed version': '当前版本',
		'Check for updates': '检查更新',
		'Checking...': '检查中…',
		'Up to date.': '已是最新版本。',
		'New version available: %s': '有新版本:%s',
		'Could not check (network unreachable or blocked).': '无法检查(网络不通或被拦截)。',
		'Not installed': '未安装',
		'Action sent: %s %s': '已发送操作:%s %s',
		'Action failed: %s': '操作失败:%s',
		'init action failed': '服务操作未成功'
	},
	'zh-Hant': {
		'Fallback controls. Full management lives in the Open-Box panel.':
			'兜底控制。完整管理請到 Open-Box 面板。',
		'sing-box core': 'sing-box 核心',
		'Open-Box panel': 'Open-Box 面板',
		'Status': '狀態',
		'Autostart': '開機自啟',
		'running': '執行中',
		'stopped': '已停止',
		'unknown': '未知',
		'on': '開',
		'off': '關',
		'Start': '啟動',
		'Stop': '停止',
		'Restart': '重新啟動',
		'Enable autostart': '開啟自啟',
		'Disable autostart': '關閉自啟',
		'Emergency': '緊急',
		'Stops the core and restores plain internet access (removes the IPv6 leak block and the dead DNS upstream). The panel stays reachable.':
			'停止核心並恢復正常上網(移除 IPv6 洩漏攔截,移除已失效的 DNS 上游)。面板仍然可以存取。',
		'Emergency stop / restore direct': '緊急停止 / 恢復直連',
		'Panel': '面板',
		'Version': '版本',
		'Installed version': '目前版本',
		'Check for updates': '檢查更新',
		'Checking...': '檢查中…',
		'Up to date.': '已是最新版本。',
		'New version available: %s': '有新版本:%s',
		'Could not check (network unreachable or blocked).': '無法檢查(網路不通或被攔截)。',
		'Not installed': '未安裝',
		'Action sent: %s %s': '已傳送操作:%s %s',
		'Action failed: %s': '操作失敗:%s',
		'init action failed': '服務操作未成功'
	}
};

// 跟随 OpenWrt 的系统语言;非中文一律回落英文。
function detectLang() {
	var raw = '';
	try { if (L && L.env && L.env.lang) raw = String(L.env.lang); } catch (e) { /* ignore */ }
	if (!raw || raw === 'auto') {
		try { raw = String(document.documentElement.lang || ''); } catch (e) { /* ignore */ }
	}
	if (!raw || raw === 'auto') {
		try { raw = String(navigator.language || ''); } catch (e) { /* ignore */ }
	}
	var v = raw.replace(/_/g, '-').toLowerCase();
	if (v.indexOf('zh') !== 0) return 'en';
	if (/hant|tw|hk|mo/.test(v)) return 'zh-Hant';
	return 'zh-Hans';
}

var LANG = detectLang();

function tr(s) {
	var table = I18N[LANG];
	return (table && table[s]) || s;
}

function fmt(s, a, b) {
	var out = tr(s);
	if (a !== undefined) out = out.replace('%s', a);
	if (b !== undefined) out = out.replace('%s', b);
	return out;
}

// ---------------------------------------------------------------------------
// ubus
// ---------------------------------------------------------------------------
var callInitAction = rpc.declare({
	object: 'luci',
	method: 'setInitAction',
	params: [ 'name', 'action' ],
	expect: { result: false }
});

var callInitList = rpc.declare({
	object: 'luci',
	method: 'getInitList',
	params: [ 'name' ],
	expect: { '': {} }
});

// 各版本 luci.getInitList 返回的字段是 {index, enabled}(21.02)或
// {index, stop, enabled}(23.05+)——从来没有 running。用它判断运行态会恒为
// false,两个服务永远显示"已停止"。运行状态改问 procd 自己的 service list
// (21.02+ 均可用),enabled(自启)仍然来自 getInitList。
var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function isRunning(serviceListResult, name) {
	var svc = serviceListResult && serviceListResult[name];
	var instances = svc && svc.instances;
	if (!instances) return false;
	for (var key in instances) {
		if (Object.prototype.hasOwnProperty.call(instances, key) &&
		    instances[key] && instances[key].running === true) {
			return true;
		}
	}
	return false;
}

function serviceState(name) {
	return Promise.all([ callInitList(name), callServiceList(name) ]).then(function (res) {
		var initEntry = res[0][name] || {};
		return { enabled: initEntry.enabled === true, running: isRunning(res[1], name) };
	}).catch(function () {
		return { enabled: false, running: false };
	});
}

function act(name, action) {
	return callInitAction(name, action).then(function (ok) {
		if (!ok) {
			throw new Error(tr('init action failed'));
		}
		ui.addNotification(null, E('p', fmt('Action sent: %s %s', name, action)), 'info');
		window.setTimeout(function () { location.reload(); }, 1200);
	}).catch(function (err) {
		ui.addNotification(null, E('p', fmt('Action failed: %s', err.message || err)), 'error');
	});
}

// ---------------------------------------------------------------------------
// 版本
// ---------------------------------------------------------------------------
var META_PATH = '/opt/open-box/meta.json';
var REPO = 'liandu2024/Open-Box';

function readInstalledVersion() {
	return fs.read(META_PATH).then(function (txt) {
		var meta = JSON.parse(txt);
		return meta && meta.version ? String(meta.version) : null;
	}).catch(function () {
		return null;
	});
}

// 语义化比较:返回 1 表示 a 比 b 新,-1 表示旧,0 表示相同。
function cmpVersion(a, b) {
	var pa = String(a).replace(/^v/i, '').split(/[.\-+]/);
	var pb = String(b).replace(/^v/i, '').split(/[.\-+]/);
	for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
		var na = parseInt(pa[i], 10), nb = parseInt(pb[i], 10);
		if (isNaN(na)) na = -1;
		if (isNaN(nb)) nb = -1;
		if (na > nb) return 1;
		if (na < nb) return -1;
	}
	return 0;
}

// 检查在浏览器里发起(而不是路由器),这样即便路由器本身还没配好代理也能查。
// 网络受限时优雅失败,不影响页面其它功能。
function checkLatest() {
	return fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
		headers: { 'Accept': 'application/vnd.github+json' }
	}).then(function (r) {
		if (!r.ok) throw new Error('HTTP ' + r.status);
		return r.json();
	}).then(function (j) {
		if (!j || !j.tag_name) throw new Error('no tag');
		return String(j.tag_name);
	});
}

// ---------------------------------------------------------------------------
// 布局
//
// 不用 cbi-page-actions:那是「页面底部」的操作栏(右对齐 + 特定外边距),
// 一页只该出现一次。放进每张卡片会让按钮脱离卡片右飘、压到下一张卡片上。
// 这里用普通 flex 行,并写内联样式以免依赖具体主题的 CSS。
// ---------------------------------------------------------------------------
var ROW = 'display:flex;flex-wrap:wrap;align-items:center;gap:.5em;margin:.4em 0';
var BTNROW = 'display:flex;flex-wrap:wrap;gap:.5em;margin:.8em 0 .2em 0';

function badge(text, color) {
	return E('strong', { 'style': 'color:' + color }, text);
}

return view.extend({
	load: function () {
		return Promise.all([
			serviceState('openbox'),
			serviceState('openbox-panel'),
			readInstalledVersion()
		]);
	},

	render: function (data) {
		var core = data[0], panel = data[1], installed = data[2];
		var panelUrl = 'http://' + window.location.hostname + ':2026';
		var self = this;

		function serviceCard(title, name, st) {
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, tr(title)),
				E('div', { 'style': ROW }, [
					E('span', {}, tr('Status') + ':'),
					badge(st.running ? tr('running') : tr('stopped'),
					      st.running ? '#2a9d2a' : '#c33'),
					E('span', { 'style': 'opacity:.5' }, '|'),
					E('span', {}, tr('Autostart') + ':'),
					E('strong', {}, st.enabled ? tr('on') : tr('off'))
				]),
				E('div', { 'style': BTNROW }, [
					E('button', { 'class': 'cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(self, function () { return act(name, 'start'); }) }, tr('Start')),
					E('button', { 'class': 'cbi-button cbi-button-reset',
						'click': ui.createHandlerFn(self, function () { return act(name, 'stop'); }) }, tr('Stop')),
					E('button', { 'class': 'cbi-button cbi-button-neutral',
						'click': ui.createHandlerFn(self, function () { return act(name, 'restart'); }) }, tr('Restart')),
					E('button', { 'class': 'cbi-button cbi-button-neutral',
						'click': ui.createHandlerFn(self, function () {
							return act(name, st.enabled ? 'disable' : 'enable');
						}) }, st.enabled ? tr('Disable autostart') : tr('Enable autostart'))
				])
			]);
		}

		var versionResult = E('span', { 'style': 'margin-left:.6em' }, '');

		var checkBtn = E('button', { 'class': 'cbi-button cbi-button-neutral',
			'click': ui.createHandlerFn(self, function () {
				versionResult.textContent = tr('Checking...');
				return checkLatest().then(function (latest) {
					if (!installed) {
						versionResult.textContent = fmt('New version available: %s', latest);
						return;
					}
					if (cmpVersion(latest, installed) > 0) {
						versionResult.textContent = fmt('New version available: %s', latest);
					} else {
						versionResult.textContent = tr('Up to date.');
					}
				}).catch(function () {
					versionResult.textContent = tr('Could not check (network unreachable or blocked).');
				});
			}) }, tr('Check for updates'));

		return E('div', {}, [
			E('h2', {}, 'Open-Box'),
			E('p', { 'class': 'cbi-section-descr' },
				tr('Fallback controls. Full management lives in the Open-Box panel.')),

			serviceCard('sing-box core', 'openbox', core),
			serviceCard('Open-Box panel', 'openbox-panel', panel),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, tr('Emergency')),
				E('p', {}, tr('Stops the core and restores plain internet access (removes the IPv6 leak block and the dead DNS upstream). The panel stays reachable.')),
				E('div', { 'style': BTNROW }, [
					E('button', { 'class': 'cbi-button cbi-button-negative',
						'click': ui.createHandlerFn(self, function () { return act('openbox', 'stop'); }) },
						tr('Emergency stop / restore direct'))
				])
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, tr('Panel')),
				E('div', { 'style': ROW }, [
					E('a', { 'href': panelUrl, 'target': '_blank', 'rel': 'noreferrer' }, panelUrl)
				])
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, tr('Version')),
				E('div', { 'style': ROW }, [
					E('span', {}, tr('Installed version') + ':'),
					E('strong', {}, installed || tr('Not installed'))
				]),
				E('div', { 'style': BTNROW }, [ checkBtn, versionResult ])
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
