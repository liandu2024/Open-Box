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
		'Stopping also turns off autostart (so it stays stopped after a reboot) and restores plain internet access: the IPv6 leak block and the Open-Box DNS upstream are removed. The panel stays reachable.':
			'停止会同时关闭开机自启(重启后不会自己跑起来),并恢复正常上网:IPv6 泄漏拦截与 Open-Box 写入的 DNS 上游都会被移除。面板仍然可以访问。',
		'Status': '状态',
		'Autostart': '开机自启',
		'running': '运行中',
		'stopped': '已停止',
		'on': '开',
		'off': '关',
		'Start': '启动',
		'Stop': '停止',
		'Restart': '重启',
		'Enable autostart': '开启自启',
		'Disable autostart': '关闭自启',
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
		'init action failed': '服务操作未成功',
		'Uninstall': '卸载',
		'Remove Open-Box from this router. Services are stopped, DNS and firewall changes are reverted, and the LuCI page disappears after the next refresh.':
			'从这台路由器上移除 Open-Box。服务会被停止,DNS 与防火墙改动会被还原,刷新后本页面也会消失。',
		'Uninstall Open-Box': '卸载 Open-Box',
		'Also delete data (subscriptions, password, rule sets)': '同时删除数据(订阅、密码、规则集)',
		'Keeping data lets a later re-install reuse it. Delete it for a completely fresh start.':
			'保留数据可供以后重新安装时复用;要彻底重来就勾选删除。',
		'This cannot be undone. Continue?': '此操作不可撤销,确定继续吗?',
		'Cancel': '取消',
		'Confirm uninstall': '确认卸载',
		'Uninstalling...': '正在卸载…',
		'Uninstalled. Refresh the page; this menu entry will be gone.': '已卸载。请刷新页面,本菜单项将会消失。',
		'Uninstall failed: %s': '卸载失败:%s',
		'Uninstall script not found. Run it manually over SSH.': '未找到卸载脚本,请通过 SSH 手动执行。'
	},
	'zh-Hant': {
		'Fallback controls. Full management lives in the Open-Box panel.':
			'兜底控制。完整管理請到 Open-Box 面板。',
		'sing-box core': 'sing-box 核心',
		'Open-Box panel': 'Open-Box 面板',
		'Stopping also turns off autostart (so it stays stopped after a reboot) and restores plain internet access: the IPv6 leak block and the Open-Box DNS upstream are removed. The panel stays reachable.':
			'停止會同時關閉開機自啟(重新啟動後不會自己執行),並恢復正常上網:IPv6 洩漏攔截與 Open-Box 寫入的 DNS 上游都會被移除。面板仍然可以存取。',
		'Status': '狀態',
		'Autostart': '開機自啟',
		'running': '執行中',
		'stopped': '已停止',
		'on': '開',
		'off': '關',
		'Start': '啟動',
		'Stop': '停止',
		'Restart': '重新啟動',
		'Enable autostart': '開啟自啟',
		'Disable autostart': '關閉自啟',
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
		'init action failed': '服務操作未成功',
		'Uninstall': '解除安裝',
		'Remove Open-Box from this router. Services are stopped, DNS and firewall changes are reverted, and the LuCI page disappears after the next refresh.':
			'從這台路由器上移除 Open-Box。服務會被停止,DNS 與防火牆變更會被還原,重新整理後本頁面也會消失。',
		'Uninstall Open-Box': '解除安裝 Open-Box',
		'Also delete data (subscriptions, password, rule sets)': '同時刪除資料(訂閱、密碼、規則集)',
		'Keeping data lets a later re-install reuse it. Delete it for a completely fresh start.':
			'保留資料可供日後重新安裝時沿用;要徹底重來就勾選刪除。',
		'This cannot be undone. Continue?': '此操作無法復原,確定要繼續嗎?',
		'Cancel': '取消',
		'Confirm uninstall': '確認解除安裝',
		'Uninstalling...': '正在解除安裝…',
		'Uninstalled. Refresh the page; this menu entry will be gone.': '已解除安裝。請重新整理頁面,本選單項目將會消失。',
		'Uninstall failed: %s': '解除安裝失敗:%s',
		'Uninstall script not found. Run it manually over SSH.': '找不到解除安裝腳本,請透過 SSH 手動執行。'
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

// 按顺序执行一串 init 动作,全部成功才提示成功。内核的「停止」需要 stop + disable
// 两步(见下方 serviceCard 的说明),所以这里接受数组而不是单个动作。
function act(name, actions) {
	var list = (typeof actions === 'string') ? [ actions ] : actions;
	var chain = Promise.resolve();

	list.forEach(function (action) {
		chain = chain.then(function () {
			return callInitAction(name, action).then(function (ok) {
				if (!ok) {
					throw new Error(tr('init action failed') + ' (' + action + ')');
				}
			});
		});
	});

	return chain.then(function () {
		ui.addNotification(null, E('p', fmt('Action sent: %s %s', name, list.join(' + '))), 'info');
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

var UNINSTALL_PATH = '/opt/open-box/uninstall.sh';

// 卸载走本地脚本(随发布包铺下来的那份),不依赖外网——这个页面存在的意义就是
// 面板/网络出问题时还能操作。fs.exec 需要 ACL 里对该路径的 exec 授权。
function runUninstall(purge) {
	var args = purge ? [ '--purge' ] : [];
	return fs.exec(UNINSTALL_PATH, args).then(function (res) {
		if (!res || res.code !== 0) {
			var detail = (res && (res.stderr || res.stdout)) || ('exit ' + (res ? res.code : '?'));
			throw new Error(String(detail).split('\n').slice(-3).join(' ').trim() || 'failed');
		}
		return res;
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

		function serviceCard(title, name, st, extraRow, hint, stopActions) {
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, tr(title)),
				E('div', { 'style': ROW }, [
					E('span', {}, tr('Status') + ':'),
					badge(st.running ? tr('running') : tr('stopped'),
					      st.running ? '#2a9d2a' : '#c33'),
					E('span', { 'style': 'opacity:.5' }, '|'),
					E('span', {}, tr('Autostart') + ':'),
					E('strong', {}, st.enabled ? tr('on') : tr('off'))
				].concat(extraRow ? [ E('span', { 'style': 'opacity:.5' }, '|'), extraRow ] : [])),
				E('div', { 'style': BTNROW }, [
					E('button', { 'class': 'cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(self, function () { return act(name, 'start'); }) }, tr('Start')),
					E('button', { 'class': 'cbi-button cbi-button-reset',
						'click': ui.createHandlerFn(self, function () { return act(name, stopActions || 'stop'); }) }, tr('Stop')),
					E('button', { 'class': 'cbi-button cbi-button-neutral',
						'click': ui.createHandlerFn(self, function () { return act(name, 'restart'); }) }, tr('Restart')),
					E('button', { 'class': 'cbi-button cbi-button-neutral',
						'click': ui.createHandlerFn(self, function () {
							return act(name, st.enabled ? 'disable' : 'enable');
						}) }, st.enabled ? tr('Disable autostart') : tr('Enable autostart'))
				])
			].concat(hint ? [ E('p', { 'style': 'opacity:.7;font-size:90%;margin:.2em 0 0 0' }, hint) ] : []));
		}

		function showUninstallDialog() {
			var purgeBox = E('input', { 'type': 'checkbox', 'id': 'ob-purge' });
			ui.showModal(tr('Uninstall Open-Box'), [
				E('p', {}, tr('This cannot be undone. Continue?')),
				E('div', { 'style': ROW }, [
					purgeBox,
					E('label', { 'for': 'ob-purge' }, tr('Also delete data (subscriptions, password, rule sets)'))
				]),
				E('p', { 'style': 'opacity:.75;font-size:90%' },
					tr('Keeping data lets a later re-install reuse it. Delete it for a completely fresh start.')),
				E('div', { 'class': 'right', 'style': BTNROW }, [
					E('button', { 'class': 'cbi-button',
						'click': function () { ui.hideModal(); } }, tr('Cancel')),
					E('button', { 'class': 'cbi-button cbi-button-negative',
						'click': ui.createHandlerFn(self, function () {
							var purge = purgeBox.checked === true;
							ui.showModal(tr('Uninstall Open-Box'), [ E('p', { 'class': 'spinning' }, tr('Uninstalling...')) ]);
							return runUninstall(purge).then(function () {
								ui.hideModal();
								ui.addNotification(null, E('p', tr('Uninstalled. Refresh the page; this menu entry will be gone.')), 'info');
							}).catch(function (err) {
								ui.hideModal();
								var msg = String(err && err.message || err);
								if (/not found|No such file/i.test(msg)) {
									msg = tr('Uninstall script not found. Run it manually over SSH.');
									ui.addNotification(null, E('p', msg), 'error');
								} else {
									ui.addNotification(null, E('p', fmt('Uninstall failed: %s', msg)), 'error');
								}
							});
						}) }, tr('Confirm uninstall'))
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

			// 「停止」本身就会恢复正常上网(init 脚本的 stop_service 会摘掉 Open-Box 写入的
			// dnsmasq 上游、删掉 IPv6 泄漏拦截),所以不再单列一个「紧急停止」按钮——那和
			// 这里的「停止」是同一个动作。把这层保证写成说明挂在按钮下面即可。
			// 内核的「停止」同时关闭开机自启:部署成功会打开自启,若停止不关掉它,坏配置
			// 把网搞断时停了内核、一重启又被拉起来,网再次断掉——那样的「停止」在真正
			// 需要它的场景里是无效的。面板服务不做这件事:面板是唯一的管理入口,它应该
			// 在重启后自己回来。
			serviceCard('sing-box core', 'openbox', core, null,
				tr('Stopping also turns off autostart (so it stays stopped after a reboot) and restores plain internet access: the IPv6 leak block and the Open-Box DNS upstream are removed. The panel stays reachable.'),
				[ 'stop', 'disable' ]),
			serviceCard('Open-Box panel', 'openbox-panel', panel,
				E('a', { 'href': panelUrl, 'target': '_blank', 'rel': 'noreferrer' }, panelUrl)),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, tr('Uninstall')),
				E('p', {}, tr('Remove Open-Box from this router. Services are stopped, DNS and firewall changes are reverted, and the LuCI page disappears after the next refresh.')),
				E('div', { 'style': BTNROW }, [
					E('button', { 'class': 'cbi-button cbi-button-negative',
						'click': ui.createHandlerFn(self, function () { return showUninstallDialog(); }) },
						tr('Uninstall Open-Box'))
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
