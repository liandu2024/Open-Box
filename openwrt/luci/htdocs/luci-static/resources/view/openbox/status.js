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
		'Open-Box upgrade': 'Open-Box 升级',
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
		'Kernel version': '内核版本',
		'The kernel version is pinned to this Open-Box release and upgrades together with it. To upgrade, use "Update now" in the Open-Box upgrade section below.':
			'内核版本随本次 Open-Box 发行版本一并固定,升级时随其一起更新。如需升级,请使用下方"Open-Box 升级"区块里的"立即更新"。',
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
		'Update now': '立即更新',
		'Confirm update': '确认更新',
		'This will stop services and replace program files. The panel will be briefly unavailable. Continue?':
			'此操作会停止服务并替换程序文件,期间面板会短暂不可用。确定继续吗?',
		'GitHub direct': 'GitHub 直连',
		'Channel': '渠道',
		'Test all channels': '一键检测',
		'Test': '检测',
		'Testing...': '检测中…',
		'Not tested yet': '未检测',
		'Available %sms': '可用 %sms',
		'Unavailable': '不可用',
		'Updating to %s (%s)...': '正在更新到 %s(%s)…',
		'Starting update...': '正在启动更新…',
		'Update started. This may take a few minutes (about 80MB to download).':
			'更新已开始,可能需要几分钟(约需下载 80MB)。',
		'Update complete: now on %s.': '更新完成,当前版本:%s。',
		'Already up to date (no changes made).': '已是最新版本(未做任何改动)。',
		'Update timed out. It may still be running in the background; check again shortly.':
			'更新超时。它可能仍在后台运行,请稍后再检查一次。',
		'Update failed.': '更新失败。',
		'Update failed': '更新失败',
		'Update failed: %s': '更新失败:%s',
		'Recent update log:': '最近的更新日志:',
		'Update script not found. Run it manually over SSH.': '未找到升级脚本,请通过 SSH 手动执行。',
		'Preparing...': '正在准备…',
		'Probing channels...': '正在探测渠道…',
		'Downloading...': '正在下载…',
		'Verifying checksum...': '正在校验…',
		'Extracting...': '正在解包…',
		'Replacing program files (cannot cancel)...': '正在替换程序文件(无法取消)…',
		'Finishing...': '正在收尾…',
		'Update cancelled.': '更新已取消。',
		'Cancel update': '取消更新',
		'Cancelling...': '正在取消…',
		'Cancellation requested. The update will stop shortly.': '已请求取消,更新将很快停止。',
		'Already in the replacement stage; cannot cancel now.': '已进入替换阶段,无法取消。',
		'No update is currently running.': '当前没有正在运行的更新。',
		'Cancel request failed: %s': '取消请求失败:%s',
		'Past this point, cancelling is no longer possible.': '进入此阶段后将无法取消。',
		'Close': '关闭',
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
		'Open-Box upgrade': 'Open-Box 升級',
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
		'Kernel version': '核心版本',
		'The kernel version is pinned to this Open-Box release and upgrades together with it. To upgrade, use "Update now" in the Open-Box upgrade section below.':
			'核心版本隨本次 Open-Box 發行版本一併固定,升級時隨其一起更新。如需升級,請使用下方「Open-Box 升級」區塊裡的「立即更新」。',
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
		'Update now': '立即更新',
		'Confirm update': '確認更新',
		'This will stop services and replace program files. The panel will be briefly unavailable. Continue?':
			'此操作會停止服務並替換程式檔案,期間面板會短暫無法使用。確定要繼續嗎?',
		'GitHub direct': 'GitHub 直連',
		'Channel': '渠道',
		'Test all channels': '一鍵檢測',
		'Test': '檢測',
		'Testing...': '檢測中…',
		'Not tested yet': '未檢測',
		'Available %sms': '可用 %sms',
		'Unavailable': '不可用',
		'Updating to %s (%s)...': '正在更新到 %s(%s)…',
		'Starting update...': '正在啟動更新…',
		'Update started. This may take a few minutes (about 80MB to download).':
			'更新已開始,可能需要幾分鐘(約需下載 80MB)。',
		'Update complete: now on %s.': '更新完成,目前版本:%s。',
		'Already up to date (no changes made).': '已是最新版本(未做任何變更)。',
		'Update timed out. It may still be running in the background; check again shortly.':
			'更新逾時。它可能仍在背景執行,請稍後再檢查一次。',
		'Update failed.': '更新失敗。',
		'Update failed': '更新失敗',
		'Update failed: %s': '更新失敗:%s',
		'Recent update log:': '最近的更新日誌:',
		'Update script not found. Run it manually over SSH.': '找不到升級腳本,請透過 SSH 手動執行。',
		'Preparing...': '正在準備…',
		'Probing channels...': '正在探測渠道…',
		'Downloading...': '正在下載…',
		'Verifying checksum...': '正在校驗…',
		'Extracting...': '正在解壓…',
		'Replacing program files (cannot cancel)...': '正在替換程式檔案(無法取消)…',
		'Finishing...': '正在收尾…',
		'Update cancelled.': '更新已取消。',
		'Cancel update': '取消更新',
		'Cancelling...': '正在取消…',
		'Cancellation requested. The update will stop shortly.': '已請求取消,更新將很快停止。',
		'Already in the replacement stage; cannot cancel now.': '已進入替換階段,無法取消。',
		'No update is currently running.': '目前沒有正在執行的更新。',
		'Cancel request failed: %s': '取消請求失敗:%s',
		'Past this point, cancelling is no longer possible.': '進入此階段後將無法取消。',
		'Close': '關閉',
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

// sing-box 内核的版本号是随 Open-Box 发行版本一起钦定、写死进 meta.json 的构建期
// 常量(见 scripts/build-release.sh 的 SINGBOX_VERSION),不是探测运行中的二进制
// 现查出来的——这里只是读出这个钦定值展示给用户。之所以不提供独立于 Open-Box 发行
// 版本的内核升级入口:发布时生成的 sing-box 配置是照着这个确切版本量身写的,而
// sing-box 的配置 schema 在小版本之间会变(例如 1.11 → 1.12 整个重写了 DNS 段)。
// 独立升级内核会打破"配置版本"与"内核版本"的对应关系,新内核可能直接拒绝启动
// 旧配置。所以内核版本随 Open-Box 整个发行版本一起走:要升级内核,走 Open-Box
// 面板区块的"立即更新"(见 render() 里 sing-box 内核卡片的说明文字)。
function readInstalledSingboxVersion() {
	return fs.read(META_PATH).then(function (txt) {
		var meta = JSON.parse(txt);
		return meta && meta.singboxVersion ? String(meta.singboxVersion) : null;
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
// 一键更新
//
// rpcd 的 fs.exec 同步等待且有超时,升级却要下载约 80MB,同步调用必然中途
// 超时,所以这里总是带 --detach 调用:update.sh 自己 fork 到后台立即返回,
// 真正的下载/替换在后台独立进程里进行,页面转而轮询 meta.json 的版本号,
// 以及 update.sh 写的日志(用于展示进度/失败详情)。
// ---------------------------------------------------------------------------
var UPDATE_PATH = '/opt/open-box/update.sh';
var UPDATE_LOG_PATH = '/tmp/openbox-update.log';
var UPDATE_POLL_INTERVAL_MS = 4000;
var UPDATE_POLL_TIMEOUT_MS = 480000; // 8 分钟:78MB 下载 + 解包 + 换文件的宽松上限

// update.sh 每秒左右重写一次的进度/取消状态文件,纯 key=value 文本(不是
// JSON——两边都是这么约定的,见 scripts/update.sh 里 write_status() 的注释)。
// 路径与该脚本里 STATUS_PATH 的默认值(TMPDIR 未设置时)保持一致,和
// UPDATE_LOG_PATH 同理硬编码 /tmp——rpcd 环境下 TMPDIR 通常不会被设置。
// 用比"决定成功/失败"的 UPDATE_POLL_INTERVAL_MS 更短的间隔单独轮询它,只用来
// 驱动进度条/取消按钮这些次要 UI,不参与"更新到底成功没有"的判定——那个判定
// 仍然是版本号 + 日志正则那一套(见 pollForUpdateCompletion()),按需求原样保留。
var UPDATE_STATUS_PATH = '/tmp/openbox-update.status';
var UPDATE_STATUS_POLL_INTERVAL_MS = 1000;

// 与 scripts/update.sh 里"可安全取消的阶段"完全对应(见该脚本 check_cancel_
// _and_abort() 调用点的分布)——committing 及之后不再出现在这张表里,取消按钮
// 据此隐藏。
var CANCELLABLE_STAGES = {
	starting: true,
	probing: true,
	downloading: true,
	verifying: true,
	extracting: true
};

// 解析 update.sh 写的 key=value 状态文件:每行"键=剩余全部内容",不按 = 再切
// (message 字段本身不会包含 = ,但即使包含,取"第一个 = 之后的全部"也不会错)。
// bytes/total 只有整数才采信,格式不对就当缺失,交给调用方退化处理,不强行拼出
// 一个可能算错的百分比。
function parseUpdateStatus(txt) {
	var out = { pid: '', stage: '', bytes: null, total: null, message: '' };
	String(txt || '').split('\n').forEach(function (line) {
		var i = line.indexOf('=');
		if (i === -1) return;
		var k = line.slice(0, i), v = line.slice(i + 1);
		if (k === 'pid') out.pid = v;
		else if (k === 'stage') out.stage = v;
		else if (k === 'bytes') out.bytes = /^[0-9]+$/.test(v) ? parseInt(v, 10) : null;
		else if (k === 'total') out.total = /^[0-9]+$/.test(v) ? parseInt(v, 10) : null;
		else if (k === 'message') out.message = v;
	});
	return out;
}

function readUpdateStatus() {
	return fs.read(UPDATE_STATUS_PATH).then(function (txt) {
		return parseUpdateStatus(txt);
	}).catch(function () {
		return null;
	});
}

// 阶段 → 展示用的动词短语,不带任何动态数值(百分比/字节数另由 progressDetail()
// 拼在旁边,避免这里的翻译串里塞 3 个 %s——fmt() 只支持替换 2 个)。
function stageText(status) {
	switch (status && status.stage) {
		case 'starting': return tr('Preparing...');
		case 'probing': return tr('Probing channels...');
		case 'downloading': return tr('Downloading...');
		case 'verifying': return tr('Verifying checksum...');
		case 'extracting': return tr('Extracting...');
		case 'committing': return tr('Replacing program files (cannot cancel)...');
		case 'cancelled': return tr('Update cancelled.');
		case 'failed': return tr('Update failed.');
		case 'done': return tr('Finishing...');
		default: return tr('Starting update...');
	}
}

// downloading 阶段拼出 "12.3 / 78.1 MB (16%)" 这样的详情行;total 未知(HEAD
// 探测不到 Content-Length)时退化成只显示已下载的字节数,不编造百分比——与
// update.sh 那边"拿不到 total 就传空字符串"的约定对应。failed/cancelled 阶段
// 复述 update.sh 写的 message(它本来就是中文,不查 i18n 表——这和日志尾巴、
// die() 输出一律直接展示中文是同一个既有约定)。
function progressDetail(status) {
	if (!status) return '';
	if (status.stage === 'downloading' && status.bytes != null) {
		var mb = (status.bytes / (1024 * 1024)).toFixed(1);
		if (status.total != null && status.total > 0) {
			var totalMb = (status.total / (1024 * 1024)).toFixed(1);
			var pct = Math.min(100, Math.floor(status.bytes / status.total * 100));
			return mb + ' / ' + totalMb + ' MB (' + pct + '%)';
		}
		return mb + ' MB';
	}
	if ((status.stage === 'failed' || status.stage === 'cancelled') && status.message) {
		return status.message;
	}
	return '';
}

// 取消一次正在运行的更新:调用 update.sh --cancel(协作式,不发任何信号——见该
// 脚本对应小节的说明),解析 stdout 第一个词得到三种结局之一。exec 本身失败
// (脚本不存在、ACL 拒绝等)走 reject,和 runUpdate()/probeChannel() 同样的
// 错误处理方式(截取 stderr/stdout 最后几行拼进 Error)。
function requestCancel() {
	return fs.exec(UPDATE_PATH, [ '--cancel' ]).then(function (res) {
		if (!res || res.code !== 0) {
			var detail = (res && (res.stderr || res.stdout)) || ('exit ' + (res ? res.code : '?'));
			throw new Error(String(detail).split('\n').slice(-3).join(' ').trim() || 'failed');
		}
		var line = String(res.stdout || '').split('\n')[0];
		return line.replace(/^\s+|\s+$/g, '');
	});
}

// channel 是用户在"版本"卡片的渠道下拉框里选中的值:'direct' 强制直连 GitHub;
// 其它值是一个镜像前缀(渠道选择器固定的三个内置镜像之一,见下方 CHANNELS,与
// scripts/update.sh 的 BUILTIN_MIRRORS 保持一致),原样透传给 update.sh 的
// --mirror <前缀>——用户已经在下拉框里显式选了具体渠道(通常还刚探测过连通性),
// 不需要再让 update.sh 自己去挑一个。--detach 之外再带上路线参数透传给 update.sh。
function runUpdate(channel) {
	var args = [ '--detach' ];
	if (channel === 'direct') {
		args.push('--direct');
	} else {
		args.push('--mirror', channel);
	}
	return fs.exec(UPDATE_PATH, args).then(function (res) {
		if (!res || res.code !== 0) {
			var detail = (res && (res.stderr || res.stdout)) || ('exit ' + (res ? res.code : '?'));
			throw new Error(String(detail).split('\n').slice(-3).join(' ').trim() || 'failed');
		}
		return res;
	});
}

function readUpdateLogTail() {
	return fs.read(UPDATE_LOG_PATH).then(function (txt) {
		return String(txt || '').split('\n').slice(-12).join('\n').replace(/^\s+|\s+$/g, '');
	}).catch(function () {
		return '';
	});
}

// ---------------------------------------------------------------------------
// 渠道探测
//
// 探测必须在路由器上做,不能在浏览器里做:浏览器这一端的网络状况和路由器的完全
// 是两回事——真正要下载 76MB 安装包的是路由器,浏览器这边"通"不代表路由器那边也
// "通"。而且浏览器直接 fetch 一个 gh-proxy 类地址会被 CORS 挡下:这类镜像站不会
// 给 LuCI 页面的源开跨域头。所以探测走 fs.exec 调 update.sh 的 --probe <渠道>,
// 复用它内部同一份"抓 .sha256 并校验内容格式"的判定逻辑(64 位十六进制哈希 + 匹配
// 的资产名),而不是自己另写一套只看 HTTP 状态码的检测——那样会把"200 但是个
// HTML 错误页"的假死镜像误判为可用,见 scripts/update.sh 里 probe_mirror_prefix()
// 的注释。
//
// 一次只探测一个渠道:rpcd 的 fs.exec 本身有超时,4 个渠道放进一次 exec 里一起测
// 有拖到超时的风险。所以"一键检测"改在页面这一层循环 4 个渠道、依次各发起一次
// exec,每测完一个就更新那一行的状态(见 render() 里的 probeOneChannel())——这样
// "一键检测"按钮和每个渠道行自己的「检测」按钮天然共用同一条代码路径,不用分别
// 写两套逻辑。
//
// update.sh 的 --probe 无论探测成功还是失败都固定以 exit 0 退出,靠 stdout 第一个
// 词(ok / fail)区分,这里照着解析;exec 本身失败(脚本不存在、ACL 拒绝等)才走
// catch,同样折算成"不可用",不单独区分给用户看。
function probeChannel(value) {
	return fs.exec(UPDATE_PATH, [ '--probe', value ]).then(function (res) {
		var line = String((res && res.stdout) || '').split('\n')[0] || '';
		var sp = line.indexOf(' ');
		var kind = sp === -1 ? line : line.slice(0, sp);
		var rest = sp === -1 ? '' : line.slice(sp + 1).replace(/^\s+/, '');
		if (kind === 'ok') {
			var ms = parseInt(rest, 10);
			return { ok: true, ms: isNaN(ms) ? null : ms };
		}
		return { ok: false, reason: rest || kind || 'failed' };
	}).catch(function (err) {
		return { ok: false, reason: String(err && err.message || err) };
	});
}

// 轮询直到成功、确认无需升级、脚本报错,或者超时——四种结局都通过 resolve 的
// result 对象表达(不用 reject),调用方只需要看 result.ok / result.noop /
// result.timeout,不必分别处理 resolve 和 reject 两条路径。
function pollForUpdateCompletion(oldVersion, onTick) {
	return new Promise(function (resolve) {
		var elapsed = 0;

		function scheduleNext(logTail) {
			elapsed += UPDATE_POLL_INTERVAL_MS;
			if (elapsed >= UPDATE_POLL_TIMEOUT_MS) {
				resolve({ ok: false, timeout: true, logTail: logTail || '' });
				return;
			}
			window.setTimeout(tick, UPDATE_POLL_INTERVAL_MS);
		}

		function tick() {
			Promise.all([ readInstalledVersion(), readUpdateLogTail(), readUpdateStatus() ]).then(function (res) {
				var version = res[0], logTail = res[1], status = res[2];
				if (onTick) onTick(logTail);
				if (version && version !== oldVersion) {
					resolve({ ok: true, noop: false, version: version, logTail: logTail });
					return;
				}
				// update.sh 在"下载完才发现版本号和当前一致"时会打印这句并正常退出
				// (见脚本里的判断),此时版本号不会变,不能当成超时/失败处理。
				if (/无需升级/.test(logTail)) {
					resolve({ ok: true, noop: true, version: oldVersion, logTail: logTail });
					return;
				}
				// update.sh 的 die() 统一用这个前缀,匹配到就说明脚本已经退出且失败了,
				// 不必再等到超时才告诉用户。
				if (/\[open-box\] 错误:/.test(logTail)) {
					resolve({ ok: false, timeout: false, logTail: logTail });
					return;
				}
				// 状态文件先于日志正则给出"已取消"这个明确结论——用户点了取消按钮,
				// 不该被当成超时或失败处理,单独给一个结局分支。
				if (status && status.stage === 'cancelled') {
					resolve({ ok: false, cancelled: true, logTail: logTail });
					return;
				}
				scheduleNext(logTail);
			}).catch(function () {
				scheduleNext('');
			});
		}

		tick();
	});
}

// ---------------------------------------------------------------------------
// 布局
//
// 不用 cbi-page-actions:那是「页面底部」的操作栏(右对齐 + 特定外边距),
// 一页只该出现一次。放进每张卡片会让按钮脱离卡片右飘、压到下一张卡片上。
// 这里用普通 flex 行/CSS 网格,并写内联样式以免依赖具体主题的 CSS——LuCI 主题
// 众多、还会在手机上被访问,内联样式是唯一能保证在任意主题、任意屏宽下都长一个
// 样子的办法。
// ---------------------------------------------------------------------------
var ROW = 'display:flex;flex-wrap:wrap;align-items:center;gap:.5em;margin:.4em 0';
var BTNROW = 'display:flex;flex-wrap:wrap;gap:.5em;margin:.8em 0 .2em 0';
// 四张功能块拼成 2×2 网格,等宽两列;auto-fit + minmax(340px,1fr) 让窄屏(手机上的
// LuCI)在放不下两个 340px 格子时自动收缩成单列纵向排列,不需要另写媒体查询。
var GRID = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1em';
// 「Open-Box 升级」块里带边框的渠道列表:每行是"渠道名 + 状态"配一个独立的
// 「检测」按钮,边框把这 4 行在视觉上圈成一组,和上面的渠道选择行、下面的
// 检查更新/立即更新控制区分开。
var CHANNEL_LIST = 'border:1px solid rgba(127,127,127,.2);border-radius:4px;padding:0 .6em;margin:.3em 0;font-size:92%';
var CHANNEL_ROW = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5em;' +
	'padding:.4em 0;border-top:1px solid rgba(127,127,127,.14)';

function badge(text, color) {
	return E('strong', { 'style': 'color:' + color }, text);
}

return view.extend({
	load: function () {
		return Promise.all([
			serviceState('openbox'),
			serviceState('openbox-panel'),
			readInstalledVersion(),
			readInstalledSingboxVersion()
		]);
	},

	render: function (data) {
		var core = data[0], panel = data[1], installed = data[2], singboxVersion = data[3];
		var panelUrl = 'http://' + window.location.hostname + ':2026';
		var self = this;

		// -------------------------------------------------------------------
		// 渠道选择器
		//
		// 4 个渠道:GitHub 直连 + 3 个内置镜像,与 scripts/update.sh 的
		// BUILTIN_MIRRORS 保持一致——两边都是各自独立铺开的文件(一个 curl|sh
		// 单文件脚本,一个 LuCI 视图),没有可共享的公共库,只能分别维护同一份
		// 内容。"立即更新"用的就是这里选中的渠道(见 showUpdateDialog()),不再
		// 像旧版那样让 update.sh 自己从内置列表里自动挑一个。
		// -------------------------------------------------------------------
		var CHANNELS = [
			{ value: 'direct', label: tr('GitHub direct') },
			{ value: 'https://ghfast.top', label: 'ghfast.top' },
			{ value: 'https://gh-proxy.com', label: 'gh-proxy.com' },
			{ value: 'https://gh.llkk.cc', label: 'gh.llkk.cc' }
		];

		function channelLabel(value) {
			for (var i = 0; i < CHANNELS.length; i++) {
				if (CHANNELS[i].value === value) return CHANNELS[i].label;
			}
			return value;
		}

		// value -> null(未测试过)| 'pending'(正在测)| { ok: true, ms } | { ok: false, reason }
		var channelResults = {};
		CHANNELS.forEach(function (c) { channelResults[c.value] = null; });

		function channelStatusSuffix(value) {
			var r = channelResults[value];
			if (r === 'pending') return tr('Testing...');
			if (r == null) return tr('Not tested yet');
			if (r.ok) return fmt('Available %sms', (r.ms != null ? r.ms : '?'));
			return tr('Unavailable');
		}

		// 组合出类似 "GitHub 直连: 可用 320ms" / "ghfast.top: 不可用" 这样单行的
		// 渠道状态,一键检测/单渠道检测的结果、以及"立即更新"按钮旁的选中渠道摘要
		// 共用同一个格式,读起来始终一致。
		function channelStatusText(value) {
			return channelLabel(value) + ': ' + channelStatusSuffix(value);
		}

		// 每张卡片是一个自成一体的功能块:状态/控制在上,该组件自己的版本信息(如有)
		// 在下,都装进同一个 cbi-section 容器里(extraSections,可选)——而不是像旧版
		// 那样把「版本」拆成页面末尾单独一张卡片,那样读者要在两张卡片之间来回对应
		// "这个版本号说的是哪个组件"。渠道选择/探测/升级操作篇幅较大、也不是"某个
		// 组件自己的版本信息",所以单独成一张「Open-Box 升级」卡片,不塞进这里。
		function serviceCard(title, name, st, extraRow, hint, stopActions, extraSections) {
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
			].concat(hint ? [ E('p', { 'style': 'opacity:.7;font-size:90%;margin:.2em 0 0 0' }, hint) ] : [])
			 .concat(extraSections || []));
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

		// 更新失败时把日志尾巴摆出来,而不是让用户面对一句"失败了"猜半天——
		// update.sh 的每一步都用 info()/warn()/die() 打了清楚的中文说明,直接展示即可。
		function showUpdateFailure(msg, logTail) {
			var body = [ E('p', {}, msg) ];
			if (logTail) {
				body.push(E('p', { 'style': 'font-weight:bold;margin:.6em 0 .2em 0' }, tr('Recent update log:')));
				body.push(E('pre', {
					'style': 'max-height:16em;overflow:auto;background:rgba(127,127,127,.08);' +
						'padding:.5em;font-size:85%;white-space:pre-wrap;margin:0'
				}, logTail));
			}
			body.push(E('div', { 'class': 'right', 'style': BTNROW }, [
				E('button', { 'class': 'cbi-button', 'click': function () { ui.hideModal(); } }, tr('Close'))
			]));
			ui.showModal(tr('Update failed'), body);
		}

		// 更新走本地脚本(随发布包铺下来的那份,与卸载同理),不依赖外网页面本身
		// 的可用性;总是带 --detach,原因见 runUpdate() 定义处的说明。这里只负责
		// 触发 + 轮询 + 展示进度/结果,真正的下载/校验/换文件全在 update.sh 里。
		// channel 是用户在渠道选择器里选中的渠道('direct' 或某个镜像前缀,见下方
		// CHANNELS),原样透传给 runUpdate()。
		function startUpdate(latestVersion, channel) {
			var progressBody = E('p', { 'class': 'spinning' }, tr('Starting update...'));
			var progressDetailEl = E('p', { 'style': 'margin:.2em 0 0 0;font-size:90%;opacity:.8' }, '');
			var progressBarInner = E('div', {
				'style': 'height:100%;width:0%;background:#2a9d2a;transition:width .3s linear'
			});
			var progressBarOuter = E('div', {
				'style': 'height:6px;background:rgba(127,127,127,.2);border-radius:3px;' +
					'margin:.5em 0;overflow:hidden;display:none'
			}, [ progressBarInner ]);
			// 取消按钮初始隐藏:runUpdate() 的 fs.exec 返回之前,状态文件里可能还是上一次
			// 更新遗留的终态(见 update.sh --detach 分支的说明),这时按不按都没有意义。
			// fs.exec 一返回就开始轮询状态文件,由 applyStatus() 接管这个按钮此后的
			// 显示/隐藏——只要阶段可取消就露出来,不需要在这里预判。
			var cancelBtn = E('button', {
				'class': 'cbi-button cbi-button-negative', 'style': 'display:none',
				'click': ui.createHandlerFn(self, function () { return doCancel(); })
			}, tr('Cancel update'));
			var cancelNote = E('p', {
				'style': 'opacity:.7;font-size:85%;margin:.4em 0 0 0;display:none'
			}, tr('Past this point, cancelling is no longer possible.'));
			var logBox = E('pre', {
				'style': 'max-height:12em;overflow:auto;background:rgba(127,127,127,.08);' +
					'padding:.5em;font-size:85%;white-space:pre-wrap;margin-top:.6em;display:none'
			}, '');
			ui.showModal(fmt('Updating to %s (%s)...', latestVersion, channelLabel(channel)), [
				progressBody, progressDetailEl, progressBarOuter,
				E('div', { 'style': BTNROW }, [ cancelBtn ]), cancelNote,
				logBox
			]);

			var oldVersion = installed;
			var finished = false;
			var progressTimer = null;

			function stopProgressPolling() {
				if (progressTimer != null) {
					window.clearInterval(progressTimer);
					progressTimer = null;
				}
			}

			// 每秒把状态文件里的当前阶段/字节数映射到进度文案 + 进度条 + 取消按钮的
			// 显示状态。committing 及之后的阶段(以及 done/failed/cancelled 这些终态)
			// 都不在 CANCELLABLE_STAGES 里,一旦看到就隐藏取消按钮、露出说明文字——
			// 这就是"取消按钮只在可安全取消的阶段可点"这条要求在页面这一侧的落地点。
			function applyStatus(status) {
				if (finished || !status || !status.stage) return;
				progressBody.textContent = stageText(status);
				var detail = progressDetail(status);
				progressDetailEl.textContent = detail;
				if (status.stage === 'downloading' && status.bytes != null && status.total) {
					var pct = Math.min(100, Math.floor(status.bytes / status.total * 100));
					progressBarOuter.style.display = '';
					progressBarInner.style.width = pct + '%';
				} else {
					progressBarOuter.style.display = 'none';
				}
				var cancellable = CANCELLABLE_STAGES.hasOwnProperty(status.stage);
				if (cancellable) {
					cancelBtn.style.display = '';
					cancelNote.style.display = 'none';
				} else {
					cancelBtn.style.display = 'none';
					cancelNote.style.display = '';
				}
			}

			function doCancel() {
				cancelBtn.disabled = true;
				cancelBtn.textContent = tr('Cancelling...');
				return requestCancel().then(function (word) {
					if (word === 'requested') {
						ui.addNotification(null, E('p', tr('Cancellation requested. The update will stop shortly.')), 'info');
						return;
					}
					if (word === 'committing') {
						ui.addNotification(null, E('p', tr('Already in the replacement stage; cannot cancel now.')), 'info');
					} else {
						ui.addNotification(null, E('p', tr('No update is currently running.')), 'info');
					}
					cancelBtn.style.display = 'none';
					cancelNote.style.display = '';
				}).catch(function (err) {
					ui.addNotification(null, E('p', fmt('Cancel request failed: %s', String(err && err.message || err))), 'error');
					cancelBtn.disabled = false;
					cancelBtn.textContent = tr('Cancel update');
				});
			}

			return runUpdate(channel).then(function () {
				progressBody.textContent = tr('Update started. This may take a few minutes (about 80MB to download).');
				readUpdateStatus().then(applyStatus);
				progressTimer = window.setInterval(function () {
					readUpdateStatus().then(applyStatus);
				}, UPDATE_STATUS_POLL_INTERVAL_MS);
				return pollForUpdateCompletion(oldVersion, function (logTail) {
					if (logTail) {
						logBox.style.display = '';
						logBox.textContent = logTail;
					}
				});
			}).then(function (result) {
				finished = true;
				stopProgressPolling();
				ui.hideModal();
				if (result.cancelled) {
					ui.addNotification(null, E('p', tr('Update cancelled.')), 'info');
					return;
				}
				if (!result.ok) {
					var failMsg = result.timeout
						? tr('Update timed out. It may still be running in the background; check again shortly.')
						: tr('Update failed.');
					showUpdateFailure(failMsg, result.logTail);
					return;
				}
				if (result.noop) {
					ui.addNotification(null, E('p', tr('Already up to date (no changes made).')), 'info');
					return;
				}
				ui.addNotification(null, E('p', fmt('Update complete: now on %s.', result.version)), 'info');
				window.setTimeout(function () { location.reload(); }, 1200);
			}).catch(function (err) {
				finished = true;
				stopProgressPolling();
				ui.hideModal();
				var msg = String(err && err.message || err);
				if (/not found|No such file/i.test(msg)) {
					ui.addNotification(null, E('p', tr('Update script not found. Run it manually over SSH.')), 'error');
				} else {
					ui.addNotification(null, E('p', fmt('Update failed: %s', msg)), 'error');
				}
			});
		}

		// 渠道已经在「Open-Box 升级」卡片的下拉框里显式选好了(见下方 CHANNELS/selectedChannel),
		// 这里不再像旧版那样在确认弹窗里二次选择路线,只是把选中渠道当前的探测状态
		// 复述一遍——不然用户在确认这一步完全看不到"这个渠道到底测没测过、测出来
		// 怎么样",容易在一个刚探测失败的渠道上误点确认,白白等一次必然失败的
		// 76MB 下载。
		function showUpdateDialog(latestVersion) {
			var channel = selectedChannel;
			ui.showModal(tr('Confirm update'), [
				E('p', {}, tr('This will stop services and replace program files. The panel will be briefly unavailable. Continue?')),
				E('p', { 'style': 'opacity:.8;font-size:90%;margin:.6em 0 0 0' }, channelStatusText(channel)),
				E('div', { 'class': 'right', 'style': BTNROW }, [
					E('button', { 'class': 'cbi-button',
						'click': function () { ui.hideModal(); } }, tr('Cancel')),
					E('button', { 'class': 'cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(self, function () { return startUpdate(latestVersion, channel); }) },
						tr('Update now'))
				])
			]);
		}

		var versionResult = E('span', { 'style': 'margin-left:.6em' }, '');

		var latestAvailable = null;

		var updateBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'style': 'display:none',
			'click': ui.createHandlerFn(self, function () { return showUpdateDialog(latestAvailable); }) },
			tr('Update now'));

		var checkBtn = E('button', { 'class': 'cbi-button cbi-button-neutral',
			'click': ui.createHandlerFn(self, function () {
				versionResult.textContent = tr('Checking...');
				latestAvailable = null;
				updateBtn.style.display = 'none';
				return checkLatest().then(function (latest) {
					if (!installed) {
						versionResult.textContent = fmt('New version available: %s', latest);
						return;
					}
					if (cmpVersion(latest, installed) > 0) {
						versionResult.textContent = fmt('New version available: %s', latest);
						latestAvailable = latest;
						updateBtn.style.display = '';
					} else {
						versionResult.textContent = tr('Up to date.');
					}
				}).catch(function () {
					versionResult.textContent = tr('Could not check (network unreachable or blocked).');
				});
			}) }, tr('Check for updates'));

		// 一键检测 / 每行「检测」按钮共用的 DOM 挂接:每个渠道一行,exec 逐个发起、
		// 逐个更新(见 probeChannel() 定义处的注释——不是一次 exec 探测全部)。
		var channelRowEls = {};
		// 探测期间要禁用的按钮集合:一键检测按钮本身,加上 4 个渠道各自的「检测」
		// 按钮——不管是"一键检测"链式跑完 4 个,还是单独点某一行,都不希望这期间
		// 还能再点出一次重叠的探测请求。
		var channelBtnEls = {};

		function updateChannelRow(value) {
			var el = channelRowEls[value];
			if (!el) return;
			var r = channelResults[value];
			el.textContent = channelStatusText(value);
			el.title = (r && r.ok === false && r.reason) ? r.reason : '';
			el.style.color = (r && r.ok === true) ? '#2a9d2a' : (r && r.ok === false) ? '#c33' : '';
			if (value === selectedChannel) updateSelectedChannelLine();
		}

		function updateSelectedChannelLine() {
			selectedChannelLine.textContent = channelStatusText(selectedChannel);
			var r = channelResults[selectedChannel];
			selectedChannelLine.style.color = (r && r.ok === true) ? '#2a9d2a' : (r && r.ok === false) ? '#c33' : '';
		}

		function probeOneChannel(value) {
			channelResults[value] = 'pending';
			updateChannelRow(value);
			return probeChannel(value).then(function (result) {
				channelResults[value] = result;
				updateChannelRow(value);
			});
		}

		function setProbingDisabled(disabled) {
			probeAllBtn.disabled = disabled;
			CHANNELS.forEach(function (c) {
				var btn = channelBtnEls[c.value];
				if (btn) btn.disabled = disabled;
			});
		}

		var probeAllBtn = E('button', { 'class': 'cbi-button cbi-button-neutral',
			'click': ui.createHandlerFn(self, function () {
				setProbingDisabled(true);
				var chain = Promise.resolve();
				CHANNELS.forEach(function (c) {
					chain = chain.then(function () { return probeOneChannel(c.value); });
				});
				return chain.then(function () { setProbingDisabled(false); });
			}) }, tr('Test all channels'));

		var selectedChannel = CHANNELS[0].value;

		var channelSelect = E('select', { 'class': 'cbi-input-select' },
			CHANNELS.map(function (c) { return E('option', { 'value': c.value }, c.label); }));
		channelSelect.addEventListener('change', function () {
			selectedChannel = channelSelect.value;
			updateSelectedChannelLine();
		});

		// 带边框的渠道列表(CHANNEL_LIST/CHANNEL_ROW,见其定义处的注释):每行是
		// "渠道名: 状态"文本配一个独立的「检测」按钮——这个按钮测的是这一行自己的
		// 渠道,不是上面下拉框里当前选中的那个(下拉框选的是"立即更新"要用哪个渠道,
		// 两者不必相同,用户可能想先把 4 个渠道都探一遍再决定选哪个)。一键检测和
		// 这里的按钮只是触发方式不同,底层都是同一个 probeOneChannel(),结果都写回
		// 同一行,行为完全一致。
		var channelStatusList = E('div', { 'style': CHANNEL_LIST },
			CHANNELS.map(function (c, idx) {
				var textEl = E('span', {}, channelStatusText(c.value));
				channelRowEls[c.value] = textEl;
				var btn = E('button', { 'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(self, function () {
						setProbingDisabled(true);
						return probeOneChannel(c.value).then(function () { setProbingDisabled(false); });
					}) }, tr('Test'));
				channelBtnEls[c.value] = btn;
				return E('div', {
					'style': CHANNEL_ROW + (idx === 0 ? ';border-top:none' : '')
				}, [ textEl, btn ]);
			}));

		// 紧挨着「立即更新」摆一份选中渠道的实时状态,免得有人在某个渠道刚探测出
		// 不可用之后,还照样点「立即更新」去开始一次注定失败的 76MB 下载。
		var selectedChannelLine = E('span', { 'style': 'margin-left:.6em;font-size:92%' },
			channelStatusText(selectedChannel));

		return E('div', {}, [
			E('h2', {}, 'Open-Box'),
			E('p', { 'class': 'cbi-section-descr' },
				tr('Fallback controls. Full management lives in the Open-Box panel.')),

			// 2×2 网格,四张自成一体的功能块(见 GRID 定义处的注释):sing-box 内核、
			// Open-Box 面板、Open-Box 升级、卸载——按负责人手绘草图从左到右、从上到下
			// 排列,DOM 顺序即视觉顺序(auto-fit 网格按源码顺序逐行填格,不需要额外的
			// grid-area/order 声明)。
			E('div', { 'style': GRID }, [
				// 「停止」本身就会恢复正常上网(init 脚本的 stop_service 会摘掉 Open-Box 写入的
				// dnsmasq 上游、删掉 IPv6 泄漏拦截),所以不再单列一个「紧急停止」按钮——那和
				// 这里的「停止」是同一个动作。把这层保证写成说明挂在按钮下面即可。
				// 内核的「停止」同时关闭开机自启:部署成功会打开自启,若停止不关掉它,坏配置
				// 把网搞断时停了内核、一重启又被拉起来,网再次断掉——那样的「停止」在真正
				// 需要它的场景里是无效的。面板服务不做这件事:面板是唯一的管理入口,它应该
				// 在重启后自己回来。
				//
				// 「sing-box 内核」这张卡片是一个自成一体的功能块:状态/控制在上,内核
				// 版本 + 升级说明在下——内核版本号来自 meta.json 的 singboxVersion(构建期
				// 钦定值,见 readInstalledSingboxVersion() 的注释),并且这里刻意不放一个
				// 独立的"升级内核"按钮:内核版本与 Open-Box 发行版本是绑定发布的,配置是
				// 照着这个确切内核版本生成的,独立升级内核有打破这层对应关系、生成的配置被
				// 新内核拒绝启动的风险。升级入口统一指向下面「Open-Box 升级」卡片里的
				// 「立即更新」——内核随整个发行版本一起换。
				serviceCard('sing-box core', 'openbox', core, null,
					tr('Stopping also turns off autostart (so it stays stopped after a reboot) and restores plain internet access: the IPv6 leak block and the Open-Box DNS upstream are removed. The panel stays reachable.'),
					[ 'stop', 'disable' ],
					[
						E('div', { 'style': ROW + ';margin-top:.8em;padding-top:.6em;border-top:1px solid rgba(127,127,127,.2)' }, [
							E('span', {}, tr('Kernel version') + ':'),
							E('strong', {}, singboxVersion || tr('Not installed'))
						]),
						E('p', { 'style': 'opacity:.7;font-size:90%;margin:.2em 0 0 0' },
							tr('The kernel version is pinned to this Open-Box release and upgrades together with it. To upgrade, use "Update now" in the Open-Box upgrade section below.'))
					]),

				// 「Open-Box 面板」卡片同理是一个自成一体的功能块:状态/控制 + 面板地址在
				// 上,该发行版本自身的版本号在下——这里只放版本号本身;渠道选择、探测与
				// 升级操作篇幅大、也不是"这张卡片自己的版本信息",单独成一张紧跟在后面的
				// 「Open-Box 升级」卡片(见下方),不再像旧版那样挤进面板卡片里。
				serviceCard('Open-Box panel', 'openbox-panel', panel,
					E('a', { 'href': panelUrl, 'target': '_blank', 'rel': 'noreferrer' }, panelUrl),
					null, null,
					[
						E('div', { 'style': ROW + ';margin-top:.8em;padding-top:.6em;border-top:1px solid rgba(127,127,127,.2)' }, [
							E('span', {}, tr('Installed version') + ':'),
							E('strong', {}, installed || tr('Not installed'))
						])
					]),

				// 「Open-Box 升级」独立成一张卡片(负责人手绘草图的要求):最上面一行是
				// 渠道下拉框 + 一键检测,中间一个带边框的列表把 4 个渠道各自的探测状态 +
				// 单独的「检测」按钮圈在一起,最下面是检查更新/立即更新那组控制——三段
				// 自上而下正好对应草图里同一张卡片的三个区域。
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, tr('Open-Box upgrade')),
					E('div', { 'style': ROW }, [
						E('span', {}, tr('Channel') + ':'),
						channelSelect,
						probeAllBtn
					]),
					channelStatusList,
					E('div', { 'style': BTNROW }, [ checkBtn, versionResult, updateBtn, selectedChannelLine ])
				]),

				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, tr('Uninstall')),
					E('p', {}, tr('Remove Open-Box from this router. Services are stopped, DNS and firewall changes are reverted, and the LuCI page disappears after the next refresh.')),
					E('div', { 'style': BTNROW }, [
						E('button', { 'class': 'cbi-button cbi-button-negative',
							'click': ui.createHandlerFn(self, function () { return showUninstallDialog(); }) },
							tr('Uninstall Open-Box'))
					])
				])
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
